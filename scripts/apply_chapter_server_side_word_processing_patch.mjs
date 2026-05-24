import fs from "node:fs";

const file = "src/document_chapter_splitter.js";
let src = fs.readFileSync(file, "utf8");

const importNeedle = `import { buildDefaultStreamMapping } from "./word_extractor/word_extractor_streams.js";`;
const importPatch = `${importNeedle}
import {
  normalizeServerScanState,
  tryServerExtractWordChapter,
  tryServerScanWordChapters,
} from "./chapter_cache/chapter_server_api.js";`;

if (!src.includes("tryServerScanWordChapters")) {
  if (!src.includes(importNeedle)) {
    throw new Error("document_chapter_splitter: import anchor not found");
  }
  src = src.replace(importNeedle, importPatch);
}

const scanNeedle = `  loading("הקובץ נקלט. ממתין לסיום הסריקה הרגילה...");`;
const scanPatch = `  loading("הקובץ נקלט. מעבד את הפרקים בצד שרת...");
  const serverScan = await tryServerScanWordChapters(fileObj);
  if (serverScan && thisToken === token) {
    const serverState = normalizeServerScanState(serverScan, fileObj);
    if (serverState) {
      state = serverState;
      selectedLevel = !serverState.heads?.[1]?.length && serverState.heads?.[2]?.length ? 2 : 1;
      chaptersOpen = false;
      renderCard();
      ensureLauncher();
      return;
    }
  }

${scanNeedle}`;

if (!src.includes("מעבד את הפרקים בצד שרת")) {
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
      const serverChapter = await tryServerExtractWordChapter(selectedFile, {
        level: selectedLevel,
        index: chapterIndex,
      });
      if (serverChapter?.result) {
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
    }

    const chapter = await buildChapterDocx(chapterIndex);`;

if (!src.includes("מחלץ את הפרק בצד שרת")) {
  if (!src.includes(importNeedle2)) {
    throw new Error("document_chapter_splitter: importChapter anchor not found");
  }
  src = src.replace(importNeedle2, importPatch2);
}

fs.writeFileSync(file, src);
