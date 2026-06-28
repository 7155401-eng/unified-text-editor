## 2026-05-13 - [style_registry.js Cache Optimization]
**Learning:** The style registry was repeatedly calling synchronous I/O (`localStorage.getItem`) and expensive parsing (`JSON.parse`) on every element style application, creating a severe bottleneck during dense page renders. Memory caching for static/rarely-changing global configurations is highly effective, but cross-tab synchronization must be handled manually via the `storage` event to prevent stale states in multi-window environments.
**Action:** When implementing global configuration managers, always use an in-memory cache variable backed by `localStorage` rather than querying `localStorage` continuously. Ensure cache invalidation logic is robust (both local updates and cross-tab `storage` events).

## 2026-05-18 - [Configuration Module Caching]
**Learning:** Modules like `src/spacing_settings.js` and `src/document_style_settings.js` suffer from severe performance bottlenecks during layout/rendering loops due to synchronous `localStorage.getItem` and `JSON.parse` calls.
**Action:** Always implement an in-memory cache variable synced via the `storage` event (checking `e.key === null` for clears). Ensure the cache returns shallow copies (e.g., `{ ..._cache }`) to prevent caller mutations while avoiding the overhead of `JSON.parse(JSON.stringify(cache))` deep cloning.
