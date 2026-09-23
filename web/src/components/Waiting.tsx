/**
 * The pips that say the game is still thinking.
 *
 * A model call is 5–15 seconds and an end-turn nearer 38, and what the player
 * had was a static italic line. A label that does not move is indistinguishable
 * from a label that is stuck, which is the same failure the progress labels
 * were added to fix one level up: *"without it the app looks broken while
 * working perfectly."* The label says what is happening; this says it is still
 * happening.
 *
 * **Squares, not a spinner.** Everything drawn in this game is pixels and
 * crisp-edged SVG, and a rotating arc is the one shape that cannot be — it
 * belongs to a different program. Three blocks lighting in sequence is the same
 * idea in this game's own alphabet, costs no library, and animates in CSS so it
 * keeps running while the main thread is busy parsing a large state payload.
 *
 * The label carries `aria-live`, and the pips are hidden from it: a screen
 * reader should hear "Resolving your action" once, not a decorative animation
 * three times a second.
 */
export function Waiting({ label }: { label: string }) {
  return (
    <>
      {label}
      <span className="pips" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </>
  );
}
