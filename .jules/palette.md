## 2025-05-23 - Accessibility of AI Key Toggles
**Learning:** Icon-only buttons used for settings or sensitive fields (like showing/hiding API keys with an eye icon) often lack proper screen reader context because they have no visible text.
**Action:** Always add `aria-label` to icon-only buttons like the eye icon (👁) toggle buttons in settings panels.
