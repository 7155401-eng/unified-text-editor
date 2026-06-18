## 2026-06-16 - AI Key Toggles Need ARIA Labels
**Learning:** Found multiple AI key visibility toggle buttons ('👁' emoji) that lacked aria-labels, making them inaccessible to screen readers since they rely solely on a visual icon and a generic 'title' attribute. This is an accessibility issue specific to these components.
**Action:** Always ensure that icon-only toggle buttons include an 'aria-label' to provide clear context (e.g. 'הצג/הסתר מפתח').
