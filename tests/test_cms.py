"""The CMS importer against a fake Coverage API (CI never calls the real one)."""

import httpx

from indicium.policies.cms import API, CmsClient

LCD_HTML = "&lt;p&gt;Covered when &lt;strong&gt;four weeks&lt;/strong&gt; of care failed.&lt;/p&gt;"


def fake_api(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path, q = request.url.path.removeprefix("/v1"), request.url.params
        if path.startswith("/data/"):
            assert request.headers["Authorization"] == "Bearer tok-1"
        if path == "/metadata/license-agreement/":
            return httpx.Response(200, json={"data": [{"Token": "tok-1"}]})
        if path == "/reports/local-coverage-final-lcds/":
            rows = [
                {"document_id": 1234, "document_version": v, "url": "https://x/L1234",
                 "effective_date": "11/19/2026", "contractor_name_type": "Some MAC\r\n(A)"}
                for v in (3, 5)
            ]  # fmt: skip
            return httpx.Response(200, json={"data": rows})
        if path == "/data/lcd/":
            assert q["ver"] == "5"  # the newest listed version
            return httpx.Response(
                200, json={"data": [{"title": " Test LCD ", "indication": LCD_HTML}]}
            )
        if path == "/data/lcd/related-documents":
            return httpx.Response(200, json={"data": [{"r_article_id": 9}, {"r_article_id": 8}]})
        if path == "/reports/local-coverage-articles/":
            rows = [
                {"document_id": 9, "document_version": 2, "title": "Billing and Coding: Test"},
                {"document_id": 9, "document_version": 4, "title": "Billing and Coding: Test"},
                {"document_id": 8, "document_version": 1, "title": "Response to Comments: Test"},
            ]
            return httpx.Response(200, json={"data": rows})
        if path == "/data/article/hcpc-code":
            assert (q["articleid"], q["ver"]) == ("9", "4")  # newest version, comments skipped
            # Two pages, to check that paging is followed.
            if "next_token" not in q:
                page = {"data": [{"hcpc_code_id": "72148", "long_description": "MRI"}],
                        "meta": {"next_token": "p2"}}  # fmt: skip
                return httpx.Response(200, json=page)
            return httpx.Response(200, json={"data": [{"hcpc_code_id": " e0601 "}]})
        if path == "/data/article/icd10-covered":
            return httpx.Response(200, json={"data": [{"icd10_code_id": "M54.16"}]})
        return httpx.Response(404, json={"message": "unexpected " + path})

    return httpx.MockTransport(handle)


def test_fetch_lcd_builds_a_policy_draft():
    seen: list[httpx.Request] = []
    client = CmsClient(httpx.Client(base_url=API, transport=fake_api(seen)))
    draft = client.fetch_lcd("l1234")

    assert draft["policy_id"] == "cms-l1234"
    assert draft["title"] == "Test LCD"
    assert draft["source"]["version"] == 5
    assert draft["source"]["effective_date"] == "2026-11-19"
    assert draft["source"]["contractor"] == "Some MAC (A)"
    assert [c["code"] for c in draft["procedure_codes"]] == ["72148", "E0601"]
    assert draft["diagnosis_codes"] == ["M54.16"]
    # Double-escaped HTML comes out as plain text, under its section heading.
    assert draft["source_text"].endswith("Covered when four weeks of care failed.")
    tokens = [r for r in seen if r.url.path.endswith("license-agreement/")]
    assert len(tokens) == 1  # one token reused for every licensed call
