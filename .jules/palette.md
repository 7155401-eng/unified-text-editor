## 2024-06-24 - Accessibility improvements for icon-only buttons
**Learning:** Found multiple icon-only formatting buttons in `index.html` (e.g. `H1-H6`, `blockquote`, `code-block`) lacking `aria-label`s, rendering them inaccessible to screen readers. They only had `title` attributes.
**Action:** When adding new icon-only buttons, ensure both `title` and `aria-label` are present for a fully accessible experience.
