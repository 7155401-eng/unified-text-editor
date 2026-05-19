// Reverted on 2026-05-19.
// This patch previously changed V9 side-stream endY and regressed the left-stream bridge expansion.
// Keep this file inert so older package hooks or manual runs cannot reapply the broken patch.
console.log("[v9-side-stream-end-y-guard] disabled: reverted after left-stream expansion regression");
