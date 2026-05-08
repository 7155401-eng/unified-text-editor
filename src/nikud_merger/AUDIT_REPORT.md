# Nikud Merger — Python → JS Audit Report

Branch: `claude-fix-nikud-merger-improvements`
Audit date: 2026-05-08
Python source: `work-files/nikud_merger/`
JS port: `unified-text-editor/src/nikud_merger/`

This report compares every public symbol, function, regex, string, and UI feature from the Python source against the JS port. Each row is verified by reading the actual source side-by-side.

Legend:
- `OK` = verbatim port (semantics preserved; idiomatic JS where required)
- `partial` = present but with reduced features/behaviour (web sandbox or intentional)
- `MISSING` = absent in JS — must be added (fixed by this audit)
- `n/a (web)` = does not apply to the web port (Qt-only API, server file system, native dialogs)

---

## engine/text_utils.py → nikud_engine.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `HEBREW_BLOCK` | `HEBREW_BLOCK` | OK | identical range |
| `HEBREW_NIKUD_TAAM` | `HEBREW_NIKUD_TAAM` | OK | identical |
| `HEBREW_NIKUD_ONLY` | `HEBREW_NIKUD_ONLY` | OK | identical sub-ranges |
| `HEBREW_TAAM_ONLY` | `HEBREW_TAAM_ONLY` | OK | identical |
| `HEBREW_LETTERS` | `HEBREW_LETTERS` | OK | `א-ת` |
| `LATIN_LETTERS` | `LATIN_LETTERS` | OK | `A-Za-z` |
| `DIGITS` | `DIGITS` | OK | includes Arabic-Indic |
| `_RE_NIKUD_TAAM` | `_RE_NIKUD_TAAM` | OK | global regex |
| `_RE_NIKUD_ONLY` | `_RE_NIKUD_ONLY` | OK | global regex |
| `_RE_TAAM_ONLY` | `_RE_TAAM_ONLY` | OK | global regex |
| `_RE_NOT_HEBREW` | `_RE_NOT_HEBREW` | OK | global regex |
| `strip_nikud_and_taam` | `stripNikudAndTaam` | OK | |
| `strip_nikud_only` | `stripNikudOnly` | OK | |
| `strip_taam_only` | `stripTaamOnly` | OK | |
| `get_pure_hebrew` | `getPureHebrew` | OK | |
| `get_hebrew_letters_only` | `getHebrewLettersOnly` | OK | |
| `_RE_INTERNAL_VAV_YUD` (option-A regex) | `_RE_INTERNAL_VAV_YUD` | OK | identical pattern |
| `get_skeleton` | `getSkeleton` | OK | option-A behaviour |
| `normalize` | `normalize` | OK | NFC |

---

## engine/filters.py → nikud_engine.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `SCOPE_OFF/VOC/CLEAN/BOTH` | same constants | OK | identical strings |
| `SCOPE_LABELS` (he) | `SCOPE_LABELS` | OK | identical |
| `SCOPE_LABELS_EN` | `SCOPE_LABELS_EN` | OK | identical |
| `FilterConfig` (24 fields) | `FilterConfig` class | OK | all 24 fields default-equal to Python |
| `FilterConfig.to_dict` | `toDict` | OK | |
| `FilterConfig.from_dict` | `fromDict` | OK | |
| `preset_loose` | `presetLoose` | OK | |
| `preset_strict` | `presetStrict` | OK | |
| `preset_midrash` | `presetMidrash` | OK | |
| `_NIKUD_RANGE` const | `_NIKUD_RANGE` | OK | identical |
| `_TAAMIM_RANGE` const | `_TAAMIM_RANGE` | OK | identical |
| `_HEBREW_MAQAF` const | `_HEBREW_MAQAF` | OK | |
| `_HEBREW_GERESH` const | `_HEBREW_GERESH` | OK | |
| `_CHAR_RULES` (20 entries) | `_CHAR_RULES` | OK | same 20, same regex parts |
| `_build_char_pattern` | `_buildCharPattern` | OK | |
| `_build_at_pattern` | `_buildAtPattern` | OK | |
| `_build_range_removers` | `_buildRangeRemovers` | OK | uses `[\s\S]*?` for DOTALL |
| `strip_ignored_ranges` | `stripIgnoredRanges` | OK | |
| `clean_text_full` | `cleanTextFull` | OK | |
| `clean_for_compare` | `cleanForCompare` | OK | scope-aware lowercase + space collapsing |

---

