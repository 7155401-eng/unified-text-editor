import fs from 'node:fs';

const checks = [
  ['index.html', [
    'ravtext-floating-language-switcher-style',
    'ravtext-floating-language-switcher-script',
  ]],
  ['worker/ai_tools.js', [
    'RAVTEXT_LARGE_ELEVENLABS_MULTIPART_PATCH',
    'handleElevenLabsMultipartUpload',
  ]],
  ['worker/minute_access.js', [
    'RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH',
    '__ravtextElevenLabsLargeUploadPatch',
  ]],
  ['worker/ai_direct.js', [
    'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_DIRECT',
    'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_DIRECT',
    'RAVTEXT_GEMINI_503_RETRY_PATCH',
    'uploadDriveToGemini',
  ]],
  ['src/torah_transcription/torah_transcription_gas.js', [
    'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS_COMPAT',
    'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_GAS',
    'requestBody.drive_url',
  ]],
  ['src/torah_transcription/torah_transcription_ui.js', [
    'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_UI',
    'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_UI',
    'RAVTEXT_GOOGLE_DRIVE_PUBLIC_LINK_NOTICE_PATCH',
    'RAVTEXT_UPLOAD_LIMIT_GUIDANCE_PATCH',
    'RAVTEXT_PAID_GEMINI_KEY_NOTICE',
    'RAVTEXT_FAST_SINGLE_TRANSCRIPTION_PATCH',
  ]],
  ['src/document_chapter_splitter.js', [
    'chapter_server_api.js',
    'importWordChaptersOnServer',
    'extractWordChapterOnServer',
  ]],
  ['src/engine_bridge.js', [
    'function normalizeStreamTitleNoteText',
    'function isDuplicateStreamTitleNote',
    'function applyFirstNoteAsTitle',
  ]],
  ['src/main.js', [
    'LIVE_RENDER_DEFAULT_OFF_IN_SOURCE',
    'const LIVE_RENDER_CHOICE_KEY = LIVE_RENDER_KEY + ".userChoice";',
    'if (localStorage.getItem(LIVE_RENDER_CHOICE_KEY) !== "1") return false;',
    'function setupLiveRenderToggle()',
  ]],
  ['src/render_pause_controls.js', [
    'LIVE_RENDER_DEFAULT_OFF_IN_SOURCE',
    'const LIVE_CHOICE_KEY = LIVE_KEY + ".userChoice";',
    'if (localStorage.getItem(LIVE_CHOICE_KEY) !== "1") return false;',
  ]],
];

const failures = [];
for (const [file, tokens] of checks) {
  const source = fs.readFileSync(file, 'utf8');
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(file + ': missing ' + token);
  }
}

if (failures.length) {
  console.error('[source-state] integrated source verification failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log('[source-state] integrated production state is present in tracked source');
