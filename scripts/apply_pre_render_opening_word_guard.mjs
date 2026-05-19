import fs from 'node:fs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const after = patcher(before);
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[pre-render-opening-word] patched ${path}`);
  } else {
    console.log(`[pre-render-opening-word] no changes needed for ${path}`);
  }
}

function mustInsert(source, anchor, insert, label) {
  if (source.includes(insert.trim().split('\n')[0])) return source;
  if (!source.includes(anchor)) throw new Error(`[pre-render-opening-word] anchor not found: ${label}`);
  return source.replace(anchor, insert + anchor);
}

function replaceOnce(source, pattern, replacement, label, marker) {
  if (marker && source.includes(marker)) return source;
  const after = source.replace(pattern, replacement);
  if (after === source) throw new Error(`[pre-render-opening-word] anchor not found: ${label}`);
  return after;
}

const RENDERER_HELPER = `
function __ravtextGetPreRenderPageDecorators() {
  if (typeof window === "undefined") return [];
  const registry = window.__ravtextPreRenderPageDecorators;
  if (!Array.isArray(registry)) return [];
  return registry
    .filter((fn) => typeof fn === "function")
    .sort((a, b) => (Number(a.__ravtextPreRenderOrder) || 0) - (Number(b.__ravtextPreRenderOrder) || 0));
}

function __ravtextRunPreRenderPageDecorators(page, pageIndex) {
  if (!page || page.dataset?.ravtextPreRenderDecorated === "1") return;
  const decorators = __ravtextGetPreRenderPageDecorators();
  if (!decorators.length) return;

  let stage = null;
  const previousActive = typeof window !== "undefined" ? window.__ravtextPreRenderPageDecoratorActive : undefined;
  try {
    if (typeof window !== "undefined") window.__ravtextPreRenderPageDecoratorActive = true;

    if (!page.isConnected && typeof document !== "undefined" && document.body) {
      stage = document.createElement("div");
      stage.className = "ravtext-pre-render-stage";
      stage.setAttribute("aria-hidden", "true");
      stage.style.cssText = [
        "position:fixed",
        "left:-100000px",
        "top:0",
        "visibility:hidden",
        "pointer-events:none",
        "z-index:-1",
        "width:420px",
      ].join(";");
      document.body.appendChild(stage);
      stage.appendChild(page);
    }

    for (const decorate of decorators) decorate(page, pageIndex);
    page.dataset.ravtextPreRenderDecorated = "1";
  } finally {
    if (typeof window !== "undefined") window.__ravtextPreRenderPageDecoratorActive = previousActive;
    if (stage) {
      if (page.parentNode === stage) stage.removeChild(page);
      stage.remove();
    }
  }
}
`;

function patchRenderer(source) {
  source = mustInsert(source, '\nexport function renderPages(packerOutput, container) {', RENDERER_HELPER, 'renderer pre-render helper');

  source = replaceOnce(
    source,
    /(\n\s*real\.dataset\.pageIndex = String\(i\);\n\s*real\.dataset\.realized = "1";\n)(\s*allFrag\.appendChild\(real\);)/,
    `$1      __ravtextRunPreRenderPageDecorators(real, i);\n$2`,
    'sync page pre-render decoration',
    '__ravtextRunPreRenderPageDecorators(real, i);\n      allFrag.appendChild(real);'
  );

  source = replaceOnce(
    source,
    /(\n\s*if \(ph\.style\.zoom\) real\.style\.zoom = ph\.style\.zoom;\n)(\s*ph\.parentNode\.replaceChild\(real, ph\);)/,
    `$1    __ravtextRunPreRenderPageDecorators(real, i);\n$2`,
    'lazy page pre-render decoration',
    '__ravtextRunPreRenderPageDecorators(real, i);\n    ph.parentNode.replaceChild(real, ph);'
  );

  return source;
}

const OPW_GUARD = `
function allowOpeningWordPreRenderMutation(root) {
  if (typeof window === "undefined") return true;
  if (window.__ravtextPreRenderPageDecoratorActive) return true;
  if (!root?.isConnected) return true;
  return false;
}
`;

const OPW_REGISTRY = `
const OPENING_WORD_PRE_RENDER_DECORATOR_NAME = "opening_word";

