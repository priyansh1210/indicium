/** Runs before hydration: marks the page so CSS can hold the hero at its first frame for the
 *  intro. Skipped under reduced motion; a CSS fallback reveals everything if the intro never runs. */
export const INTRO =
  "if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.currentScript.parentElement.dataset.intro='1'";

/** A heading whose words can rise one by one. Screen readers get the sentence once; the split
 *  copy is decorative. Without JavaScript the words simply sit there. */
export function Split({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(" ").map((word, i) => (
          <span key={i}>
            <span data-word className="inline-block overflow-hidden pb-[0.08em] align-bottom">
              <span className="inline-block">{word}</span>
            </span>{" "}
          </span>
        ))}
      </span>
    </>
  );
}
