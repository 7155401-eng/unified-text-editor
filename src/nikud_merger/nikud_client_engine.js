export const SCOPE_OFF   = "off";
export const SCOPE_VOC   = "voc";
export const SCOPE_CLEAN = "clean";
export const SCOPE_BOTH  = "both";

export const SCOPE_LABELS = {
  [SCOPE_OFF]:   "׳›׳‘׳•׳™",
  [SCOPE_VOC]:   "׳׳ ׳•׳§׳“",
  [SCOPE_CLEAN]: "׳׳•׳’׳”",
  [SCOPE_BOTH]:  "׳©׳ ׳™׳”׳",
};

export const SCOPE_LABELS_EN = {
  [SCOPE_OFF]:   "Off",
  [SCOPE_VOC]:   "Vocalized",
  [SCOPE_CLEAN]: "Clean",
  [SCOPE_BOTH]:  "Both",
};

export class FilterConfig {
  constructor(init = {}) {
    this.nikud       = SCOPE_CLEAN;
    this.taamim      = SCOPE_BOTH;
    this.periods         = SCOPE_VOC;
    this.commas          = SCOPE_VOC;
    this.colons          = SCOPE_VOC;
    this.semicolons      = SCOPE_VOC;
    this.dashes          = SCOPE_VOC;
    this.question_exclaim = SCOPE_VOC;
    this.quotes        = SCOPE_OFF;
    this.hebrew_geresh = SCOPE_OFF;
    this.maqaf         = SCOPE_VOC;
    this.round_brackets  = SCOPE_VOC;
    this.square_brackets = SCOPE_VOC;
    this.curly_brackets  = SCOPE_VOC;
    this.angle_brackets  = SCOPE_VOC;
    this.digits         = SCOPE_VOC;
    this.latin_letters  = SCOPE_VOC;
    this.at_markers     = SCOPE_VOC;
    this.asterisks      = SCOPE_VOC;
    this.hashes         = SCOPE_VOC;
    this.extra_spaces = SCOPE_BOTH;
    this.line_breaks  = SCOPE_BOTH;
    this.ignore_ranges = [
      ["{", "}", SCOPE_VOC],
      ["<<", ">>", SCOPE_VOC],
    ];
    this.flexible_ktiv          = true;
    this.case_insensitive_latin = true;
    Object.assign(this, init);
  }

  toDict() {
    return {
      nikud: this.nikud, taamim: this.taamim,
      periods: this.periods, commas: this.commas, colons: this.colons,
      semicolons: this.semicolons, dashes: this.dashes,
      question_exclaim: this.question_exclaim,
      quotes: this.quotes, hebrew_geresh: this.hebrew_geresh, maqaf: this.maqaf,
      round_brackets: this.round_brackets, square_brackets: this.square_brackets,
      curly_brackets: this.curly_brackets, angle_brackets: this.angle_brackets,
      digits: this.digits, latin_letters: this.latin_letters,
      at_markers: this.at_markers, asterisks: this.asterisks, hashes: this.hashes,
      extra_spaces: this.extra_spaces, line_breaks: this.line_breaks,
      ignore_ranges: this.ignore_ranges.map(r => r.slice()),
      flexible_ktiv: this.flexible_ktiv,
      case_insensitive_latin: this.case_insensitive_latin,
    };
  }

  static fromDict(data) {
    return new FilterConfig(data || {});
  }

  static presetLoose() {
    return new FilterConfig();
  }

  static presetStrict() {
    const c = new FilterConfig();
    const fields = [
      "periods","commas","colons","semicolons","dashes","question_exclaim",
      "quotes","hebrew_geresh","maqaf",
      "round_brackets","square_brackets","curly_brackets","angle_brackets",
      "digits","latin_letters","at_markers","asterisks","hashes",
    ];
    for (const f of fields) c[f] = SCOPE_OFF;
    c.ignore_ranges = [];
    c.flexible_ktiv = false;
    return c;
  }

  static presetMidrash() {
    const c = new FilterConfig();
    c.at_markers    = SCOPE_BOTH;
    c.hebrew_geresh = SCOPE_VOC;
    return c;
  }
}

export const SegmentKind = Object.freeze({
  PASSTHROUGH:   "passthrough",
  UNCHANGED:     "unchanged",
  INSERTED:      "inserted",
  DELETED:       "deleted",
  SPELLING_DIFF: "spelling_diff",
});

export function makeSegment(kind, text, original = "") {
  return { kind, text, original };
}

function _escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderAsHtml(result) {
  const parts = [];
  for (const seg of result.segments) {
    const br = (s) => _escapeHtml(s).replace(/\n/g, "<br>").replace(/\r/g, "");
    if (seg.kind === SegmentKind.PASSTHROUGH) parts.push(br(seg.text));
    else if (seg.kind === SegmentKind.UNCHANGED) parts.push(br(seg.text));
    else if (seg.kind === SegmentKind.INSERTED) parts.push(`<ins>${br(seg.text)}</ins>`);
    else if (seg.kind === SegmentKind.DELETED) parts.push(`<del>${br(seg.text)}</del>`);
    else if (seg.kind === SegmentKind.SPELLING_DIFF) {
      parts.push(
        `<span class="spelling-diff">` +
        `<del>${br(seg.original)}</del>` +
        `<ins>${br(seg.text)}</ins>` +
        `</span>`
      );
    }
  }
  return parts.join("");
}

