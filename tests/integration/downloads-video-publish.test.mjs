import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");

test("downloads preserve the user gesture and do not revoke Blob URLs immediately", () => {
  const source = read("src/downloads_panel.js");

  assert.match(source, /showSaveFilePicker/);
  assert.match(source, /pickSaveFile\("ravtext-document\.html"/);
  assert.match(source, /pickSaveFile\("ravtext-document\.json"/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*URL\.revokeObjectURL\(url\)[\s\S]*\}, 60_000\)/);

  const htmlFn = source.slice(
    source.indexOf("async function downloadDocumentHTML"),
    source.indexOf("async function downloadDocumentJSON")
  );
  const pickerAt = htmlFn.indexOf("pickSaveFile(");
  const serverAt = htmlFn.indexOf("secureExportHtmlBlob(");
  assert.ok(pickerAt >= 0 && serverAt > pickerAt,
    "save picker must be requested before the async secure-export roundtrip");
});

test("video gallery publishing is disabled unless the admin explicitly enables it", () => {
  const video = read("worker/video_gallery.js");
  const worker = read("worker/index.js");
  const header = read("src/premium/header_icons.js");
  const admin = read("public/admin.html");

  assert.match(video, /GALLERY_ENABLED_KEY = 'VIDEO_GALLERY_ENABLED'/);
  assert.match(video, /return \(await readSetting\(env, GALLERY_ENABLED_KEY\)\) === '1'/);
  assert.match(video, /if \(!enabled\) \{[\s\S]*items: \[\]/);
  assert.match(video, /typeof body\.enabled === 'boolean'/);
  assert.match(video, /Playlist must be configured before publishing videos/);

  assert.match(worker, /isVideoGalleryEnabled/);
  assert.match(worker, /videoGalleryEnabled,/);

  assert.match(header, /auth\.videoGalleryEnabled === true \|\| auth\.admin === true/);
  assert.match(header, /if \(videosIcon\) actions\.insertBefore\(videosIcon/);
  assert.match(header, /isVideoGalleryAdmin\(\)[\s\S]*\/api\/admin\/video-gallery\/playlist/);

  assert.match(admin, /data-tab="videos">סרטונים/);
  assert.match(admin, /id="vg-enabled"/);
  assert.match(admin, /מוסתרת מהמשתמשים כברירת מחדל/);
  assert.match(admin, /JSON\.stringify\(\{ enabled \}\)/);
});
