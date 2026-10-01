export function partitionFrontMatterContent(content, paneManager) {
  const all = Array.isArray(content) ? content : [];
  const introPanes = typeof paneManager?.getIntroPanes === "function"
    ? paneManager.getIntroPanes()
    : (paneManager?.panes || []).filter(p => p.paneRole === "intro");

  const introIds = new Set(introPanes.map(p => String(p.id || "")).filter(Boolean));
  const byPane = new Map(introPanes.map((p, index) => [
    String(p.id || ""),
    { paneId: String(p.id || ""), label: p.label || `הקדמה ${index + 1}`, content: [] },
  ]));
  const body = [];
  const orphanIntro = [];

  for (const item of all) {
    if (item?.paneRole !== "intro") {
      body.push(item);
      continue;
    }
    const id = String(item?.paneId || "");
    if (id && introIds.has(id) && byPane.has(id)) byPane.get(id).content.push(item);
    else orphanIntro.push(item);
  }

  const groups = introPanes
    .map(p => byPane.get(String(p.id || "")))
    .filter(group => group && group.content.length > 0);

  // Restored legacy content may retain paneRole=intro after its original pane
  // id disappeared. Preserve it in one leading group instead of dropping it.
  if (orphanIntro.length) {
    groups.unshift({ paneId: "", label: "הקדמה", content: orphanIntro });
  }

  return { groups, body };
}