export function renderAsPlain(result, acceptAll = true) {
  const parts = [];
  for (const seg of result.segments) {
    if (seg.kind === SegmentKind.PASSTHROUGH
     || seg.kind === SegmentKind.UNCHANGED
     || seg.kind === SegmentKind.INSERTED) {
      parts.push(seg.text);
    } else if (seg.kind === SegmentKind.DELETED) {
      if (!acceptAll) parts.push(seg.text);
    } else if (seg.kind === SegmentKind.SPELLING_DIFF) {
      parts.push(acceptAll ? seg.text : seg.original);
    }
  }
  return parts.join("");
}

export async function merge(clean, vocalizedText, opts = {}) {
  const response = await fetch("/api/nikud-merger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "merge",
      clean,
      sources: [["Source 1", vocalizedText]],
      mode: opts.mode || "word",
      filter_config: opts.config && opts.config.toDict ? opts.config.toDict() : opts.config,
    }),
  });
  if (!response.ok) throw new Error(`Nikud merger failed: HTTP ${response.status}`);
  const data = await response.json();
  return data.result;
}

export async function mergeAllSources(clean, sources, opts = {}) {
  const response = await fetch("/api/nikud-merger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "merge",
      clean,
      sources,
      mode: opts.mode || "word",
      filter_config: opts.config && opts.config.toDict ? opts.config.toDict() : opts.config,
    }),
  });
  if (!response.ok) throw new Error(`Nikud merger failed: HTTP ${response.status}`);
  const data = await response.json();
  return data.result;
}

export async function checkText(text) {
  const response = await fetch("/api/nikud-merger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "quality", text }),
  });
  if (!response.ok) throw new Error(`Nikud quality failed: HTTP ${response.status}`);
  const data = await response.json();
  return data.issues || [];
}

export async function summarizeIssues(issues) {
  const summary = {
    no_nikud: 0,
    partial_nikud: 0,
    missing_shin_dot: 0,
    double_nikud: 0,
  };
  for (const issue of issues) {
    summary[issue.kind] = (summary[issue.kind] || 0) + 1;
  }
  summary.total = issues.length;
  return summary;
}

export function makeTabData(init = {}) {
  return {
    name: init.name || "",
    clean_text: init.clean_text || "",
    vocalized_sources: Array.isArray(init.vocalized_sources) ? init.vocalized_sources.slice() : [],
    filter_config: init.filter_config && typeof init.filter_config === "object"
      ? Object.assign({}, init.filter_config)
      : new FilterConfig().toDict(),
  };
}

export function makeProjectData(init = {}) {
  return {
    version: init.version || "1.0",
    created: init.created || "",
    modified: init.modified || "",
    tabs: Array.isArray(init.tabs) ? init.tabs.map(t => makeTabData(t)) : [],
    master_text: init.master_text || "",
    saved_filter_profiles: init.saved_filter_profiles && typeof init.saved_filter_profiles === "object"
      ? Object.assign({}, init.saved_filter_profiles)
      : {},
  };
}

const LS_PROJECT_KEY  = "ravtext.nikud_merger.project";
const LS_AUTOSAVE_KEY = "ravtext.nikud_merger.autosave";
const LS_PROFILES_KEY = "ravtext.nikud_merger.filter_profiles";

export function saveProject(project, key = LS_PROJECT_KEY) {
  project.modified = new Date().toISOString();
  if (!project.created) project.created = project.modified;
  try {
    localStorage.setItem(key, JSON.stringify(project));
    return true;
  } catch (_) { return false; }
}

export function loadProject(key = LS_PROJECT_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return makeProjectData(JSON.parse(raw));
  } catch (_) { return null; }
}

export function autosave(project) {
  try { saveProject(project, LS_AUTOSAVE_KEY); } catch (_) { /* ignore */ }
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE_KEY);
    if (!raw) return null;
    return makeProjectData(JSON.parse(raw));
  } catch (_) { return null; }
}

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(LS_PROFILES_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) { return {}; }
}

export function saveProfile(name, config) {
  const profiles = loadProfiles();
  profiles[name] = config.toDict ? config.toDict() : Object.assign({}, config);
  try { localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(profiles)); }
  catch (_) { /* ignore */ }
}

export function deleteProfile(name) {
  const profiles = loadProfiles();
  if (profiles[name] !== undefined) {
    delete profiles[name];
    try { localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(profiles)); }
    catch (_) { /* ignore */ }
    return true;
  }
  return false;
}

export function getProfile(name) {
  const profiles = loadProfiles();
  if (profiles[name]) return FilterConfig.fromDict(profiles[name]);
  return null;
}
