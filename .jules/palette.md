## 2024-06-19 - Missing ARIA labels on Icon-only buttons
**Learning:** Found multiple icon-only buttons in index.html (like the PDF download buttons, AI key toggles, table formatting, and text editor buttons) that have a `title` attribute but are missing an `aria-label`. The `title` attribute is often not consistently read by screen readers, making icon-only buttons inaccessible.
**Action:** Adding `aria-label` attributes to these buttons so screen reader users understand what these buttons do. I will use the text from the `title` attribute to populate the `aria-label`.