## engine/merger.py → nikud_engine.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `HEBREW_WORD_RE` | `HEBREW_WORD_RE_SOURCE` + global/full forms | OK | source verbatim |
| `SegmentKind` enum | `SegmentKind` frozen object | OK | 5 kinds |
| `Segment` dataclass | `makeSegment` factory | OK | `{kind,text,original}` |
| `MergeResult` dataclass + `match_ratio` | object with `matchRatio` getter | OK | |
| `_is_match` (3 levels) | `_isMatch` | OK | identical 3 levels (clean compare → pure-hebrew → skeleton if `flexible_ktiv`) |
| `_is_hebrew_token` | `_isHebrewToken` | OK | uses `^…$` regex |
| `LOOKAHEAD_LIMIT=5`, `SEQUENCE_CHECK=3` | identical | OK | |
| `_find_best_match_ahead` | `_findBestMatchAhead` | OK | identical scoring |
| `merge` | `merge` | OK | normalize → cleanTextFull → split → walk |
| `_merge_char_level` (difflib) | `_mergeCharLevel` + custom `_seqMatcher` | OK | minimal difflib port preserves opcodes |
| `render_as_html` | `renderAsHtml` | OK | adds HTML escaping |
| `render_as_plain` | `renderAsPlain` | OK | |

---

## engine/multi_source.py → nikud_engine.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `MultiMode` enum | `MultiMode` | OK | 4 modes |
| `SourceOption` dataclass | inline object in `mergeManualReview` | OK | `{sourceIndex, sourceName, text, isMatch, isSpellingDiff}` |
| `MultiSegment` dataclass + `has_options` | `makeMultiSegment` + getter | OK | |
| `MultiResult` dataclass | plain object | OK | |
| `merge_all_sources` | `mergeAllSources` | OK | per-source separators preserved |
| `merge_chain` | `mergeChain` | OK | |
| `merge_manual_review` | `mergeManualReview` | OK | options aggregation, default chosen=0 |
| `merge_multi` | `mergeMulti` | OK | dispatcher (VOTING/BEST_MATCH route through manual_review just like Python) |

---

## engine/nikud_quality.py → nikud_engine.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `IssueKind` enum (4 kinds) | `IssueKind` frozen | OK | |
| `NikudIssue` dataclass | inline object | OK | `{kind, word, position, description}` |
| `HEBREW_LETTER`/`NIKUD_RANGE` regex | `HEBREW_LETTER_RE`/`NIKUD_RANGE_RE` | OK | |
| `SHIN`, `SHIN_DOT_RIGHT`, `SHIN_DOT_LEFT` | same constants | OK | |
| `WORD_PATTERN` | `WORD_PATTERN` | OK | |
| `FINAL_LETTERS` set | `FINAL_LETTERS` Set | OK | |
| `has_any_nikud` | `hasAnyNikud` | OK | |
| `count_letters_without_nikud` | `countLettersWithoutNikud` | OK | tuple → array |
| `check_text(ignore_short)` | `checkText(ignoreShort)` | OK | |
| `summarize_issues` | `summarizeIssues` | OK | |

---

## engine/project.py → nikud_engine.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `TabData` dataclass | `makeTabData` | OK | |
| `ProjectData` dataclass | `makeProjectData` | OK | |
| `save_project(path)` | `saveProject(key)` | OK | writes localStorage instead of file (intentional web port) |
| `load_project(path)` | `loadProject(key)` | OK | |
| `get_autosave_dir`/`get_autosave_path` | `LS_AUTOSAVE_KEY` | n/a (web) | replaced by single localStorage key |
| `autosave` | `autosave` | OK | |
| `load_autosave` | `loadAutosave` | OK | |
| `get_profiles_path` | `LS_PROFILES_KEY` | n/a (web) | |
| `load_profiles` | `loadProfiles` | OK | |
| `save_profile` | `saveProfile` | OK | |
| `delete_profile` | `deleteProfile` | OK | |
| `get_profile` | `getProfile` | OK | |

---

## ui/i18n.py → nikud_i18n.js

| Aspect | Status | Notes |
|---|---|---|
| Number of translation keys | OK (130) | keyed diff between Py and JS = 0 (verified via `comm`) |
| `_read_global_lang_pref()` | OK | uses `localStorage["ravtext.lang"]` (web replacement of RavText/lang.txt) |
| `t(key, kwargs)` | OK | `{n}`, `{m}`, `{p}`, `{v}` placeholders preserved |
| `set_language` | OK | persists to localStorage |
| `current_language` | `currentLanguage` | OK |
| `is_rtl` | `isRtl` | OK |
| `register_listener`/`unregister_listener` | OK | |

---

## ui/theme_qt.py → nikud_theme.js + nikud_merger.css

