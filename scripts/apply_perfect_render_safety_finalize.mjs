import fs from "node:fs";
import path from "node:path";

const rel = "src/engine_bridge.js";
const target = path.resolve(process.cwd(), rel);
let src = fs.readFileSync(target, "utf8");

const marker = `    }
    if (myToken !== _renderToken) return;

    // v33: inject demo watermarks INTO source content BEFORE pagination —`;

if (src.includes(marker)) {
  console.log("[perfect-render-safety-finalize] post-preflight cancellation already present");
  process.exit(0);
}

const oldText = `    }

    // v33: inject demo watermarks INTO source content BEFORE pagination —`;

if (!src.includes(oldText)) {
  throw new Error("[perfect-render-safety-finalize] expected post-preflight insertion point not found");
}

src = src.replace(oldText, marker);
fs.writeFileSync(target, src, "utf8");
console.log("[perfect-render-safety-finalize] added post-preflight cancellation check");
