## 2026-05-19 - Added ARIA labels to icon-only buttons
**Learning:** Purely icon-based buttons like quote, code-block, code-inline, and unlink often lack `aria-label` attributes, making them inaccessible to screen readers despite having a `title` attribute.
**Action:** Always ensure that buttons without visible text contain descriptive `aria-label` attributes to improve accessibility and conform with standard UX guidelines.
