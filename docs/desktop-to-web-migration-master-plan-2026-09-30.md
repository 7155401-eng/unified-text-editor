# RavText — Desktop → Web Migration Master Plan

**Source repository:** `7155401-eng/work-files`  
**Target repository:** `7155401-eng/unified-text-editor`  
**Audit date:** 2026-09-30

## Goal

Bring the useful behavior of the older desktop RavText into the web application without copying desktop-only architecture blindly.

The migration contract is:

1. Preserve user-visible behavior and data semantics.
2. Translate Python/Tk/PyQt/LaTeX concepts to browser/Worker/V9 equivalents.
3. Never copy desktop license secrets, key generators, anti-tamper files, machine-bound state, PyInstaller/build plumbing or local filesystem assumptions into browser code.
4. Paid/Premium accounts are unlimited for migrated tools unless a third-party provider itself imposes a hard external limit.
5. Free accounts keep the closest practical equivalent of the old product's free allowance.
6. Quotas are authoritative on the server. Client state may display remaining allowance but must not be the source of truth.
7. A port is not "done" until source behavior, quota behavior, UI entry point, error behavior, persistence and regression tests are all mapped.

## Status legend

- **VERIFIED PORT** — dedicated migration/audit exists and source behavior was cross-walked.
- **PRESENT / ACCEPTANCE NEEDED** — web capability exists, but full desktop parity has not been re-audited.
- **PARTIAL / POLICY GAP** — functionality exists but licensing/quota or action timing differs.
- **MISSING** — no equivalent dedicated web capability found in the initial audit.
- **TRANSLATE, DO NOT PORT LITERALLY** — desktop implementation is platform-specific; preserve the user goal using web architecture.

## 1. Already migrated or substantially present

| Desktop capability | Web target | Status | Required follow-up |
|---|---|---|---|
| Word extraction: sizes, colors, footnotes/endnotes/comments, HTML, styles, headers/footers, parallel streams | `src/word_extractor/*` | VERIFIED PORT | Keep smoke/unit parity tests authoritative. |
| Nikud merger | `src/nikud_merger/*` + Worker engine | VERIFIED PORT / QUOTA PARITY ACTIVE | Server-authoritative rolling 7-day quota: one successful merge for Free; Premium/Admin unlimited; retries are idempotent. |
| Torah nikud | `src/torah_nikud/*` | VERIFIED/PRESENT | Remove duplicate once/day preflight restriction; move 500-char/day accounting to server. |
| Sefaria downloader | `src/sefaria/*` | VERIFIED PORT | Restore one-book-per-week free policy on successful download. |
| Sefaria live verse tool | `src/sefaria/*` | VERIFIED PORT | Restore one-use-per-week free policy on successful fetch. |
| Text Compare Pro | `src/text_compare_pro/*` | PRESENT | Deep parity audit of tabs/history/settings and old storage semantics. |
| RavText comparator/editor | `src/comparator_tool/*` | PRESENT | Restore weekly + 15-minute-session semantics. |
| AI transcription | `src/torah_transcription/*` | PRESENT | Old launcher states this tool is free; current generic daily preflight is not parity. |
| Caricature tool | `src/haredi_caricature/*` + `worker/caricature.js` | PRESENT | Enforce generation quota on successful generation, not tool opening. Old executable quota module says 24 hours; an app_ui comment says 48 hours — executable quota is the current source of truth unless product decision changes it. |
| Opening word / dropped initial | `src/opening_word.js`, V9 inline layout modules | PRESENT | Continue V9 acceptance fixtures. |
| Mishnah/Gemara/Vilna layouts | `src/vilna_v9.js`, `src/mishna_wrap_layout.js`, `src/talmud_controls.js` | PRESENT | Continue pagination/spacing regression hardening. |
| Main/stream columns | `src/balanced_columns.js`, stream settings/V9 | PRESENT / ACCEPTANCE NEEDED | Compare all desktop 1/2/3-column cases and min-lines behavior. |
| Stream layout roles / side layouts | `src/stream_roles_picker.js`, `src/original_stream_columns.js`, V9 footer grouping | PRESENT / ACCEPTANCE NEEDED | Explicitly verify side-note, parallel/translation and combined-note geometry. |
| Separate bold/emphasis styling | document/stream style system | PRESENT | Regression tests already exist for semantic bold vs selected style. |
| Page size, spacing, document style | `page_size.js`, `page_settings.js`, `spacing_settings.js`, `document_style_settings.js` | PRESENT | Cross-walk every desktop setting. |
| Headers/page numbers/document features | `document_features.js` | PRESENT / ACCEPTANCE NEEDED | Verify odd/even/header/footer behavior against desktop. |
| Word import/export bridge | `word_bridge.js`, `word_export_serialization.js` | PRESENT | This is web Word round-trip, not the old local installer. |
| Stream links / nested notes | `stream_links.js`, `stream_links_ui.js`, nested-note modules | PRESENT | Compare against old link-related tools before declaring replacements. |
| Track changes / footnotes / TOC | `footnotes_toc_track.js` | PRESENT | Check note-only accept/reject semantics separately. |
| Autosave / persistence | server storage + browser persistence | PRESENT | Desktop filesystem paths are not relevant; verify recovery behavior instead. |

