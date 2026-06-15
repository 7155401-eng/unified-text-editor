## 2026-06-15 - Adding ARIA labels to Toolbar Elements
**Learning:** Certain toolbar elements in the editor app (like H1-H6, blockquote, and code-block buttons) only relied on their text or default symbol and `title` without having `aria-label` applied for proper screen reader support, even when some had descriptive titles. Also H1-H6 didn't have `title` applied.
**Action:** Always ensure that icon-only, symbol, or abbreviation buttons (e.g., "H1", "❝") in text editors include both a user-facing `title` and a properly translated Hebrew `aria-label` attribute (e.g. `aria-label="כותרת רמה 1"`).
