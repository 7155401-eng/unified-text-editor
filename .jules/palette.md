## 2026-07-02 - ARIA labels for AI key visibility toggles
**Learning:** Found multiple icon-only buttons ("👁") acting as password visibility toggles for AI API keys in settings that only used `title` attributes. This pattern relies entirely on hover states and is inaccessible to screen readers.
**Action:** Always add descriptive `aria-label`s (e.g. `aria-label="הצג/הסתר מפתח"`) to standalone icon-only toggle buttons, especially those managing sensitive inputs like API keys.