## 2. Capabilities that appear present but still need a feature-by-feature parity audit

These must not be marked complete merely because a similarly named control exists:

- automatic bracket-size reduction;
- automatic removal of curly-brace markers;
- page preview semantics from the desktop compiler;
- "more than 3 streams" entitlement/limits;
- explicit spacing before/after notes;
- side notes;
- parallel translation beside main text;
- integrated marginal/gloss notes;
- advanced column balancing;
- main stream 2/3-column behavior;
- footnote stream 2/3-column behavior;
- Word-derived page header styles;
- all desktop global-fix checkboxes;
- all `torahtools` experimental layout switches that still have a meaningful V9 equivalent;
- automatic page-shape beta behavior vs current V9.

For each item, create a fixture from the desktop behavior, define the expected web DOM/export result, then port only the semantic rule.

## 3. Missing or not yet located as dedicated web tools

Initial repository audit did not find a dedicated equivalent for the following old catalog/menu capabilities. Before implementing, run one more symbol/content search to ensure the behavior was not folded into another module.

1. Visual page tweaker/editor equivalent to `page_tweaker_ui.py`.
2. Torah OCR / image-PDF manuscript conversion tool (old catalog: one free use per week).
3. Text-to-speech (TTS) module.
4. Automatic link combiner.
5. Convert Word footnotes to curly-brace inline text.
6. Split footnotes by tag.
7. Dedicated "add links to commentary" workflow — compare with current stream-links before porting.
8. Bot-assisted text comparison after combining notes with source.
9. Accept/reject changes only inside footnotes — compare with current generic Track Changes first.
10. Fast merge of footnotes from a split Word document.
11. Link-transplant form/workflow.
12. Dedicated local Word add-in installer equivalent. This cannot be copied as a browser installer; translate to an Office Add-in/web bridge or a small signed desktop companion only if still required.
13. Advanced visual PDF analyzer/report/tweaker workflows from `pdf_analyzer.py`, `pdf_report.py`, `pdf_viewer.py` where current browser preview/debug export does not cover the same job.

The old "luxury Hasidic image bot" was itself marked **in development**, so it is not a parity blocker unless product scope explicitly promotes it.

## 4. Desktop infrastructure that must NOT be copied literally

These are not missing product features:

- `license_manager.py`, `license_shadow.py`, `keygen.py`, `keygen_ui.pyw`, `protection_layers.py`, local HMAC state;
- PyInstaller/Cython/build-protection scripts;
- Windows registry/AppData shadow state;
- local HTTP server inside `app_ui.py`;
- desktop install paths and process launchers;
- Tk/PyQt widget code when a DOM implementation already exists;
- local sqlite/filesystem cache where D1/KV/browser/server storage is the correct web equivalent.

The user-facing goal should be translated; the desktop mechanism should not be transplanted.

## 5. Free/Premium policy parity — current high-priority defect

The web currently has a generic server preflight policy of **one use per tool per day** for most public tools. That is not the desktop product policy.

Verified desktop rules:

| Tool | Old free behavior | Premium behavior | Correct web charging point |
|---|---|---|---|
| Word extractor/import core | core workflow; no addon usage quota | unlimited | no quota |
| Comparator/editor | 1 use / 7 days; a use is a 15-minute active session | unlimited | first real edit/action starting a session, not opening the window |
| Nikud merger | 1 successful merge / 7 days | unlimited | ✅ server-authoritative on successful merge (Batch A2) |
| Sefaria downloader | 1 successful book export / 7 days | unlimited | successful export |
| Sefaria live | 1 successful fetch / 7 days | unlimited | successful fetch |
| Torah nikud | 500 characters / local day | unlimited | successful nikud response; charge actual input characters |
| Caricature | executable quota module: 1 successful generation / 24h | unlimited | successful generation |
| AI transcription | old launcher explicitly says free always | unlimited/free | no RavText usage quota |
| Text Compare Pro | no usage-quota check found in initial launcher audit | unlimited/free pending deeper audit | do not invent a daily quota without source evidence |
| OCR | old catalog says 1 / week | unlimited/addon | successful OCR job |

