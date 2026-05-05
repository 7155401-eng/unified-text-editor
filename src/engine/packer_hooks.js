// engine/packer_hooks.js — phase hook registry per v3 spec part 9 + CL-6/CL-7.
//
// Lives next to dom_packer.js without touching it. The packer itself does
// NOT have to call hooks — the engine bridge or any caller can fire phases
// at the appropriate moment. This avoids surgery on the protected packer.
//
// API:
//   registerPackerHook("beforeMeasure" | "afterMeasure" | "beforeBuild" | "afterBuild",
//                      fn, { name, requiresApiVersion })
//   firePackerHook(phase, ctx, ...args)
//   listPackerHooks(phase?)

export const PACKER_API_VERSION = 1;

const PHASES = ["beforeMeasure", "afterMeasure", "beforeBuild", "afterBuild"];

/** @type {Record<string, Array<{fn: Function, name: string}>>} */
const _hooks = Object.fromEntries(PHASES.map(p => [p, []]));

export function registerPackerHook(phase, fn, opts = {}) {
  if (!PHASES.includes(phase)) {
    throw new Error(`Unknown packer hook phase: ${phase}`);
  }
  if (
    opts.requiresApiVersion != null &&
    opts.requiresApiVersion > PACKER_API_VERSION
  ) {
    throw new Error(
      `Hook "${opts.name || "anonymous"}" requires API v${
        opts.requiresApiVersion
      } but packer is v${PACKER_API_VERSION}`
    );
  }
  // Idempotent registration — same name/phase replaces.
  const arr = _hooks[phase];
  const existingIdx = arr.findIndex(h => h.name === (opts.name || ""));
  const entry = { fn, name: opts.name || "anonymous" };
  if (existingIdx >= 0) arr[existingIdx] = entry;
  else arr.push(entry);
}

export function unregisterPackerHook(phase, name) {
  if (!PHASES.includes(phase)) return;
  _hooks[phase] = _hooks[phase].filter(h => h.name !== name);
}

export function listPackerHooks(phase) {
  if (phase) return _hooks[phase].slice();
  return Object.fromEntries(PHASES.map(p => [p, _hooks[p].slice()]));
}

export async function firePackerHook(phase, ctx, ...args) {
  if (!PHASES.includes(phase)) return;
  for (const h of _hooks[phase]) {
    try {
      const r = h.fn(ctx, ...args);
      if (r && typeof r.then === "function") await r;
    } catch (err) {
      // Hooks must not break the packer. Log and continue.
      // eslint-disable-next-line no-console
      console.error(`[packer hook ${phase}/${h.name}]`, err);
    }
  }
}
