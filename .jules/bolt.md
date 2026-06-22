## 2026-05-13 - [style_registry.js Cache Optimization]
**Learning:** The style registry was repeatedly calling synchronous I/O (`localStorage.getItem`) and expensive parsing (`JSON.parse`) on every element style application, creating a severe bottleneck during dense page renders. Memory caching for static/rarely-changing global configurations is highly effective, but cross-tab synchronization must be handled manually via the `storage` event to prevent stale states in multi-window environments.
**Action:** When implementing global configuration managers, always use an in-memory cache variable backed by `localStorage` rather than querying `localStorage` continuously. Ensure cache invalidation logic is robust (both local updates and cross-tab `storage` events).

## $(date +%Y-%m-%d) - Optimize localStorage.getItem calls
**Learning:** Configurations like spacing settings (`loadSpacingSettings`) and document styles (`loadDocumentStyleSettings`) are called frequently during layout and rendering loops. Querying `localStorage` directly in these functions causes severe synchronous I/O and JSON parsing bottlenecks.
**Action:** Always implement an in-memory cache synchronized with cross-tab `storage` events. Return shallow copies (`{ ...cachedSettings }`) to prevent shared state mutation by consumers, ensuring performance without sacrificing correctness.
