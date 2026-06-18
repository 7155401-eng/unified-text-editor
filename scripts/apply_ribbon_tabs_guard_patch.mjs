import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "src", "main.js");

function insertAfterLastImport(source, line) {
  const importMatches = Array.from(source.matchAll(/^import\s.+?;?\s*$/gm));
  if (!importMatches.length) return `${line}\n${source}`;
  const last = importMatches[importMatches.length - 1];
  const at = last.index + last[0].length;
  return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}

function patchMain() {
  let src = readFileSync(mainPath, "utf8");

  const importLine = 'import { installRibbonTabsGuard } from "./ribbon_tabs_guard.js";';
  if (!src.includes(importLine)) {
    const authImport = 'import { installAuthUi } from "./auth_ui.js";';
    if (src.includes(authImport)) {
      src = src.replace(authImport, `${authImport}\n${importLine}`);
    } else {
      src = insertAfterLastImport(src, importLine);
    }
  }

  const callLine = "installRibbonTabsGuard();";
  if (!src.includes(callLine)) {
    const authCall = "installAuthUi();";
    if (src.includes(authCall)) {
      src = src.replace(authCall, `${authCall}\n${callLine}`);
    } else {
      src = src.replace(importLine, `${importLine}\n${callLine}`);
    }
  }

  writeFileSync(mainPath, src);
}

patchMain();