### Required server architecture

Replace the generic daily gate with one policy registry. Example semantic shape:

```
tool -> {
  freeMode: unmetered | count | units | session | cooldown,
  limit,
  windowSeconds,
  sessionIdleSeconds,
  chargeOn: open | action-success,
}
```

Requirements:

- Premium short-circuits to unlimited.
- Preflight authorizes opening a tool but does **not** consume an action-success quota.
- Quota consumption is transactional on the Worker after success.
- Retried requests use an idempotency key so one logical action is not charged twice.
- Unit quotas (Torah nikud) are stored server-side.
- Session quotas (Comparator) record a session start and last activity.
- UI quota bars read server state; `localStorage` is display/cache only.
- Keep `tool_usage` migration compatibility while moving to a generalized event/bucket table.
- Admin accounts remain unlimited unless a deliberate test override is enabled.
- Add tests for paid bypass, free exhaustion, window reset, idempotent retry and concurrent requests.

## 6. Migration batches

### Batch A — quota/policy correctness (do first)

1. Add server policy registry and generalized quota persistence.
2. Move existing tools from generic once/day to their source-equivalent policies.
3. Stop charging tool-open events where desktop charged only successful actions.
4. Remove client-only authoritative quota logic after server parity is live.
5. Add Premium-unlimited tests for every tool.

### Batch A2 progress

- ✅ Nikud merger: migrated from generic once/day preflight charging to a rolling 7-day server quota recorded only after a successful merge. Opening the tool and quality checks do not consume quota. Premium/Admin are unlimited; idempotency prevents retry double-charging.

### Batch B — missing high-value document tools

Port in this order because they reuse Word parsing already present:

1. footnotes → curly braces;
2. footnote splitter by tag;
3. fast footnote merge;
4. accept/reject footnote-only changes;
5. link-transplant form;
6. dedicated commentary-link workflow.

Each should use `word_export_serialization.js` / the existing DOCX worker paths rather than introduce a second DOCX parser.

### Batch C — OCR / TTS / AI tools

1. Torah OCR with weekly free policy.
2. TTS as its own provider-backed server action.
3. bot-assisted text compare.
4. only then any new image-generation tool that was not production-ready in the desktop app.

### Batch D — visual/page tools

1. Page tweaker parity audit.
2. PDF analyzer/report functionality missing from the browser preview.
3. Translate useful `torahtools` switches into V9 configuration; do not embed the old LaTeX package as the new layout authority.

### Batch E — Word integration

Decide between:

- web-only DOCX round-trip (already present);
- Office Add-in connected to RavText web;
- optional signed desktop companion.

Do not ship the old Windows installer inside the web application.

## 7. Definition of done for each migrated feature

A feature is complete only when all boxes are checked:

- [ ] old source behavior mapped function-by-function or scenario-by-scenario;
- [ ] web architecture chosen;
- [ ] input/output semantics preserved;
- [ ] settings persisted;
- [ ] Hebrew/RTL behavior verified;
- [ ] quota policy matches source product;
- [ ] Premium is unlimited;
- [ ] free limit is server-authoritative;
- [ ] success-only charging where applicable;
- [ ] unit tests;
- [ ] browser test;
- [ ] build test;
- [ ] no build-time patch rewrites the migrated source unexpectedly;
- [ ] manual acceptance fixture from a real document;
- [ ] migration notes updated.

## 8. Immediate implementation order

1. Finish the current V9 spacing/pagination regressions.
2. Implement **Batch A quota/policy correctness**.
3. Re-audit the "present / acceptance needed" extension list against `work-files/extension_map.json`.
4. Port Batch B one tool at a time, with one PR per tool.
5. Port OCR/TTS/AI tools only after the shared quota service is authoritative.
6. Run a final old-vs-new capability matrix and leave no row in an unknown state.

This document is the migration source of truth. Update the row status in the same PR that ports or verifies a capability.
