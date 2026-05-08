# torah_nikud — Python → JS migration notes

Verbatim port of the Python tool at `work-files/torah_nikud/` into JavaScript
modules under `src/torah_nikud/`. This file documents anything that could not
be a 1:1 translation and where the JS behavior differs from the Python
original.

## Files mapping

| Python (source)         | JavaScript (target)                              |
|-------------------------|--------------------------------------------------|
| `theme.py`              | `torah_nikud_theme.js`                           |
| `i18n.py`               | `torah_nikud_i18n.js`                            |
| `extractor.py`          | `torah_nikud_engine.js`                          |
| `gas_client.py`         | `torah_nikud_gas.js`  (verbatim payload)         |
| `dicta_client.py`       | `torah_nikud_dicta.js`                           |
| `quota.py`              | `torah_nikud_quota.js`  (see "Server dependency")|
| `webview_app.py`        | `torah_nikud_ui.js`  (orchestration)             |
| `main_window.py`        | `torah_nikud_ui.js`  (UI + run flow)             |
| `widgets.py`            | inline in `torah_nikud_ui.js` (RTL/clipboard handled by browser) |
| `ui.html`               | `torah_nikud_ui.js` + `torah_nikud_modal.css`    |
| `config.json`           | `config.json` (copied verbatim)                  |
| (entry button)          | `torah_nikud.js`                                 |

## GAS routing — Moshe's rule "All AI through GAS"

`torah_nikud_gas.js` is a verbatim port of `gas_client.py`. The payload
structure (`prompt_type`, `model`, `text`, `preserve_spelling`, `use_premium`,
`access_code` | `api_key`) is identical — server side never needs to know
about the client refactor.

One small CORS detail: in browsers we cannot send `Content-Type:
application/json` to Apps Script without preflight; we send
`text/plain;charset=utf-8`. Apps Script's `doPost(e)` reads `e.postData.contents`
verbatim, so this changes nothing on the server.

### Dicta

`dicta_client.py` calls Dicta's public Nakdan endpoint directly (algorithmic,
not an LLM, free, no key). The Python original does the same. We preserve this
exactly — Dicta is *not* a Claude/Gemini call, so Moshe's "All AI through GAS"
rule does not apply. If you ever want to route Dicta through GAS too, add
`prompt_type: "nikud_dicta"` server-side and replace the `fetch` URL in
`torah_nikud_dicta.js`.

## quota.py — server dependency

The Python quota module signs `quota.json` with HMAC-SHA256 derived from
`LICENSE_SECRET`. This prevents the user from manually editing the daily
counter.

The JS port stores the same JSON shape in `localStorage` under
`ravtext.torah_nikud.quota`, but **without** a real signature — there is no
secret available client-side. A determined user can edit `localStorage` to
reset the counter.

For production parity we recommend a thin server endpoint:

* `POST /quota/canSend  { chars }` → `{ ok, reason, used, limit }`
* `POST /quota/record   { chars }` → `{ used, limit }`

Both signed by the same `LICENSE_SECRET` server-side. `torah_nikud_quota.js`
already exposes the same `canSend()` / `recordUsage()` / `usedToday()`
function names, so swapping local storage for a server call is a one-file
change.

## isPaidUser

`webview_app.py._is_paid_user()` calls `license_manager.addons_allowed()`,
which validates a PBKDF2/HMAC license + 42 anti-tamper layers. None of that
runs in the browser.

In JS, `isPaidUser()` returns `false` by default. Hosts that already know the
license status (via auth bridge / cookie / settings JSON) can override:

```js
window.tnkIsPaid = () => true;   // before opening the modal
```

## Recents — file picker limitation

The browser File picker does not give us a stable path (only `File.name`
in the user-gesture callback). The recents list shows the last filenames
but cannot reopen them — the user must re-pick. The pill click shows a
notice. Same limitation as any browser-only file workflow.

## Save dialog

Python uses native Save dialog. JS uses an `<a download>` blob link. The
file is saved to the browser's Downloads folder with the default basename
from `i18n` ("ניקוד רב טקסט לוורד" / "RavText nikud").

## Compare-tool launcher

`webview_app.Api.open_compare_tool()` spawns the local Python text-compare
process. In the browser there is no equivalent. The button is replaced
with a "⤵ החלף בעורך" button that pipes the result back into the host
editor's selection (when available).

## Duplicate keys in `i18n.py`

Several i18n keys appear twice in the Python `STRINGS["he"]` block (Python
dict literals: later definitions win). JavaScript object literals behave
identically — later wins — so the JS port is byte-equivalent.

## Files NOT ported

* `run.pyw` — Python launcher; unused in browser.
* `GAS_NIKUD.gs` — server-side Apps Script source; unchanged, runs on
  Google's side.
