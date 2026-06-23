## 2024-05-19 - Added missing ARIA labels to icon-only buttons
**Learning:** Icon-only buttons (like `blockquote`, `code-block`, and AI key toggles) that rely exclusively on `title` attributes lack proper accessibility context for screen readers in this UI.
**Action:** When creating or updating icon-only buttons, ensure an `aria-label` is always provided alongside the `title` attribute to maintain keyboard accessibility and screen reader support.
