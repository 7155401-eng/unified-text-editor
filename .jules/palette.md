
## 2026-06-29 - Add missing ARIA labels to icon-only buttons
**Learning:** In the Hebrew editor toolbar, many icon-only buttons (like blockquote, code, and unlink) lacked `aria-label` attributes, which reduces accessibility for screen reader users, even when `title` attributes were present.
**Action:** Always ensure that icon-only buttons, especially those using symbols like ❝, ⟨/⟩, or { }, have explicit `aria-label` attributes corresponding to their function (e.g. `aria-label="ציטוט"`).
