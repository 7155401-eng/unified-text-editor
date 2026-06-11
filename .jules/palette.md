## 2025-06-11 - Add ARIA Labels to Icon-Only Buttons
**Learning:** In index.html, several icon-only buttons (like UI formatting tools and settings toggles) relied solely on visual title attributes, making them inaccessible to screen readers in this RTL/Hebrew application.
**Action:** Always add matching aria-label attributes to ensure semantic keyboard and screen reader accessibility alongside visual tooltips.
