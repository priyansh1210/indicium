# Indicium web: design direction ("Highlighter")

Visual thesis: **every judgement points at a highlighted line in the chart.** A utilization nurse
opens Indicium to decide one request. The policy sits on the left as a checklist; the clinical
notes sit on the right as a document. Each checklist item carries a status in words and the
exact sentence that supports it, and choosing the item marks that sentence in the note, like a
highlighter on paper. Nothing is claimed that cannot be pointed at.

Audience and task: nurses and physician reviewers reading for long stretches, under deadlines,
accountable for each decision. Density and calm over spectacle. One primary action per screen.

Signature: **the highlighter stroke.** One gesture carries the brand and the meaning. It sweeps
left to right under the wordmark, under the current page in the navigation, over the evidence
being looked at, and over the policy sentence a criterion came from. It never decorates
anything that is not "here" or "this is the evidence".

Two surfaces, one system: the **welcome page** (`/welcome`, the front door for visitors without
a session) explains the product with the product itself; the **app** is the reading tool.

## Type

| Role | Face / size / weight | Use |
| --- | --- | --- |
| Display | Source Serif 4 (optical size), 46–100 / 600, -0.02em | welcome headlines, sign-in |
| Page title | Source Serif 4, 32–40 / 600 | one per screen: the patient on a case, "Worklist" |
| Section heading | Source Serif 4, 22 / 600, sentence case | "Checklist", "Documents", "Decision" |
| Label | Public Sans 13 / 600, ink-2, sentence case | "Recommendation", field labels; no uppercase eyebrows |
| Body / UI | Public Sans 15 / 400, line-height 1.5 | controls, checklist text, tables |
| Note text | Source Serif 4, 16 / 400, line-height 1.7 | clinical documents: they read as documents |
| Codes | IBM Plex Mono 13 / 500 | CPT, HCPCS, ICD-10, ids |
| Meta | Public Sans 13 / 400, ink-2 | timestamps, authors, help text |

Public Sans (the US government's typeface, used across CMS sites) fits a coverage-review tool;
Source Serif 4 makes notes feel like the chart they come from. All three are SIL OFL, self-hosted
through next/font.

## Colour (tokens in `app/globals.css`; text pairs checked for WCAG AA)

| Token | Value | Role |
| --- | --- | --- |
| canvas | #F3F1EC | warm paper: page background |
| paper | #FFFFFF | the sheets the work sits on |
| tint | #F7F5F0 | quiet fills: table hover, empty states, discarded quotes |
| ink / ink-2 | #1D1C1A / #5B5852 | primary / secondary text |
| rule | #E4E0D8 | hairlines |
| accent / accent-soft | #2A4F7A / #E6EDF5 | the one action colour: buttons, links, focus, selection |
| marker / marker-strong | #FCEB9C / #F5CF45 | evidence highlight / the highlight being looked at |
| met | #2E6A44 on #E5F1E8 | "Documented" |
| unmet | #A2382D on #F8E7E4 | "Contradicted", overdue, refused, suspicious text |
| missing | #7A5914 on #F7EFDC | "Not documented" |
| conflict | #6A4A93 on #EFE9F6 | "Notes disagree" |
| ink-3 | #8A857C | large text only (inactive step titles); fails AA below 18px |
| chart / chart-muted | #3B6AA3 / #B3ADA2 | result bars: the default configuration and its context (dataviz validator: lightness and CVD pass) |

Status colours appear only with their word beside them, never as decoration.

## Layout

- Welcome: hero (headline, the review screen in miniature), how a review works (four steps
  beside a sticky stage), guarantees with the file or constraint that enforces each, results
  from the eval runs (two bar charts and a table), one closing call to action.
- Sign-in: the email form first ("Forgot your password?" beside the password label; a code
  field appears only when the account has two-step sign-in). Sample accounts sit in a closed
  disclosure below it, each with what the role may do, and exist only in demo mode.
- Password links (invite, reset, verify) and registration share the sign-in frame: display
  title, one lead sentence, one form.
- Account and admin: settings rows (title and why on the left, the control on the right);
  admin tabs People, API keys, Activity. Hard-to-undo buttons ask once more in place
  ("Confirm deactivate") instead of a dialog. Secrets and links shown once sit in a field with
  Copy.
- Top bar: wordmark, Worklist, Policies; the signed-in person and role at the right.
- Worklist: tabs by status with counts, then one table, soonest deadline first. Each deadline
  has a bar of the decision window used (amber in the last quarter, red when overdue). The
  whole row opens the case. The status column appears only when a view mixes statuses. On a
  phone rows stack.
- Case: header (patient, service, policy, deadline), the recommendation with its reasons, then two
  columns from 1100px: checklist (left, scrolls) and documents (right, sticky). Below 1100px the
  documents follow the checklist. The decision panel sits at the end of the checklist.
- Sheets: white, radius 12, one hairline border; no nested cards, no shadows. Hairline rules
  and proximity group things before a sheet does.

## Motion

Motion explains cause and effect, or tells a sequence; nothing loops, nothing waits for it.
One easing (`--ease-out`, quick out, long settle) everywhere.

- App: choosing a checklist item sweeps its sentence in the note and centres it inside the
  document panel (the page itself does not jump); choosing a highlight brings its item into
  view. Page openings settle in once (`.rise`, 420 ms, rows staggered 35 ms, capped). Controls
  use CSS transitions only. No smooth scrolling in the app: it is a reading tool.
- Welcome: GSAP 3.15 for the hero intro (headline word by word, then the example) and for
  section headings rising once as they arrive; result bars grow from their baseline. Lenis 1.3
  is the one smooth-scroll engine, driven by GSAP's ticker and connected to ScrollTrigger,
  destroyed on leave. GSAP and Lenis load only on the welcome page. The steps use an
  IntersectionObserver, not a pinned timeline, so nothing traps the scroll.
- Every animated thing is complete without JavaScript. The hero's first frame is set by CSS
  before hydration, with a 3 s fallback that reveals it if the intro never runs.
- `prefers-reduced-motion: reduce`: no intro, no smooth scroll, no sweeps; final states at once.
- No WebGL or Three.js: nothing here is spatial, and a shader would only decorate.

## Icons and imagery

Solar icons (480 Design, CC BY 4.0), copied as inline SVG for the few the app uses, always next to
words. No illustrations, no avatars, no stock imagery: the product's content is the document.
The welcome page's pictures are the product's own components rendering the synthetic case
tka-01 and the LCD L36575 text; quote positions are computed from the text, never typed.
