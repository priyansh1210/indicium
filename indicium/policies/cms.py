"""Fetch a Local Coverage Determination (LCD) from the public CMS Coverage API.

No key is needed. LCD and article data need a license token, which the API issues on request and
which is valid for one hour; requesting it accepts the AMA/ADA/AHA license terms it returns.
Docs: https://api.coverage.cms.gov/docs/

The result is a policy without criteria: the LCD text, its procedure codes and its covered
diagnosis codes. Criteria are drafted from the text and checked by a person before publishing.
"""

import html
import time
from datetime import UTC, datetime

import httpx

from indicium.text import html_to_text

API = "https://api.coverage.cms.gov/v1"
# The LCD sections that say when the service is covered and what must be documented.
SECTIONS = {
    "indication": "Coverage Indications, Limitations, and/or Medical Necessity",
    "doc_reqs": "Documentation Requirements",
    "util_guide": "Utilization Guidelines",
}


class CmsError(Exception):
    pass


class CmsClient:
    def __init__(self, client: httpx.Client | None = None):
        self.http = client or httpx.Client(
            base_url=API, timeout=30, transport=httpx.HTTPTransport(retries=3)
        )
        self._token: tuple[str, float] | None = None

    def _get(self, path: str, licensed: bool = False, **params) -> list[dict]:
        """All rows of one endpoint, following the API's next_token paging."""
        rows: list[dict] = []
        while True:
            headers = {"Authorization": f"Bearer {self._license()}"} if licensed else {}
            response = self.http.get(path, params=params, headers=headers)
            if response.status_code >= 400:
                raise CmsError(f"{path} answered {response.status_code}: {response.text[:200]}")
            body = response.json()
            rows += body.get("data") or []
            if not (token := (body.get("meta") or {}).get("next_token")):
                return rows
            if token == params.get("next_token"):
                raise CmsError(f"{path} returned the same page token twice")
            params["next_token"] = token

    def _license(self) -> str:
        if self._token and self._token[1] > time.monotonic():
            return self._token[0]
        rows = self._get("/metadata/license-agreement/")
        token = rows[0]["Token"]
        self._token = (token, time.monotonic() + 50 * 60)  # valid 60 minutes; renew early
        return token

    def latest_lcd(self, lcd_id: int) -> dict:
        """The newest listed version of a final LCD."""
        listing = self._get("/reports/local-coverage-final-lcds/")
        versions = [r for r in listing if r["document_id"] == lcd_id]
        if not versions:
            raise CmsError(f"L{lcd_id} is not a current final LCD in the CMS listing")
        return max(versions, key=lambda r: r["document_version"])

    def fetch_lcd(self, display_id: str) -> dict:
        """A policy document (as a dict) for an LCD such as "L34220", with empty criteria."""
        lcd_id = int(display_id.upper().removeprefix("L"))
        listed = self.latest_lcd(lcd_id)
        version = listed["document_version"]
        lcd = self._get("/data/lcd/", licensed=True, lcdid=lcd_id, ver=version)[0]

        sections = {heading: _text(lcd.get(field)) for field, heading in SECTIONS.items()}
        text = "\n\n".join(f"{heading}\n\n{body}" for heading, body in sections.items() if body)
        procedures: dict[str, str] = {}
        diagnoses: set[str] = set()
        for article in self._coding_articles(lcd_id, version):
            params = {"articleid": article["document_id"], "ver": article["document_version"]}
            for row in self._get("/data/article/hcpc-code", licensed=True, **params):
                code = row["hcpc_code_id"].strip().upper()
                procedures.setdefault(code, _text(row.get("long_description")))
            for row in self._get("/data/article/icd10-covered", licensed=True, **params):
                diagnoses.add(row["icd10_code_id"].strip().upper())

        title = lcd["title"].strip()
        return {
            "policy_id": f"cms-{display_id.lower()}",
            "title": title,
            "source": {
                "kind": "cms_lcd",
                "document_id": display_id.upper(),
                "version": version,
                "title": title,
                "url": listed["url"],
                "effective_date": _date(listed.get("effective_date")),
                "contractor": " ".join(listed.get("contractor_name_type", "").split()) or None,
                "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
            },
            "procedure_codes": [
                {"code": c, "description": d} for c, d in sorted(procedures.items())
            ],
            "diagnosis_codes": sorted(diagnoses),
            "criteria": None,
            "source_text": text,
        }

    def _coding_articles(self, lcd_id: int, version: int) -> list[dict]:
        """Current versions of the articles linked to an LCD that can carry its codes.

        Part A/B contractors put codes in "Billing and Coding" articles, DME contractors in
        "Policy Article"s; only the replies to public comments never carry them.
        """
        related = self._get("/data/lcd/related-documents", licensed=True, lcdid=lcd_id, ver=version)
        article_ids = {r["r_article_id"] for r in related if r.get("r_article_id")}
        listing = self._get("/reports/local-coverage-articles/")
        current: dict[int, dict] = {}
        for row in listing:
            if row["document_id"] in article_ids and not row["title"].startswith("Response to"):
                kept = current.get(row["document_id"])
                if not kept or row["document_version"] > kept["document_version"]:
                    current[row["document_id"]] = row
        return list(current.values())


def _text(field: str | None) -> str:
    """Plain text of an API field. Some fields hold HTML that was escaped a second time."""
    field = field or ""
    if "<" not in field and "&lt;" in field:
        field = html.unescape(field)
    return html_to_text(field)


def _date(us_date: str | None) -> str | None:
    """CMS dates are MM/DD/YYYY; "N/A" and blanks mean none."""
    try:
        return datetime.strptime(us_date or "", "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None
