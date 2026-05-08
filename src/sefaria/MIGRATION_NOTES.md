# Sefaria full-port — migration notes

This is the verbatim translation of the 6 Python Sefaria modules from
`work-files/` to `unified-text-editor/src/sefaria/`. The pre-existing
partial port at `src/torah_tools.js` was NOT touched (per Moshe's
instructions); the new modules live alongside it.

## Files

| Source (Python)              | Port (JS)                         | Notes                                    |
| ---------------------------- | --------------------------------- | ---------------------------------------- |
| `sefaria_api_client.py`      | `sefaria_api_client.js`           | retry 1→2→4, rate-limit 5/sec, no cache  |
| `sefaria_book_metadata.py`   | `sefaria_book_metadata.js`        | 119 books, 30 commentators, presets      |
| `sefaria_preset_manager.py`  | `sefaria_preset_manager.js`       | 7 builtin + user CRUD via localStorage   |
| `sefaria_docx_builder.py`    | `sefaria_docx_builder.js`         | uses `fflate` for zip                    |
| `sefaria_downloader_ui.py`   | `sefaria_downloader_modal.js`     | Tk → DOM modal, full feature parity      |
| `sefaria_live_tool.py`       | `sefaria_live_modal.js`           | pywebview → DOM, paste+regex+batch       |
| (new)                        | `sefaria_dh.js`                   | DH/anchor algorithm                       |
| (new)                        | `sefaria_i18n.js`                 | every string he+en (~70 keys)            |
| (new)                        | `sefaria_modal.css`               | luxury dark+light theme + RTL fixes      |
| (new — entry)                | `sefaria.js`                      | wires 2 buttons into `.torah-toolbar`    |

## Wired into the editor

`src/main.js` calls `wireSefariaTools(paneManager)` at bootstrap (just
after `wireTorahTools`). It appends a single `tb-group.sef-tool-group`
containing two buttons:

* `📖 הורד ספר` — opens the downloader modal.
* `🔍 השלם פסוקים בטקסט` — opens the live verse picker modal.

The existing `torah_tools.js` (Sefaria verse picker, gimatria, Hebrew
date, special chars) is left untouched and continues to populate the
rest of the toolbar.

## Quota / license integration

The Python originals call `usage_quota.check_and_show_dialog(...)` and
`license_manager.require_addon_license(...)` before any download/fetch
runs. In the JS port we leave the equivalent hooks **unwired** and
expose two integration points:

1. **Downloader** — `openSefariaDownloader({ loadDocxIntoEditor })`
   accepts a callback. Wire it through the editor's existing license /
   quota gate before invoking the underlying `buildAndDownloadDocx`.
2. **Live picker** — `openSefariaLive({ isVip, onAccept })`. Pass
   `isVip: true` when the user has an active license; otherwise the UI
   shows the locked banner with the 500-character textarea cap (the
   exact behaviour from the Python `generate_html()` `is_vip` branch).

The original 5-req/sec rate-limit + retry behaviour is fully preserved
inside `sefaria_api_client.js`. The original sqlite cache was dropped
per Moshe's decision; the Hebrew error log is kept (in localStorage).

## Storage keys

| Key                                | Purpose                |
| ---------------------------------- | ---------------------- |
| `ravtext.sefaria.user_presets`     | user-saved presets     |
| `ravtext.sefaria.favorites`        | starred books          |
| `ravtext.sefaria.recent`           | last 10 loaded refs    |
| `ravtext.sefaria.errors_log`       | Hebrew error log       |
| `ravtext.lang`                     | "he" or "en" UI lang   |
| `ravtext.theme`                    | "dark" or "light"      |

## Build

`fflate ^0.8.2` was added to `package.json`. `npm install` is required
once before the build picks it up. `vite build` succeeds in 2.4 s and
produces a single 870 kB bundle (gzipped 277 kB) — the chunk-size
warning is pre-existing and unrelated to this port.
