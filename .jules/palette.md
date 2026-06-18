## 2026-06-18 - Add ARIA Labels to Settings Toggles
**Learning:** Found multiple instances where the AI keys toggle buttons in the Settings pane were missing `aria-label`. These elements only contain a text icon ('👁'), meaning that without a designated accessible name, screen readers will read the symbol rather than the action.
**Action:** Always ensure that interactive elements that contain only an icon or symbol receive an explicit `aria-label` to expose their function to assistive technologies.
