import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/document_chapter_splitter.js';

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, value) {
  writeFileSync(path, value, 'utf8');
}

const marker = '__ravtextDocxPostUploadFallbackHandlersInstalled';

const fallbackHandlers = `
/* DOCX post-upload fallback handlers.
 * This guard is intentionally added after the uploadId/menu patches.
 * It fixes the case where the menu buttons are rendered but the original
 * delegated click handlers were not injected because the patch guard matched
 * the button HTML marker itself.
 */
let ${marker} = false;

function installDocxPostUploadFallbackHandlers() {
  if (${marker}) return;
  ${marker} = true;

  document.addEventListener("click", (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;

    const scanUploaded = target.closest("[data-wh-scan-uploaded]");
    const importFull = target.closest("[data-wh-import-full]");
    const saveLater = target.closest("[data-wh-save-later]");
    const cancelUpload = target.closest("[data-wh-cancel-upload]");
    const showPendingUploads = target.closest("[data-wh-show-pending-uploads]");
    const backUploadMenu = target.closest("[data-wh-back-upload-menu]");

    const action =
      scanUploaded ||
      importFull ||
      saveLater ||
      cancelUpload ||
      showPendingUploads ||
      backUploadMenu;

    if (!action) return;

    ev.preventDefault();
    ev.stopPropagation();

    try {
      if (scanUploaded) {
        if (typeof scanUploadedNow === "function") {
          Promise.resolve(scanUploadedNow()).catch((error) => errorCard(error?.message || String(error)));
        } else {
          errorCard("פעולת פיצול הכותרות לא נטענה. רענן את הדף ונסה שוב.");
        }
        return;
      }

      if (importFull) {
        if (typeof importUploadedFullAsSingleFile === "function") {
          Promise.resolve(importUploadedFullAsSingleFile()).catch((error) => errorCard(error?.message || String(error)));
        } else {
          errorCard("פעולת הכנסת הקובץ האחיד לא נטענה. רענן את הדף ונסה שוב.");
        }
        return;
      }

      if (saveLater) {
        if (typeof saveUploadedForLater === "function") {
          Promise.resolve(saveUploadedForLater()).catch((error) => errorCard(error?.message || String(error)));
        } else {
          errorCard("פעולת השמירה לזיכרון לא נטענה. רענן את הדף ונסה שוב.");
        }
        return;
      }

      if (cancelUpload) {
        if (typeof cancelUploadedDocx === "function") {
          Promise.resolve(cancelUploadedDocx()).catch((error) => errorCard(error?.message || String(error)));
        } else {
          removeCard();
          ensureLauncher();
        }
        return;
      }

      if (showPendingUploads) {
        if (typeof renderPendingUploadsList === "function") {
          renderPendingUploadsList();
        } else {
          errorCard("רשימת הקבצים השמורים לא נטענה. רענן את הדף ונסה שוב.");
        }
        return;
      }

      if (backUploadMenu) {
        if (typeof renderPostUploadMenu === "function") renderPostUploadMenu();
        return;
      }
    } catch (error) {
      errorCard(error?.message || String(error));
    }
  }, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installDocxPostUploadFallbackHandlers, { once: true });
} else {
  installDocxPostUploadFallbackHandlers();
}
`;

let src = read(TARGET);

if (!src.includes(marker)) {
  src += `\n${fallbackHandlers}\n`;
}

write(TARGET, src);
