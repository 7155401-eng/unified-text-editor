// stream_roles_picker.js — per-stream role assignment for talmud mode.
// Each selected talmud stream gets a role: "inner"|"outer" (for inner-outer
// side-mode) or "right"|"left" (for right-left side-mode).
//
// Stored in localStorage as JSON: { "01": "inner", "02": "outer" }
// Default: first selected = inner (or right), second = outer (or left).

const STORAGE_KEY = "ravtext.talmudLayout.streamRoles";
const PICKER_ID = "talmud-stream-roles-picker";
const SIDE_MODE_SELECT_ID = "talmud-side-mode-select";
const STREAMS_INPUT_ID = "talmud-streams-input";

function getRoles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setRoles(roles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
  window.dispatchEvent(new CustomEvent("ravtext:stream-roles-changed"));
}

export function getStreamRole(code, mode = null) {
  const roles = getRoles();
  return roles[code] || null;
}

export function getOrderedStreamCodes(mode) {
  // Returns selected stream codes in order: first = inner/right, second = outer/left
  const input = document.getElementById(STREAMS_INPUT_ID);
  const codes = (input?.value || "").match(/\d{2}/g) || [];
  if (codes.length === 0) return codes;
  const roles = getRoles();
  if (mode === "inner-outer") {
    const inner = codes.find(c => roles[c] === "inner") || codes[0];
    const outer = codes.find(c => c !== inner && (roles[c] === "outer" || true)) || codes[1] || null;
    return outer ? [inner, outer] : [inner];
  }
  if (mode === "right-left") {
    const right = codes.find(c => roles[c] === "right") || codes[0];
    const left = codes.find(c => c !== right && (roles[c] === "left" || true)) || codes[1] || null;
    return left ? [right, left] : [right];
  }
  return codes;
}

function getCurrentMode() {
  const sel = document.getElementById(SIDE_MODE_SELECT_ID);
  return sel?.value || "inner-outer";
}

function renderPicker() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  const input = document.getElementById(STREAMS_INPUT_ID);
  const codes = (input?.value || "").match(/\d{2}/g) || [];
  if (codes.length === 0) {
    picker.innerHTML = "";
    return;
  }
  const mode = getCurrentMode();
  const options = mode === "right-left" ? ["right", "left"] : ["inner", "outer"];
  const labels = mode === "right-left"
    ? { right: "ימין", left: "שמאל" }
    : { inner: "פנימי", outer: "חיצוני" };
  const roles = getRoles();
  picker.innerHTML = "";
  codes.forEach((code, idx) => {
    const wrap = document.createElement("span");
    wrap.style.cssText = "display:inline-flex;align-items:center;gap:3px;";
    const label = document.createElement("span");
    label.textContent = `${code}:`;
    label.style.cssText = "color:#777;";
    wrap.appendChild(label);
    const sel = document.createElement("select");
    sel.style.cssText = "font-size:11px;padding:1px 4px;";
    options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = labels[opt];
      sel.appendChild(o);
    });
    // default: first stream = first option, second = second
    const defaultRole = idx === 0 ? options[0] : options[1];
    sel.value = roles[code] || defaultRole;
    sel.addEventListener("change", () => {
      const newRoles = { ...getRoles() };
      newRoles[code] = sel.value;
      // ensure no two streams share the same role: flip the other
      for (const c of codes) {
        if (c !== code && newRoles[c] === sel.value) {
          newRoles[c] = options.find(o => o !== sel.value);
        }
      }
      setRoles(newRoles);
      renderPicker();
    });
    wrap.appendChild(sel);
    picker.appendChild(wrap);
  });
}

export function setupStreamRolesPicker() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  renderPicker();
  document.getElementById(STREAMS_INPUT_ID)?.addEventListener("change", renderPicker);
  document.getElementById(STREAMS_INPUT_ID)?.addEventListener("input", renderPicker);
  document.getElementById(SIDE_MODE_SELECT_ID)?.addEventListener("change", renderPicker);
}
