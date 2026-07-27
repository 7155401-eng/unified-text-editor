import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH';
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const write = (p, a, b) => {
  if (a === b) return console.log(`[drive-upload] no changes for ${p}`);
  fs.writeFileSync(p, b);
  console.log(`[drive-upload] patched ${p}`);
};
function rep(s, a, b, label) {
  if (!s.includes(a)) throw new Error(`[drive-upload] missing ${label}`);
  return s.replace(a, b);
}
function before(s, a, b, label) {
  if (!s.includes(a)) throw new Error(`[drive-upload] missing ${label}`);
  return s.replace(a, b + a);
}

function patchUi() {
  const p = 'src/torah_transcription/torah_transcription_ui.js';
  const a = read(p);
  if (a.includes(`${TAG}_UI`)) return write(p, a, a);
  let s = a;

  s = rep(s, `function suffixLower(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i).toLowerCase() : "";
}

`, `function suffixLower(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i).toLowerCase() : "";
}

// ${TAG}_UI
function driveFileName(url, typedName) {
  const typed = String(typedName || "").trim();
  if (typed) return basename(typed);
  const raw = String(url || "").trim();
  try {
    const u = new URL(raw);
    const parts = decodeURIComponent(u.pathname || "").split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (last.includes(".")) return basename(last);
  } catch (_) {}
  return "google-drive-file.mp3";
}

`, 'ui helper');

  s = rep(s, `      file_blob: null,
      file_name: "",
`, `      file_blob: null,
      drive_url: "",
      drive_file_name: "",
      file_name: "",
`, 'ui state');

  s = rep(s, `    row.appendChild(fileRow);

`, `    row.appendChild(fileRow);

    const driveRow = el("div", { class: "tt-card", style: "margin-top:12px;" });
    driveRow.appendChild(el("div", { class: "tt-h2" }, "קישור Google Drive"));
    driveRow.appendChild(el("div", { class: "tt-note" }, "יש לשתף את הקובץ בדרייב: כל מי שיש לו קישור יכול לצפות. בקובץ בלי סיומת כתוב שם כמו shiur.mp3."));
    this.driveUrlInput = el("input", {
      type: "url",
      class: "tt-input",
      placeholder: "https://drive.google.com/file/d/.../view",
      style: "width:calc(100% - 50px); margin:8px 25px;",
      value: this.appState.drive_url || "",
    });
    this.driveNameInput = el("input", {
      type: "text",
      class: "tt-input",
      placeholder: "שם קובץ כולל סיומת, רשות",
      style: "width:calc(100% - 50px); margin:0 25px 8px 25px;",
      value: this.appState.drive_file_name || "",
    });
    driveRow.appendChild(this.driveUrlInput);
    driveRow.appendChild(this.driveNameInput);
    driveRow.appendChild(el("button", {
      class: "tt-btn tt-btn-secondary",
      style: "margin:0 25px 10px 25px; min-width:auto;",
      onclick: () => this._setDriveUrl(this.driveUrlInput.value, this.driveNameInput.value),
    }, "בחר מקישור Drive"));
    row.appendChild(driveRow);

`, 'ui drive inputs');

  s = before(s, `  _setFile(file) {\n`, `  _setDriveUrl(url, typedName = "") {
    const driveUrl = String(url || "").trim();
    if (!driveUrl) return;
    const name = driveFileName(driveUrl, typedName);
    this.appState.drive_url = driveUrl;
    this.appState.drive_file_name = name;
    this.appState.file_blob = null;
    this.appState.file_name = name;
    this.appState.file_path = name;
    if (this.fileInput) this.fileInput.value = "";
    if (this.driveUrlInput) this.driveUrlInput.value = driveUrl;
    if (this.driveNameInput && !this.driveNameInput.value) this.driveNameInput.value = name;
    if (this.fileLabel) {
      this.fileLabel.classList.remove("muted");
      this.fileLabel.textContent = "Google Drive · " + name;
    }
    this._refreshFileWarning();
  }

`, 'ui method');

  s = rep(s, `    this.appState.file_path = file.name; // התאמה: בקוד המקורי file_path הוא נתיב; ב-JS השם בלבד
`, `    this.appState.file_path = file.name; // התאמה: בקוד המקורי file_path הוא נתיב; ב-JS השם בלבד
    this.appState.drive_url = "";
    this.appState.drive_file_name = "";
    if (this.driveUrlInput) this.driveUrlInput.value = "";
    if (this.driveNameInput) this.driveNameInput.value = "";
`, 'ui local clears drive');

  s = rep(s, `  _refreshFileWarning() {
    const file = this.appState.file_blob;
`, `  _refreshFileWarning() {
    if (this.appState.drive_url) {
      if (this.fileWarnLabel) this.fileWarnLabel.textContent = "קישור Drive נבחר. ודא שהקובץ פתוח לכל מי שיש לו קישור ושיש שם קובץ עם סיומת.";
      if (this.fileWarnFrame) this.fileWarnFrame.style.display = "flex";
      return;
    }
    const file = this.appState.file_blob;
`, 'ui drive warning');

  s = rep(s, `    if (s.file_name) lines.push(\`קובץ: \${s.file_name}\`);
`, `    if (s.file_name) lines.push(\`קובץ: \${s.file_name}\`);
    if (s.drive_url) lines.push(\`Google Drive: \${s.drive_file_name || s.file_name || "קישור"}\`);
`, 'ui summary');

  s = rep(s, `    } else if (key === "options") {
`, `    } else if (key === "file") {
      const u = this.driveUrlInput ? (this.driveUrlInput.value || "").trim() : "";
      const n = this.driveNameInput ? (this.driveNameInput.value || "").trim() : "";
      if (u) this._setDriveUrl(u, n);
    } else if (key === "options") {
`, 'ui save file');

  s = rep(s, `      if (!this.appState.file_blob) return "לא נבחר קובץ.";
`, `      if (!this.appState.file_blob && !String(this.appState.drive_url || "").trim()) return "לא נבחר קובץ או קישור Google Drive.";
`, 'ui validate');

  s = rep(s, `      const ftype = detectFileType(s.file_name);
`, `      const driveUrl = String(s.drive_url || "").trim();
      const sourceFileName = s.file_name || s.drive_file_name || driveFileName(driveUrl, "");
      const ftype = detectFileType(sourceFileName);
`, 'ui ftype');

  s = rep(s, `      const filesToSend = [s.file_blob];
`, `      const filesToSend = s.file_blob ? [s.file_blob] : [];
`, 'ui files');

  s = rep(s, `          files: filesToSend,
          ocr_examples: s.ocr_examples.length ? s.ocr_examples : null,
`, `          files: filesToSend,
          drive_url: driveUrl || null,
          drive_file_name: s.drive_file_name || s.file_name || null,
          ocr_examples: s.ocr_examples.length ? s.ocr_examples : null,
`, 'ui gemini payload');

  s = rep(s, `              files: [s.file_blob],
              torah_mode: s.torah_mode,
`, `              files: s.file_blob ? [s.file_blob] : null,
              drive_url: driveUrl || null,
              drive_file_name: s.drive_file_name || s.file_name || null,
              torah_mode: s.torah_mode,
`, 'ui eleven payload');

  write(p, a, s);
}

