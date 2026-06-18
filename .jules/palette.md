## 2024-05-18 - [Added ARIA Labels to Icon-Only Buttons]
**Learning:** Found multiple icon-only buttons (like AI Key visibility toggles, text formatting buttons, layout stress testing buttons) in `index.html` that only had `title` attributes but no `aria-label`. Relying solely on `title` is often insufficient for robust screen reader support.
**Action:** Always ensure that any button without meaningful text content explicitly provides an `aria-label` attribute, even if it already has a `title` attribute for tooltips.
