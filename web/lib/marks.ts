export type Mark = { start: number; end: number; criterion?: string; suspicious?: boolean };
export type Segment = { text: string; criteria: string[]; suspicious: boolean };

/** Cut a document into runs of text, each with every mark that covers it (marks may overlap). */
export function segments(text: string, marks: Mark[]): Segment[] {
  const valid = marks.filter((m) => m.start >= 0 && m.end <= text.length && m.start < m.end);
  const cuts = [...new Set([0, text.length, ...valid.flatMap((m) => [m.start, m.end])])].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];
    const covering = valid.filter((m) => m.start <= from && m.end >= to);
    out.push({
      text: text.slice(from, to),
      criteria: [...new Set(covering.flatMap((m) => (m.criterion ? [m.criterion] : [])))],
      suspicious: covering.some((m) => m.suspicious),
    });
  }
  return out;
}

/** Centre `target` inside the scrolling `panel` without moving the page around it. */
export function centreIn(panel: HTMLElement, target: HTMLElement, behavior: ScrollBehavior) {
  const p = panel.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  panel.scrollBy({ top: t.top - p.top - (panel.clientHeight - t.height) / 2, behavior });
}
