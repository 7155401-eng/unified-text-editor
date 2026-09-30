# Legacy layout package → V9 parity contract

**Audited:** 2026-09-30 against current web/V9 owners.

## Rule

The legacy desktop layout package is not a settings specification for the web
application. A legacy switch is retained only when it represents a real
user-visible capability. Engine-specific warning suppression, box overhang
tricks, and globally loose/forced-bottom experiments stay retired.

All retained behavior must be owned by planner/measurement code or a
first-class setting before paint; do not recreate it as a post-render geometry
mutation.

## Current owners

| Legacy capability class | Current owner | Decision |
|---|---|---|
| Page margins / reserved page geometry | `src/page_settings.js` | First-class web setting |
| Stream column count / compact note layout | `src/original_stream_columns.js` | First-class stream setting |
| Long-note continuation / overflow safety | `src/vilna_v9.js` | Planner-native |
| Anchored split legality | `src/engine/v9_split_policy.js` | Planner-native |
| Page-fill / sparse-page decisions | `src/vilna_v9.js` | Planner-native |
| Final-layout diagnostics | `src/layout_analysis_report.js` | Read-only final geometry report |

## Explicit non-ports

These legacy implementation switches remain retired and must not become hidden
web settings or build-time geometry patches:

- `FlushBottom`
- `Sloppy`
- `HfuzzLedcenter`
- `TinyFuzz`
- `PrintLineWider`
- `WidthX`
- `PgbalCutNewdimen`

Production source must not import, inject, or load `torahtools.sty`.

## Remaining work

This contract closes only the old package-switch migration question. Separate
feature-parity work remains separate and must be implemented through current
web/V9 architecture, one feature at a time, with its own fixture and tests.
