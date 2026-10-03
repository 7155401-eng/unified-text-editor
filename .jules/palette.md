## 2024-03-24 - Empty State Render Button
**Learning:** The "empty-hint" state for the rendered pages panel has a button with ID `empty-hint-render`. This button provides a clear CTA when the pages aren't rendered, but it feels abrupt without loading feedback since rendering can take a moment.
**Action:** Add a loading state (e.g. disabled state and visual change) to the `empty-hint-render` button when clicked.
## $(date +%Y-%m-%d) - Empty Hint Render Button Loading State
**Learning:** The "empty-hint" state for the rendered pages panel has a button with ID `empty-hint-render`. This button provides a clear CTA when the pages aren't rendered, but it feels abrupt without loading feedback since rendering can take a moment.
**Action:** Hook `empty-hint-render` into the `render_pause_controls.js` state machine to give it an `aria-busy` attribute, disable it, and add a loading animation/text while building the preview.
