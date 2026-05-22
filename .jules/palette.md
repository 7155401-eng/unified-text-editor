
## 2024-05-18 - Missing ARIA Labels on Symbol-Only Controls
**Learning:** Symbol-only buttons and selects without visible labels often lack screen reader support. Explicit `aria-label` attributes are necessary so screen readers don't announce literal punctuation (e.g., 'Left pointing double angle quotation mark') for symbol icons, ensuring the function is clearly communicated.
**Action:** Always add explicit `aria-label`s to unlabelled inputs (`<select>`, `<input>`) and icon-only or symbol-only `<button>`s to ensure accessibility.
