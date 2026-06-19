## 2024-05-15 - ARIA label for dynamically created modals
**Learning:** Found that dynamic modals created via standard DOM scripting in src/inbox_forms.js were lacking accessibility attributes on their close buttons. Since these are instantiated imperatively rather than in HTML, it's a pattern to watch out for across other similar imperative UI components in the app.
**Action:** Always ensure aria-label and title are explicitly set via setAttribute() or element properties when dynamically constructing icon-only buttons via JS.
