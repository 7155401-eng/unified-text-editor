# V9 combined handoff: opening words + breaks + connector strip

Branch: `handoff-v9-combined-opening-breaks`
Base: current `main` at creation time, commit `25946b10f110b014f04ea4b220d7c8896c3007db`.

This branch is a handoff branch, not a finished fix. It intentionally avoids a full replacement of `src/vilna_v9.js`.

## Goal

Merge the correct non-conflicting parts of two work streams:

1. Opening words in V9.
2. V9 page fullness / adjustable safe breaks / stream connector strip.

When the two streams conflict, prefer the version that is part of V9 pagination and measurement, not a post-render visual patch.

---

## Decisions already made

### Preferred: one opening-word engine

Use `src/opening_word.js` as the source of truth for opening-word extraction and settings. V9 must not duplicate the extraction logic.

A helper was added on this branch:

`src/engine/v9_opening_word_layout_model.js`

It imports from `opening_word.js` and builds a layout model for V9. The next bot should wire this model into `src/vilna_v9.js` or into the pre-`buildPages` preparation path.

### Preferred: measured V9 integration

Opening words must be known before V9 decides line breaks and page breaks.

Do not rely on:

- first visual line of page;
- first line of stream;
- `applyOpeningWordsToPages` after V9 layout;
- a helper that mutates `.v9-line` after pagination.

### Temporary existing behavior in main

`main` currently contains a post-render V9 opening-word helper from earlier work. That is not the final architecture. It exists only because measured integration is not completed yet.

For the final fix, either:

- remove/disable post-render V9 opening words after measured integration works; or
- make that function a no-op for V9 once `vilna_v9.js` renders already-measured opening words.

### Paragraph split rule for opening words

A paragraph split by V9 is not a new paragraph.

Opening word applies only when:

- source paragraph start is true;
- continuation is false;
- the line belongs to the original paragraph start, not to the top of a page.

Use the metadata introduced in PR #363 as a temporary diagnostic. The stronger final solution is for `vilna_v9.js` to carry paragraph metadata internally when creating lines.

---

## Work stream A: opening words in V9

### What is correct from my work

- `opening_word.js` must remain the shared source.
- V9 must call the shared extraction/settings logic.
- Opening word application based on page top is wrong.
- The helper file added on this branch is safe as a shared model starting point:
  `src/engine/v9_opening_word_layout_model.js`.

### What is incomplete

The model is not yet wired into `src/vilna_v9.js`. It must be used before line/page decisions.

### Required implementation

In `src/vilna_v9.js`, during the main-text paragraph flow:

1. Detect true source paragraph start.
2. Skip if the paragraph object is `_continues` or `_emergencySplit`.
3. Build an opening-word model with `buildV9OpeningWordLayoutModel`.
4. Measure the first line with the opening word already accounted for.
5. Render the line with the model that was already measured.
6. Do not mutate `.v9-line` after page layout.

### Acceptable intermediate if direct `vilna_v9.js` patch is difficult

A pre-`buildPages` reservation approach may be acceptable only as a temporary bridge:

- reserve approximate width before `buildPages`;
- render using the same reserved position;
- do not change line widths after pagination.

But the final preferred version is direct measurement inside `vilna_v9.js`.

---

## Work stream B: adjustable breaks and connector strip

This comes from the other bot's work and should be integrated separately from opening words.

### Correct ideas to keep

1. `Adjustable Safe Breaks`
   - If a visual line end is not available, V9 should check whether a nearby word boundary can look like a valid line end after bounded spacing.
   - This should reduce bad half-line endings and ugly page cuts.

2. `Gap rescue` should consider adjustable candidates, but still must go through:
   - `buildPagePlan`;
   - `notesBeforeAnchor`;
   - `notesFromAnchor`.

3. `Stream connector strip`
   - When a side stream transitions below the main text to full width, it should not jump directly to full width.
   - Keep at least one narrow connector line first.
   - Then allow full-width expansion.

