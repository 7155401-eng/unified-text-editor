# V9 bridge-line state — 2026-05-20

## Baseline

Current baseline before the unified fix:

- `main` commit: `597a5c64f1e962acdf4e05c997ad8b734076bf15`
- Symptom: when two side columns are active, V9 can create two or more full-width centered/commentary lines under both columns.
- User rule: a centered/full-width bridge under two side columns may be only one remainder line. If there are 2+ lines, the extra lines must remain inside the side column or overflow onward.

## Root cause found

The issue is not only the creation of strip 3b. It is the combination of:

1. `buildSideStream` creates a full-width strip from `otherEndY` to `pageBottomY`.
2. `flowStreamThroughStrips` originally did not respect strip `y_end`.
3. `flowStreamThroughStrips` can pull a later wider strip upward by rewriting its `y_start`.
4. Previous patch scripts touched the same flow metadata in different ways, so a patch could silently miss either `y_end` or `lockYStart`.

## Required invariant

A valid V9 bridge-line fix must ensure all of these are present together:

- flow respects `strip.y_end`.
- flow refuses to pull a wider strip upward when `lockYStart === true`.
- side-stream strips pass both `y_end` and `lockYStart` into the flow.
- `buildSideStream` caps the full-width bridge strip to `maxFullStrip3Lines`.
- Pass 2 passes `maxFullStrip3Lines: 1` whenever another side stream is active.
- build must fail loudly if any invariant is missing.

## Intended outcome

In a two-column side-stream layout, full-width commentary lines under the columns cannot exceed one line. Extra text remains in the side column or overflows to the next page.