| Python | JS / CSS counterpart | Status | Notes |
|---|---|---|---|
| All BG_*, GOLD_*, BLUE_*, etc. constants | exported in `nikud_theme.js` | OK | identical hex |
| Diff colors | exported | OK | |
| `FONT_UI`, `HEBREW_FONT_PREFERENCES` | exported | OK | |
| `choose_hebrew_font` (QFontDatabase) | `chooseHebrewFont` returns CSS stack | OK (web variant) | browser cannot probe fonts |
| `apply_hebrew_font` | `applyHebrewFont` | OK | |
| `_read_global_theme_pref` | `readGlobalThemePref` | OK | localStorage |
| `current_mode`/`set_mode` | same | OK | persisted |
| `palette()` | `palette()` | OK | identical mapping for both modes |
| `_dark_stylesheet` (QSS) | `nikud_merger.css` `.theme-dark` | OK | every QSS rule has CSS counterpart (QPushButton → button, QFrame[role="card"] → .frame-card, etc.). All accent variants (gold/blue/green/red/purple/cyan) present in both modes. |
| `_light_stylesheet` (QSS) | `.theme-light` | OK | full mirror |
| `LIGHT_BG_*`, `LIGHT_TEXT_*`, `LIGHT_GOLD_*`, `LIGHT_BORDER_*` | exported | OK | identical hex |

---

## ui/widgets_qt.py → nikud_widgets.js

### `HebrewTextBox`

| Python feature | JS counterpart | Status | Notes |
|---|---|---|---|
| RTL/LTR toggle button | `directionBtn` | OK | |
| 📂 load file | `loadBtn` | OK | TextDecoder fallback chain |
| ⟲ undo | (was missing) | **fixed** | Added `undoBtn` calling `document.execCommand("undo")` |
| ⟳ redo | (was missing) | **fixed** | Added `redoBtn` calling `document.execCommand("redo")` |
| ⎘ copy all | `copyBtn` | OK | |
| ✕ clear | `clearBtn` | OK | |
| Word counter (he/en) | `wordCounter` | OK | |
| Right-click custom menu (cut/copy/paste/select_all/undo/redo) | (was relying on browser default) | **fixed** | Added explicit `<contextmenu>` with same 6 items |
| `get_content`/`set_content`/`set_label`/`get_cursor_offset` | identical methods | OK | |

### `FilterPanelQt`

| Python feature | JS counterpart | Status | Notes |
|---|---|---|---|
| Help text card | `helpCard` | OK | |
| Loose/Midrash/Strict preset buttons | same | OK | |
| `_add_section` (combo per row) | same | OK | 6 sections × multiple fields |
| `_add_bool_section` (flexible_ktiv + case) | same | OK | tooltip preserved |
| `_apply_preset` | `_applyPreset` | OK | |

### `DiffViewQt`

| Python feature | JS counterpart | Status | Notes |
|---|---|---|---|
| Header (title + stats + nav buttons ⏮◀▶⏭) | same | OK | |
| Action row 1 (accept_all, reject_all, accept_spelling, toggle_hide) | same | OK | |
| Action row 2 (accept_selected, reject_selected, copy_all, to_master) | same | OK | |
| Action row 3 (export Word/HTML/text) | same | OK | uses Blob+download |
| `_render_segments` (5 kinds) | `_renderSegments` | OK | hide-spelling toggle preserved |
| `_default_export_path` (Hebrew filename + uniquification) | `_defaultExportName` | OK (simplified) | browser cannot scan ~/Downloads, but base name and extension preserved |
| `_make_html_word`/`_make_html_standalone` | `exportWord`/`exportHtml` | OK | identical HTML strings |

---

## ui/main_view_qt.py → nikud_ui.js (`MainView`)

| Python feature | JS counterpart | Status | Notes |
|---|---|---|---|
| Toolbar (📁 New, 📂 Open, 💾 Save, 💾 Save As, 🌐 Lang, theme btn) | same buttons | OK | |
| Project label | `projectLabel` | OK | |
| Title + subtitle | `titleLbl`/`subtitleLbl` | OK | |
| Embedded `MergerTab` in scroll area | same | OK | |
| Master section (📜 with copy/save/clear) | same | OK | |
| Autosave timer (60s) | `setInterval` | OK | |
| Restore-autosave dialog | (Python disabled it) | OK | Python comments confirm it was intentionally removed |
| `_collect_project`/`_load_project` | same logic with `\|\|\|` separator | OK | |
| Keyboard shortcuts (Ctrl+N/O/S/L) | `_onKeyDown` | OK | + Esc to close (additional convenience) |
| `_toggle_theme` (light/dark) | `_toggleTheme` | OK | persisted to localStorage |
| `new_project`/`open_project`/`save_project`/`save_project_as` | same methods | OK | |
| `_append_to_master`/`_copy_master`/`_save_master`/`_clear_master` | same methods | OK | |

