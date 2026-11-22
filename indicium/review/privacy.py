"""Mask the patient's identifiers before note text leaves the process for a model.

The masked text keeps a map back to the original, so a quote the model returns from the masked
text can still be located and highlighted in the original note.

Only identifiers the request itself carries are masked (name, member id, birth date): those are
known exactly. Free-text identifiers of other people are out of scope; the data is synthetic.
"""

import re
from datetime import date

from indicium.cases.model import Patient

NAME, MEMBER_ID, BIRTH_DATE = "[PATIENT]", "[MEMBER_ID]", "[DOB]"


def mask(text: str, patient: Patient) -> tuple[str, list[int]]:
    """Masked text, and for each of its characters the index of the original character."""
    pattern = _pattern(patient)
    if pattern is None:
        return text, list(range(len(text)))
    out: list[str] = []
    index: list[int] = []
    last = 0
    for match in pattern.finditer(text):
        out.append(text[last : match.start()])
        index.extend(range(last, match.start()))
        token = _token_for(match.group(), patient)
        out.append(token)
        # The token's first character maps to the start of what it hides and the rest to its end,
        # so a span that covers the whole token covers the whole original.
        index.extend([match.start()] + [match.end() - 1] * (len(token) - 1))
        last = match.end()
    out.append(text[last:])
    index.extend(range(last, len(text)))
    return "".join(out), index


def original_span(index: list[int], start: int, end: int) -> tuple[int, int]:
    return index[start], index[end - 1] + 1


def _variants(patient: Patient) -> dict[str, str]:
    names = {patient.name} | {p for p in re.split(r"[\s,]+", patient.name) if len(p) >= 3}
    born: date = patient.birth_date
    dates = {
        born.isoformat(),
        f"{born.month:02d}/{born.day:02d}/{born.year}",
        f"{born.month}/{born.day}/{born.year}",
    }
    return (
        dict.fromkeys(names, NAME)
        | {patient.member_id: MEMBER_ID}
        | dict.fromkeys(dates, BIRTH_DATE)
    )


def _pattern(patient: Patient) -> re.Pattern | None:
    variants = sorted(_variants(patient), key=len, reverse=True)  # longest first
    if not variants:
        return None
    alternatives = "|".join(re.escape(v) for v in variants)
    return re.compile(rf"(?<![\w/-])(?:{alternatives})(?![\w/-])", re.IGNORECASE)


def _token_for(found: str, patient: Patient) -> str:
    lowered = {k.lower(): v for k, v in _variants(patient).items()}
    return lowered[found.lower()]
