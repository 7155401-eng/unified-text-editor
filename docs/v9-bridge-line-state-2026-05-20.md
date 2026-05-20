# V9 bridge-line state — 2026-05-20

## Baseline

Current baseline before the unified fix:

- `main` commit before the first unified bridge fix: `597a5c64f1e962acdf4e05c997ad8b734076bf15`
- Symptom: when two side columns are active, V9 can create two or more full-width centered/commentary lines under both columns.
- User rule: a centered/full-width bridge under two side columns may be only one remainder line. If there are 2+ centered/orphan bridge lines, the extra lines must remain inside the side column or overflow onward.

## Root cause found

The issue was not only the creation of strip 3b. It was the combination of:

1. `buildSideStream` creates a full-width strip from `otherEndY` to `pageBottomY`.
2. `flowStreamThroughStrips` originally did not respect strip `y_end`.
3. `flowStreamThroughStrips` can pull a later wider strip upward by rewriting its `y_start`.
4. Previous patch scripts touched the same flow metadata in different ways, so a patch could silently miss either `y_end` or `lockYStart`.

## Important correction after testing

A later regression showed that `strip 3b` itself must **not** always be capped to one line.

There are two distinct cases:

1. **Distinct side streams** — for example stream `01` on the right and stream `02` on the left. When one side ends, the surviving side stream is allowed to continue in full width down the lower part of the page. This is valid Vilna behavior and must be preserved.
2. **Same-stream split / bridge remainder** — for example `one_long_split`, where one stream is split into two side columns. Here the full-width bridge/orphan under the two columns may be only one remainder line.

Therefore the safe invariant is:

- Always pass and respect `y_end`.
- Always pass and respect `lockYStart` so a full-width strip cannot be pulled above the other side's real end.
- Apply `maxFullStrip3Lines: 1` only for same-stream split/bridge cases.
- Do **not** apply the one-line cap to distinct side streams; keep their valid full-width continuation.
- Build must fail loudly if any invariant is missing.

## Intended outcome

In a same-stream two-column bridge, full-width centered/orphan lines under the columns cannot exceed one line. In a distinct-stream layout, the stream that survives after the other side ends still expands to full width for the lower part of the page.
