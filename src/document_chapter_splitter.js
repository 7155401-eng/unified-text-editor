// Temporary safety hotfix:
// Disable the experimental chapter/diagnostics module so the existing Word import modal
// can run without an extra DOCX scan on the UI thread.
export function wireChapterSplitter(paneManager) {
  void paneManager;
  if (typeof window !== "undefined") {
    window.ravtextRefreshWordDocumentDiagnostics = () => {};
  }
}
