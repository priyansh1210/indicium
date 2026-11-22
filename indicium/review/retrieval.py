"""Find the note sentences that matter for a criterion: embeddings plus shared words.

Embeddings catch paraphrase ("PT" vs "physical therapy" in context); shared words catch exact
clinical terms the small embedding model blurs. If the embedding model cannot load, ranking
falls back to shared words alone rather than failing the review.
"""

import logging
import math
import re
from collections.abc import Callable
from functools import cache

import numpy as np

from indicium.config import settings
from indicium.review.notes import Sentence, sentences

log = logging.getLogger(__name__)

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be been by for from has have had in is it its of on or that the this to "
    "was were with which who will when where there their they them he she his her patient "
    "documented notes note shows any one more least than".split()
)
SEMANTIC_WEIGHT = 0.6


def words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


class Embedder:
    def __init__(self, model_name: str, cache_dir: str):
        from fastembed import TextEmbedding  # heavy import, only when embeddings are used

        self.model = TextEmbedding(model_name, cache_dir=cache_dir)

    def query(self, text: str) -> np.ndarray:
        return _unit(np.array(next(iter(self.model.query_embed([text])))))

    def passages(self, texts: list[str]) -> np.ndarray:
        return _unit(np.array(list(self.model.embed(texts))))


def _unit(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)


@cache
def embedder() -> Embedder | None:
    """One model per process, loaded on first use. None when it cannot load."""
    s = settings()
    try:
        return Embedder(s.embedding_model, s.embedding_cache)
    except Exception:
        log.warning("embedding model unavailable; ranking by shared words only", exc_info=True)
        return None


class Ranker:
    """Sentences of one case, embedded once, ranked against any number of queries."""

    def __init__(self, documents: dict[str, str], model: Embedder | None):
        self.sentences = [s for doc_id, text in documents.items() for s in sentences(doc_id, text)]
        self.model = model
        self.words = [words(s.text) for s in self.sentences]
        self.vectors = (
            model.passages([s.text for s in self.sentences]) if model and self.sentences else None
        )

    def top(self, query: str, k: int) -> list[tuple[float, Sentence]]:
        if not self.sentences:
            return []
        query_words = words(query)
        overlap = np.array(
            [len(query_words & w) / math.sqrt(len(query_words) * len(w) or 1) for w in self.words]
        )
        if self.vectors is None:
            scores = overlap
        else:
            semantic = self.vectors @ self.model.query(query)
            scores = SEMANTIC_WEIGHT * semantic + (1 - SEMANTIC_WEIGHT) * overlap
        order = np.argsort(-scores, kind="stable")[:k]
        return [(float(scores[i]), self.sentences[i]) for i in order]


def excerpts(
    documents: dict[str, str],
    queries: list[str],
    budget: int,
    load_model: Callable[[], Embedder | None] = embedder,
    k: int = 6,
) -> dict[str, str]:
    """The notes to show a model: whole when they fit the budget, else the sentences that rank
    in the top k for any query, with their neighbours, in reading order. The embedding model is
    loaded only when excerpts are needed."""
    if sum(map(len, documents.values())) <= budget:
        return documents
    ranker = Ranker(documents, load_model())
    position = {id(s): n for n, s in enumerate(ranker.sentences)}
    keep: set[int] = set()
    for query in queries:
        for _, sentence in ranker.top(query, k):
            n = position[id(sentence)]
            keep |= {n - 1, n, n + 1}
    chosen = [ranker.sentences[n] for n in sorted(keep) if 0 <= n < len(ranker.sentences)]
    out: dict[str, list[str]] = {}
    for sentence in chosen:
        out.setdefault(sentence.doc_id, []).append(sentence.text)
    # shortcut: excerpts are not trimmed to the budget, so many criteria over a huge record can
    # exceed it; cap per-query k by budget if model context errors appear.
    return {doc_id: "\n...\n".join(parts) for doc_id, parts in out.items()}
