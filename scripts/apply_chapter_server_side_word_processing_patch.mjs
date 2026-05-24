import fs from "node:fs";

const file = "src/document_chapter_splitter.js";
let src = fs.readFileSync(file, "utf8");

const importNeedle = `import { buildDefaultStreamMapping } from "./word_extractor/word_extractor_streams.js";`;
const importPatch = `${importNeedle}
import {
  extractWordChapterOnServer,
  importWordChaptersOnServer,
  normalizeServerScanState,
} from "./chapter_cache/chapter_server_api.js";`;

if (!src.includes("chapter_server_api.js")) {
  if (!src.includes(importNeedle)) {
    throw new Error("document_chapter_splitter: import anchor not found");
  }
  src = src.replace(importNeedle, importPatch);
}

const scanNeedle = `  loading("הקובץ נקלט. ממתין לסיום הסריקה הרגילה...");`;
const scanPatch = `  try {
    loading("מעלה את קובץ Word לשרת לפני עיבוד...");
    const serverImport = await importWordChaptersOnServer(fileObj);

    if (thisToken !== token) return;

    const serverState = normalizeServerScanState(serverImport, fileObj);
    if (!serverState) {
      throw new Error("השרת לא החזיר manifest תקין עבור מסמך Word.");
    }

    state = serverState;
    selectedLevel = !serverState.heads?.[1]?.length && serverState.heads?.[2]?.length ? 2 : 1;
    chaptersOpen = false;
    renderCard();
    ensureLauncher();
    return;
  } catch (serverError) {
    if (thisToken !== token) return;
    errorCard(serverError?.message || String(serverError));
    return;
  }`;

if (!src.includes("מעלה את קובץ Word לשרת לפני עיבוד")) {
  if (!src.includes(scanNeedle)) {
    throw new Error("document_chapter_splitter: scan loading anchor not found");
  }
  src = src.replace(scanNeedle, scanPatch);
}

const importNeedle2 = `  try {
    const chapter = await buildChapterDocx(chapterIndex);`;
const importPatch2 = `  try {
    if (state?.serverSide) {
      loading(\`מחלץ את הפרק בצד שרת: \${chapterIndex + 1}...\`);
      const serverChapter = await extractWordChapterOnServer(selectedFile, {
        level: selectedLevel,
        index: chapterIndex,
      });

      if (!serverChapter?.result) {
        throw new Error("השרת לא החזיר תוכן פרק תקין.");
      }

      const title = serverChapter.title || currentHeads()[chapterIndex]?.title || \`פרק \${chapterIndex + 1}\`;
      importedKeys.add(chapterKey(selectedLevel, chapterIndex));
      lastImported = {
        level: selectedLevel,
        index: chapterIndex,
        title,
        at: Date.now(),
      };

      loadExtractedChapter(title, serverChapter.result);
      ensureLauncher();
      return;
    }

    const chapter = await buildChapterDocx(chapterIndex);`;

if (!src.includes("מחלץ את הפרק בצד שרת")) {
  if (!src.includes(importNeedle2)) {
    throw new Error("document_chapter_splitter: importChapter anchor not found");
  }
  src = src.replace(importNeedle2, importPatch2);
}

fs.writeFileSync(file, src);
