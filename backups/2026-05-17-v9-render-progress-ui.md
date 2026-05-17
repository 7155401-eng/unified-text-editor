# Backup: V9 luxury render progress UI

Date: 2026-05-17

## Commits

- UI helper added: `fa9f9ba5619c4cc86736e6f3af4ccb8133242ac6`
- V9 wiring added: `160c05bd088b09899fca17ab82f82c035cfd9810`

## Files changed

- `src/render_progress_ui.js`
- `src/vilna_v9_apply.js`

## What changed

Added a luxury, subtle, glass-style render progress card for the new V9 renderer.

It shows:

- Render status
- Current built page count
- Estimated progress percentage
- Total built pages at finish
- Smooth shimmer/progress animation

It automatically closes shortly after render completion.

## Safety design

The progress UI does not modify `vilna_v9.js` pagination internals.

Instead it watches real `.page` creation inside the V9 container using `MutationObserver`, which avoids touching the V9 pagination algorithm and keeps the change low-risk.

## Runtime behavior

`applyVilnaV9FromPaneManager` now:

1. Hides any previous progress UI.
2. Starts a new progress session before clearing/rebuilding the container.
3. Runs `buildPages` normally.
4. Finishes the progress UI when V9 completes.
5. Aborts/hides the progress UI if V9 is superseded by a newer render token.
6. Hides the UI and rethrows if V9 throws an error.

## Verification checklist

1. Enable V9/Gemara layout.
2. Trigger a render on a multi-page document.
3. Confirm a small luxury progress card appears at the top.
4. Confirm page count increases while pages are created.
5. Confirm it closes automatically after render completion.
6. Change a setting during render and confirm old progress UI aborts cleanly.