4. `mainBottomGapPx`
   - Add default in V9 config: `mainBottomGapPx: 16`.
   - Pass from `vilna_v9_apply.js`:
     `mainBottomGapPx: readIntSetting("ravtext.talmudLayout.mainBottomGap", 16, 0, 60)`.

### Known failure from the other bot

The local patch inserted helper functions at an invalid syntax position near `safeBreakCandidates`, because it detected the `{}` in `opts = {}` as if it were the function body. This caused Vite error:

`Expected ',', got 'function'`

Do not reuse that broken script as-is.

### Correct patch shape for `safeBreakCandidates`

Place helper functions only after the full `safeBreakCandidates(...) { ... }` function ends.

Required helper names:

- `acceptableV9AdjustedBreakTail`
- `adjustableSafeBreakCandidates`

Required usage points:

- regular split candidate generation;
- emergency/continuation candidate generation if applicable;
- gap rescue candidate generation.

Avoid the old unsafe path:

- `const candidates = wordEndCandidates(fullText)` in normal path;
- direct word-end fallback unless explicitly allowed by policy.

### Correct patch shape for connector strip

In `buildSideStream`, replace the immediate full-width Strip 3 transition with:

1. narrow side-width strip under the main text if needed;
2. then full-width strip.

Core logic from the other bot to preserve:

```js
const streamMetricsForConnector = getSideMetricsForStream(streamData.id);
const connectorLineH = Math.max(
  streamMetricsForConnector.lineHeight || (cfg.sideFontSize * 1.35),
  cfg.sideFontSize * 1.35
);

const mainBottomGapPx = Math.max(
  0,
  Math.min(60, Number(cfg.mainBottomGapPx) || 16)
);

const connectorHeight = Math.max(connectorLineH, mainBottomGapPx);
```

Then:

- keep half-width if the other side is still active;
- if moving to full width, insert a narrow connector strip first;
- start the full strip only after that connector.

---

## What not to merge

Do not merge these as final solutions:

1. Build-time patch scripts that rewrite `src/vilna_v9.js` before build.
2. Post-render opening-word mutations for V9 as the final architecture.
3. Full-file replacement of `src/vilna_v9.js` unless working from a fresh clone and verifying diff carefully.
4. Local user-machine state as source of truth.
5. Any patch that changes non-V9 behavior unless explicitly intended.

---

## Recommended next steps for the next bot

1. Start from this branch.
2. Rebase on latest `main` if needed.
3. Open `src/vilna_v9.js` in a real working tree, not through full-file API replacement.
4. Apply the opening-word model inside the V9 measurement path.
5. Apply adjustable safe breaks after `safeBreakCandidates` without breaking syntax.
6. Apply connector strip inside `buildSideStream`.
7. Add `mainBottomGapPx` default and pass-through.
8. Run:
   - `npm run build`
   - a V9 render on the problematic document
   - debug export checks
9. Only then open PR.

---

## Test checklist

### Opening words

- Opening words appear at true paragraph starts.
- No opening word appears merely because a page starts.
- A paragraph split by V9 does not get a second opening word on the next page.
- The opening-word output uses rules from `opening_word.js`.
- Page breaks do not shift after opening words are visible.

### Breaks and page fullness

- No pages with only one tiny main line unless physically unavoidable.
- Last line before page break is not an ugly half-line when a better adjusted candidate exists.
- Gap rescue does not move notes ahead of their anchors.
- Notes remain with the relevant main text when possible.

### Streams

- Side streams do not jump directly to full-width below the main text.
- A narrow connector line appears first when transitioning to full width.
- Bottom stream/footer area is not compressed too tightly under the main text.
- Full-width expansion still happens after the connector.

### Safety

- `npm run build` passes.
- No conflict markers.
- No build-time rewriting scripts required.
- Diff is limited to V9/opening-word related files.
