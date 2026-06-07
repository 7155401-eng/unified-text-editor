## 2024-05-18 - Missing ARIA Labels on Toolbar Buttons
**Learning:** Icon-only buttons or buttons with cryptic textual representations (like "❝" for blockquote or "12" for size) must have `aria-label` attributes to be accessible to screen readers, even if they already have `title` attributes (which are mainly for visual tooltips).
**Action:** Always verify that icon-only buttons have descriptive `aria-label` attributes.