function patchGas() {
  const p = 'src/torah_transcription/torah_transcription_gas.js';
  const a = read(p);
  if (a.includes(`${TAG}_GAS`)) return write(p, a, a);
  let s = a;
  s = rep(s, `    files = null,           // [{name, mime, blob}] OR [File]
    text_payload = null,
`, `    files = null,           // [{name, mime, blob}] OR [File]
    drive_url = null,       // ${TAG}_GAS
    drive_file_name = null,
    text_payload = null,
`, 'gas args');
  s = rep(s, `    if (filesData.length) {
      requestBody.files = filesData;
    }
`, `    if (drive_url) {
      requestBody.drive_url = String(drive_url).trim();
      if (drive_file_name) requestBody.drive_file_name = _basename(drive_file_name);
    }
    if (filesData.length) {
      requestBody.files = filesData;
    }
`, 'gas body');
  s = rep(s, `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code"]);
`, `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code", "drive_url"]);
`, 'gas log heavy');
  s = rep(s, `      logBody._files_count = (requestBody.files || []).length;
`, `      logBody._files_count = (requestBody.files || []).length;
      logBody._has_drive_url = !!requestBody.drive_url;
`, 'gas log summary');
  write(p, a, s);
}

function patchDirect() {
  const p = 'worker/ai_direct.js';
  const a = read(p);
  if (a.includes(`${TAG}_DIRECT`)) return write(p, a, a);
  let s = a;

  const h = `
// ${TAG}_DIRECT
function driveFileId(url) {
  const text = String(url || "").trim();
  try {
    const u = new URL(text);
    const id = u.searchParams.get("id");
    if (id) return id;
    const m = u.pathname.match(/\\/file\\/d\\/([^/]+)/);
    if (m) return m[1];
  } catch (_) {
    const m = text.match(/\\/file\\/d\\/([^/]+)/);
    if (m) return m[1];
    const q = text.match(/[?&]id=([^&]+)/);
    if (q) return q[1];
  }
  return "";
}
function driveDownloadUrl(url) {
  const id = driveFileId(url);
  return id ? "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id) : String(url || "").trim();
}
function remoteName(body) {
  return String(body.drive_file_name || body.file_name || "google-drive-file.mp3").trim();
}
function remoteType(name) {
  const ext = String(name || "").toLowerCase().split("?")[0].split("#")[0].split(".").pop();
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return "video";
  if (["jpg","jpeg","png","webp","bmp","tif","tiff"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "audio";
}
async function fetchDriveBlob(body) {
  const url = driveDownloadUrl(body.drive_url);
  if (!/^https?:\\/\\//i.test(url)) return { error: "bad_request", message: "קישור Google Drive אינו תקין" };
  let r;
  try { r = await fetch(url, { redirect: "follow" }); }
  catch (e) { return { error: "server_error", message: "לא הצלחתי להוריד מדרייב: " + (e && e.message ? e.message : String(e)) }; }
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) return { error: "server_error", message: "Google Drive החזיר שגיאה " + r.status };
  if (/text\\/html/i.test(ct)) return { error: "bad_request", message: "Google Drive החזיר דף במקום קובץ. יש לפתוח הרשאה לכל מי שיש לו קישור." };
  return { blob: await r.blob(), name: remoteName(body) };
}

`;
  s = before(s, `// הנחיה הסופית לפי סוג`, h, 'direct helper');

  s = rep(s, `  if (body.files && body.files.length) {
    body.files.forEach((f) => {
      parts.push({ inline_data: { mime_type: detectMimeType(f.type, f.name), data: f.content_base64 } });
    });
  }

  if (body.text) parts.push({ text: body.text });
`, `  if (body.files && body.files.length) {
    body.files.forEach((f) => {
      parts.push({ inline_data: { mime_type: detectMimeType(f.type, f.name), data: f.content_base64 } });
    });
  }
  if (body.drive_url) {
    const n = remoteName(body);
    parts.push({ file_data: { mime_type: detectMimeType(remoteType(n), n), file_uri: driveDownloadUrl(body.drive_url) } });
  }

  if (body.text) parts.push({ text: body.text });
`, 'direct gemini file_data');

  s = rep(s, `async function callElevenLabs(apiKey, body) {
  const file = body.files && body.files[0];
  if (!file || !file.content_base64) {
    return { error: 'server_error', message: 'לא נשלח קובץ אודיו לתמלול' };
  }
  const modelId = (body.model && body.model.indexOf('elevenlabs-') === 0)
`, `async function callElevenLabs(apiKey, body) {
  const localFile = body.files && body.files[0];
  let audioBlob = null;
  let audioName = 'audio';
  if (body.drive_url) {
    const remote = await fetchDriveBlob(body);
    if (remote.error) return remote;
    audioBlob = remote.blob;
    audioName = remote.name || audioName;
  } else {
    if (!localFile || !localFile.content_base64) {
      return { error: 'server_error', message: 'לא נשלח קובץ אודיו לתמלול' };
    }
    audioBlob = base64ToBlob(localFile.content_base64, detectMimeType(localFile.type, localFile.name));
    audioName = localFile.name || audioName;
  }
  const modelId = (body.model && body.model.indexOf('elevenlabs-') === 0)
`, 'direct eleven start');

  s = rep(s, `  form.append('file', base64ToBlob(file.content_base64, detectMimeType(file.type, file.name)), file.name || 'audio');
`, `  form.append('file', audioBlob, audioName || 'audio');
`, 'direct eleven append');

  write(p, a, s);
}

patchUi();
patchGas();
patchDirect();