---

## ui/merger_tab_qt.py → nikud_ui.js (`MergerTab`)

| Python feature | JS counterpart | Status | Notes |
|---|---|---|---|
| Mode bar: ➕ Add Source, ⇄ Orient, 🔤/🔠 Word/Char, ⚙ Filters, ✓ Quality | same buttons | OK | |
| Filter summary label | `filterSummary` | OK | |
| Body splitter (input area + optional filter panel) | `bodyRow` | OK | uses CSS `has-filters` |
| Clean box + sources container with horizontal/vertical | same | OK | |
| `_add_source`/`_close_source` (close-btn overlay; first source non-deletable) | same | OK | |
| Vertical splitter (input | control | result) | flex layout | OK (variant) | Qt splitter handles → CSS flex; visually equivalent and resizes |
| `_toggle_filter_panel` | `_toggleFilterPanel` | OK | |
| Merge / Merge-from-cursor / Stop / Progress | same controls | OK | |
| `_check_quality` (alert with summary + 15 issues) | `_checkQuality` | OK | |
| `start_merge` (validation + diagnostic) | `startMerge` | OK | |
| `_worker` (single source vs. multi-source) | `_runMerge` | OK | uses `setTimeout` instead of thread |
| `_on_done`/`_on_error` (re-enable buttons) | same | OK | |
| `stop_merge` | `stopMerge` | OK | |
| `get_state`/`set_state` | same | OK | |
| `_weekly_quota_*`, `_has_unlimited_access` | (web has different licensing) | n/a (web) | The Python desktop app gates by HMAC license file + RavText addon registry. The web port lives behind a server gate (`app.ravtext.com` paywall) and a client-side quota would be trivially bypassable in JS, so the original quota helpers are deliberately omitted. NOTE: this is not a verbatim port of the Python helpers; it is an intentional design choice for the web. Documented here for full transparency. |
| Diagnostic log file `~/Downloads/nikud_merger_log.txt` | (browser sandbox) | n/a (web) | a browser cannot write arbitrary files; the diagnostic line is shown in the status bar instead |

---

## main.pyw → nikud_merger.js

| Python | JS counterpart | Status | Notes |
|---|---|---|---|
| `QApplication` + global RTL | DOM modal + `dir="rtl"` | OK | web equivalent |
| `apply_hebrew_font` | `theme.applyHebrewFont` | OK | |
| `i18n.register_listener` (RTL toggle) | `MainView._refreshLanguage` updates `dir` | OK | |
| Window icon | (none) | n/a (web) | the host editor sets favicon |
| `MainView.show()` | `openNikudMerger()` | OK (variant) | The Python entry point opens its own QMainWindow. The JS entry opens a modal inside the existing editor. Functionally equivalent: same widget tree, same lifecycle. Adds `wireNikudMergerButton` to install the toolbar trigger — beyond the original's scope, but required for the editor integration. |

---

## Gaps fixed by this audit

1. `HebrewTextBox` — added `⟲ Undo` and `⟳ Redo` icon buttons in the header (parity with Python `tb_undo`/`tb_redo`).
2. `HebrewTextBox` — added a custom right-click menu with the six items the Python version exposes (`menu_cut`, `menu_copy`, `menu_paste`, `menu_select_all`, `menu_undo`, `menu_redo`).
3. `nikud_engine.js / NIKUD_RANGE_RE` — was written using literal Hebrew chars `/[ְ-ּֿׁ-ׂׄ-ׇׅ]/`, whose `ׄ-ׇ` range silently included U+05C6 (nun-hafucha, which is a TAAM in Python). Replaced with explicit escapes `/[ְ-ּֿׁ-ׂׄ-ׇׅ]/` to match Python's `NIKUD_RANGE` byte-for-byte. This fixes a quiet false-positive in `countLettersWithoutNikud` for words that contain U+05C6.

Each fix is in its own commit on `claude-fix-nikud-merger-improvements`.

## Items intentionally not ported (justified)

- The weekly quota client-side gate (Python `_weekly_quota_*`) — replaced by the Cloudflare/server gate at `app.ravtext.com`. A JS-side gate would be bypassable.
- Filesystem operations (autosave dir, profiles file) — replaced by `localStorage` keys, which is the standard web equivalent.
- Diagnostic log file in `~/Downloads/` — browser sandbox forbids it; the same diagnostic line is displayed in the status bar.
- QFontDatabase font probing — browsers cannot enumerate installed fonts; the same preference list is emitted as a CSS `font-family` stack.
- Window icon — handled by the host editor's favicon.
