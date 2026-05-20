// Safety hotfix:
// Keep this module as a no-op until Word heading/diagnostics are integrated
// natively inside the Word extractor flow, without a second DOCX read.
port function wireChapterSplitter(paneManager) {
  void paneManager;
  if (typeof window !== "undefined") {
    window.ravtextRefreshWordDocumentDiagnostics = () => {};
    window.ravtextRefreshWordHeadingMap = () => {};
  }
}
