import fs from 'node:fs';

const V9_PATH = 'src/vilna_v9.js';
const V9_MODEL_PATH = 'src/engine/v9_opening_word_layout_model.js';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-opw-window-render-guard] patched ${path}`);
  } else {
    console.log(`[v9-opw-window-render-guard] no changes needed for ${path}`);
  }
}

function patchV9RenderWidth(source) {
  if (source.includes('const renderWidth = Number(line.width) > 0 ? line.width : strip.width;')) {
    return source;
  }

  const target = `      if (!strip) continue;
      mainLines.push({
        x: strip.x,
        y: line.y,
        width: strip.width,`;

  const replacement = `      if (!strip) continue;
      // Final V9 opening-word guard:
      // flowMainParagraphsThroughStrips already carries the analytically measured
      // line.width. Window lines have reduced width; the opening-word host line
      // is restored to full width before this point. Using strip.width here erases
      // the measured window during DOM render.
      const renderWidth = Number(line.width) > 0 ? line.width : strip.width;
      mainLines.push({
        x: strip.x,
        y: line.y,
        width: renderWidth,`;

  if (!source.includes(target)) {
    throw new Error('[v9-opw-window-render-guard] anchor not found: main line width render mapping');
  }

  return source.replace(target, replacement);
}

function patchModelMargins(source) {
  // Older V9 opening-word stabilization forced host margins to zero. That changes
  // visual row gaps when the stream style supplies margins. Keep the stream's own
  // margins and only lock line-height/height.
  return source
    .replace(/\n\s*el\.style\.marginTop = "0px";\n\s*el\.style\.marginBottom = "0px";\n/g, '\n')
    .replace(/\n\s*\/\/ The first line hosts the large opening word only; it must not introduce\n\s*\/\/ extra paragraph margins or a different line gap\.\n/g, '\n');
}

const beforeV9 = read(V9_PATH);
const afterV9 = patchV9RenderWidth(beforeV9);
writeIfChanged(V9_PATH, beforeV9, afterV9);

const beforeModel = read(V9_MODEL_PATH);
const afterModel = patchModelMargins(beforeModel);
writeIfChanged(V9_MODEL_PATH, beforeModel, afterModel);
