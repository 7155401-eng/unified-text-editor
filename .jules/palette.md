## 2026-05-18 - Missing ARIA Labels on Icon-only Buttons
**Learning:** Found multiple icon-only buttons (like ✕ for close, 👁 for toggle visibility, and toolbars buttons with emojis) missing `aria-label`s. Even if buttons have `title`s, `aria-label` ensures maximum accessibility compatibility. Toolbars with many actions are prone to this.
**Action:** Always verify custom panels (`custom_styles.js`, `css_inject_panel.js`) for missing a11y labels when adding features with close buttons.
