# Indicium web: design direction ("Highlighter")

Visual thesis: **every judgement points at a highlighted line in the chart.** A utilization nurse
opens Indicium to decide one request. The policy sits on the left as a checklist; the clinical
notes sit on the right as a document. Each checklist item carries a status in words and the
exact sentence that supports it, and choosing the item marks that sentence in the note, like a
highlighter on paper. Nothing is claimed that cannot be pointed at.

Audience and task: nurses and physician reviewers reading for long stretches, under deadlines,
accountable for each decision. Density and calm over spectacle. One primary action per screen.

## Type

| Role | Face / size / weight | Use |
| --- | --- | --- |
| Page title | Source Serif 4, 28 / 600 | one per screen: the patient on a case, "Worklist" |
| Section heading | Public Sans 13 / 600, uppercase, 0.04em | "Checklist", "Documents", "Decision" |
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

Status colours appear only with their word beside them, never as decoration.

## Layout

- Top bar: wordmark, Worklist, Policies; the signed-in person and role at the right.
- Worklist: one table, soonest deadline first, filters as a segmented control above it.
- Case: header (patient, service, policy, deadline), the recommendation with its reasons, then two
  columns from 1100px: checklist (left, scrolls) and documents (right, sticky). Below 1100px the
  documents follow the checklist. The decision panel sits at the end of the checklist.
- Sheets: white, radius 12, one hairline border; no nested cards, no broad shadows.

## Motion

Only to explain cause and effect: choosing an item scrolls its sentence into view and the mark
deepens for a moment. Under `prefers-reduced-motion` the scroll is instant and the mark static.
No entrance choreography, smooth-scroll engine or WebGL: this is a reading tool, and the
`build-awwwards-quality-sites` motion stack is for marketing pages, not for a nurse's queue.

## Icons and imagery

Solar icons (480 Design, CC BY 4.0), copied as inline SVG for the few the app uses, always next to
words. No illustrations, no avatars, no stock imagery: the product's content is the document.