function registerOpeningWordPreRenderDecorator() {
  if (typeof window === "undefined") return;
  const registry = window.__ravtextPreRenderPageDecorators || (window.__ravtextPreRenderPageDecorators = []);
  if (registry.some((fn) => fn && fn.__ravtextName === OPENING_WORD_PRE_RENDER_DECORATOR_NAME)) return;

  const decorator = (page) => {
    if (!page || page.classList?.contains("page-placeholder")) return;
    applyOpeningWordsToPage(page);
  };
  decorator.__ravtextName = OPENING_WORD_PRE_RENDER_DECORATOR_NAME;
  decorator.__ravtextPreRenderOrder = 20;
  registry.push(decorator);
}
`;

function patchOpeningWord(source) {
  source = mustInsert(
    source,
    '\nexport function applyOpeningWordsToPage(pageEl, mainSettings, streamSettings) {',
    OPW_GUARD,
    'opening word late mutation guard'
  );

  source = replaceOnce(
    source,
    /export function applyOpeningWordsToPage\(pageEl, mainSettings, streamSettings\) \{\n/,
    'export function applyOpeningWordsToPage(pageEl, mainSettings, streamSettings) {\n  if (!allowOpeningWordPreRenderMutation(pageEl)) return;\n',
    'opening word late mutation guard call',
    'allowOpeningWordPreRenderMutation(pageEl)'
  );

  if (!source.includes('function registerOpeningWordPreRenderDecorator()')) {
    source = source.replace(
      /export function applyOpeningWordsToPages\(container\) \{[\s\S]*?\n}\n\nexport function extractOpeningSegmentForTest/,
      `${OPW_REGISTRY}
export function applyOpeningWordsToPages(container) {
  registerOpeningWordPreRenderDecorator();
  if (container?.dataset) container.dataset.openingWordPreRenderRegistered = "1";
}

registerOpeningWordPreRenderDecorator();

export function extractOpeningSegmentForTest`
    );
    if (!source.includes('function registerOpeningWordPreRenderDecorator()')) {
      throw new Error('[pre-render-opening-word] failed to patch applyOpeningWordsToPages');
    }
  }

  return source;
}

const STRETCH_GUARD = `
function allowOpeningWordStretchPreRenderMutation(root) {
  if (typeof window === "undefined") return true;
  if (window.__ravtextPreRenderPageDecoratorActive) return true;
  if (!root?.isConnected) return true;
  return false;
}
`;

const STRETCH_REGISTRY = `
const OPENING_WORD_STRETCH_PRE_RENDER_DECORATOR_NAME = "opening_word_stretch";

function registerOpeningWordStretchPreRenderDecorator() {
  if (typeof window === "undefined") return;
  const registry = window.__ravtextPreRenderPageDecorators || (window.__ravtextPreRenderPageDecorators = []);
  if (registry.some((fn) => fn && fn.__ravtextName === OPENING_WORD_STRETCH_PRE_RENDER_DECORATOR_NAME)) return;

  const decorator = (page) => {
    if (!page || page.classList?.contains("page-placeholder")) return;
    applyOpeningWordStretchToPage(page);
  };
  decorator.__ravtextName = OPENING_WORD_STRETCH_PRE_RENDER_DECORATOR_NAME;
  decorator.__ravtextPreRenderOrder = 30;
  registry.push(decorator);
}
`;

function patchOpeningWordStretch(source) {
  source = mustInsert(
    source,
    '\nexport function applyOpeningWordStretchToPage(pageEl) {',
    STRETCH_GUARD,
    'opening word stretch late mutation guard'
  );

  source = replaceOnce(
    source,
    /export function applyOpeningWordStretchToPage\(pageEl\) \{\n/,
    'export function applyOpeningWordStretchToPage(pageEl) {\n  if (!allowOpeningWordStretchPreRenderMutation(pageEl)) return;\n',
    'opening word stretch late mutation guard call',
    'allowOpeningWordStretchPreRenderMutation(pageEl)'
  );

  if (!source.includes('function registerOpeningWordStretchPreRenderDecorator()')) {
    source = source.replace(
      /export function applyOpeningWordStretchToPages\(container\) \{[\s\S]*?\n\}\s*$/,
      `${STRETCH_REGISTRY}
export function applyOpeningWordStretchToPages(container) {
  registerOpeningWordStretchPreRenderDecorator();
  if (container?.dataset) container.dataset.openingWordStretchPreRenderRegistered = "1";
}

registerOpeningWordStretchPreRenderDecorator();
`
    );
    if (!source.includes('function registerOpeningWordStretchPreRenderDecorator()')) {
      throw new Error('[pre-render-opening-word] failed to patch applyOpeningWordStretchToPages');
    }
  }

  return source;
}

patchFile('src/engine/render.js', patchRenderer);
patchFile('src/opening_word.js', patchOpeningWord);
patchFile('src/opening_word_stretch.js', patchOpeningWordStretch);
