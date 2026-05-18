// Temporary guard during measured V9 opening-word integration.
//
// Opening words must be calculated inside src/vilna_v9.js before line/page
// decisions are made. A post-render pass mutates absolute-positioned V9 lines
// after pagination and can therefore break pages. This module remains only to
// keep existing imports stable while the measured integration is being wired.

export function applyV9OpeningWordsFromMetadata(container) {
  const result = { applied: 0, reason: "disabled-until-measured-in-vilna-v9" };
  if (container?.dataset) container.dataset.v9OpeningWords = JSON.stringify(result);
  if (typeof window !== "undefined") window.__ravtextLastV9OpeningWords = result;
  return result;
}
