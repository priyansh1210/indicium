import pytest

from indicium.text import html_to_text, locate

NOTE = (
    "Pt reports low back pain x 6 weeks.\n"
    "Completed PT — 8 sessions, no relief.  Denies  bowel or bladder changes.\n"
    "Plan: MRI L-spine “to evaluate for HNP”."
)


@pytest.mark.parametrize(
    "quote",
    [
        "low back pain x 6 weeks",
        "LOW BACK PAIN X 6 WEEKS",  # case
        "Completed PT - 8 sessions, no relief.",  # nbsp, em dash
        "no relief. Denies bowel or bladder changes",  # double spaces, line break
        '"Completed PT — 8 sessions"',  # wrapped in quote marks by the model
        'MRI L-spine "to evaluate for HNP"',  # curly quotes in the source
    ],
)
def test_locate_finds_real_quotes_and_maps_back(quote):
    span = locate(quote, NOTE)
    assert span is not None
    found = NOTE[span[0] : span[1]]
    # The span is in the original text, so the UI can highlight exactly what was quoted.
    assert locate(found, NOTE) == span


@pytest.mark.parametrize(
    "quote",
    [
        "low back pain x 8 weeks",  # one changed number
        "Completed PT, 8 sessions, with relief",  # changed meaning
        "Reports bowel changes",  # stitched from words that do appear
        "",
        " ... ",
    ],
)
def test_locate_rejects_anything_not_in_the_source(quote):
    assert locate(quote, NOTE) is None


def test_locate_span_excludes_trimmed_edges():
    start, end = locate("  'no relief.'  ", NOTE)
    assert NOTE[start:end] == "no relief"


def test_html_to_text_keeps_structure():
    html = (
        "<p>Red flags include:</p><ul><ul><li>Fever</li></ul><ul><li>Saddle&nbsp;anesthesia</li>"
        "</ul></ul><p>At least <strong> four weeks</strong>.<br />Next&rsquo;s line</p>"
    )
    assert html_to_text(html) == (
        "Red flags include:\n\n- Fever\n\n- Saddle anesthesia\n\nAt least four weeks.\nNext’s line"
    )
