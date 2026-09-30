export const PANE_KIND_MAIN = "main";
export const PANE_KIND_STREAM = "stream";
export const PANE_KIND_INTRO = "intro";

export function normalizePaneKind(kind, streamCode) {
  if (streamCode) return PANE_KIND_STREAM;
  return kind === PANE_KIND_INTRO ? PANE_KIND_INTRO : PANE_KIND_MAIN;
}

export function isMainPaneKind(kind, streamCode) {
  return normalizePaneKind(kind, streamCode) === PANE_KIND_MAIN;
}

export function isIntroPaneKind(kind, streamCode) {
  return normalizePaneKind(kind, streamCode) === PANE_KIND_INTRO;
}
