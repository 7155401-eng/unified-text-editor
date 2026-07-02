## 2026-05-13 - [style_registry.js Cache Optimization]
**Learning:** The style registry was repeatedly calling synchronous I/O (`localStorage.getItem`) and expensive parsing (`JSON.parse`) on every element style application, creating a severe bottleneck during dense page renders. Memory caching for static/rarely-changing global configurations is highly effective, but cross-tab synchronization must be handled manually via the `storage` event to prevent stale states in multi-window environments.
**Action:** When implementing global configuration managers, always use an in-memory cache variable backed by `localStorage` rather than querying `localStorage` continuously. Ensure cache invalidation logic is robust (both local updates and cross-tab `storage` events).
## 2024-05-19 - Synchronous Layout Storage Bottle-necks

**Learning:** `localStorage.getItem` mixed with `JSON.parse` is highly destructive inside layout or rendering calculation blocks, as they evaluate synchronously on a global scope and drastically damage the frontend performance overall frame rate.

**Action:** Whenever using `localStorage` configs inside formatting/rendering/resizing logics, wrap the calls under global-scope memory caching definitions along with logic updating those caches listening to the window's `storage` event to preserve layout flow speed. Additionally, clone deeply using shallow variables copying rather than native JSON operations when returning such cache objects directly.
