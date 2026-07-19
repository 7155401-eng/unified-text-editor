## 2024-06-27 - Adding ARIA labels to Toolbar Icon Buttons
**Learning:** Icon-only buttons used in the WYSIWYG editor toolbar (`index.html`) such as blockquote and inline code require `aria-label`s for screen reader users, as standard visual tooltips (`title` attribute) alone are insufficient for accessibility.
**Action:** When adding or maintaining toolbar icon buttons, ensure both `title` (for mouse hover) and `aria-label` (for screen readers) are consistently included.
