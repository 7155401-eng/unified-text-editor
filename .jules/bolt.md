## 2026-05-13 - [style_registry.js Cache Optimization]
**Learning:** The style registry was repeatedly calling synchronous I/O (`localStorage.getItem`) and expensive parsing (`JSON.parse`) on every element style application, creating a severe bottleneck during dense page renders. Memory caching for static/rarely-changing global configurations is highly effective, but cross-tab synchronization must be handled manually via the `storage` event to prevent stale states in multi-window environments.
**Action:** When implementing global configuration managers, always use an in-memory cache variable backed by `localStorage` rather than querying `localStorage` continuously. Ensure cache invalidation logic is robust (both local updates and cross-tab `storage` events).

## 2026-05-15 - [Layout Engine DOM Query Optimization]
**Learning:** Using `querySelectorAll('*')` during layout recalculations (such as page shrinking in `talmud_pull_backward.js`) causes severe performance degradation due to forced synchronous layouts across thousands of descendants.
**Action:** When finding the maximum bottom boundary of elements, query specific structural container classes (`.talmud-main`, `.stream`, `.talmud-body-portion`, etc.) instead of `*`. This limits iteration to key layout blocks and naturally excludes problematic inline text nodes (like `.v9-line`) that cause sub-pixel layout false positives.
