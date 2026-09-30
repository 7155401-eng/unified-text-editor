# torahtools → RavText V9 parity map

**Status:** audited 2026-09-30 against the executable desktop source in
`work-files/torahtools/torahtools.sty` and the current web/V9 planner.

## Rule

`torahtools.sty` was a reledmac/XeLaTeX workaround package. Its switches are
**not** a product-settings contract and must not be copied into the browser as
twenty legacy checkboxes.

A switch is ported only when it represents a real user capability. TeX-specific
warning suppression, box hacks and experiments are intentionally retired. The
web equivalent must live in V9 planning/measurement or an existing first-class
setting, never in a post-render geometry pass.

## Mapping

| Desktop flag / mechanism | Old purpose | V9 / web status | Migration decision |
|---|---|---|---|
| `TightHMargins`, `NoTightMargins`, `LooseHMargins` | Change horizontal page margins | `src/page_settings.js` owns top/right/bottom/left margins | **Covered by first-class page settings.** Do not expose the TeX flags. |
| `EmergencyStretchB`, `EmergencyStretchC`, `EmergencyStretchAll` | Give reledmac extra line-breaking tolerance | Styled text is measured before line assignment; V9 paragraph-tail/stream stretch policy is bounded and measured | **Covered architecturally.** No series-specific emergency-stretch flag. |
| `FlushBottom` | Force every TeX page to a common bottom | Desktop source explicitly documents severe regressions | **Retired as unsafe.** V9 uses physical-fit scoring and gap-fill candidates instead. |
| `TextdirFootnotes` | Force RTL direction on footnotes | V9 measurement/render contexts are RTL and preserve BiDi controls | **Covered.** |
| `Sloppy` | Allow very loose global spacing | Desktop source marks it aesthetically destructive | **Retired as unsafe.** |
| `HfuzzLedcenter`, `TinyFuzz` | Hide TeX warnings | No visual correction; diagnostics only | **Not a product capability. Retired.** |
| `WidthX`, `PrintLineWider` | Artificially widen reledmac line boxes | V9 assigns exact strip/row widths before paint | **Retired.** Width must come from the planner, not hidden overhang. |
| `PgbalCutNewdimen` | Work around undefined reledmac balance registers | No equivalent register layer in V9 | **Obsolete implementation workaround.** |
| `CompactFootnotes` | Reduce note baseline/spacing | Stream typography/line-height and inter-stream spacing are first-class settings | **Covered by style/stream spacing settings.** |
| `SplitFootnotes`, `FootinsDimen` | Force long notes to continue instead of overflowing a TeX insertion box | V9 stream overflow/carry keeps started long notes and continues them on following pages | **Covered by planner-native note continuation.** |
| `LoosePagebreaks` | Relax widow/club/inter-footnote penalties | V9 split policy, anchored-note prefix splits and note continuation decide legal boundaries directly | **Covered by V9 split policy; no TeX penalty flag.** |
| `ParagraphFootnotes` | Put note series into one paragraph/column arrangement | Per-stream column count is a first-class web setting | **Covered by stream column settings.** |
| `WordLikeFootnotes` | Initially diagnostic-only shipout instrumentation | Final DOM diagnostics now report real V9 geometry | **Superseded by the layout-analysis report.** |
| `WordLikeBundle` | Bundle `FlushBottom` + aggressive note splitting | One half was explicitly unsafe; the useful half is planner-native continuation | **Do not reproduce as a preset.** |
| `BodyFill`, `BodyFillLevel`, `BodyFillTarget` | TeX penalty hack to reduce large body→notes whitespace | V9 page candidate scoring / final gap fill / sparse rescue work on real geometry | **Covered by planner-native page fill.** |
| `TightTextheight`, `TextheightPad` | Reserve bottom safety space | V9 has page geometry + reserved-bottom planning | **Covered by page geometry / reserved space.** |
| `RealSplitTracker` | Emit per-page CSV diagnostics | `src/layout_analysis_report.js` reads the authoritative final DOM and exports JSON | **Covered and improved.** |

## Important non-ports

The following names must not appear as user-facing V9 switches because the
desktop source itself identifies them as cosmetic, experimental or harmful:

- `FlushBottom`
- `Sloppy`
- `HfuzzLedcenter`
- `TinyFuzz`
- `PrintLineWider`
- `WidthX`
- `PgbalCutNewdimen`

Likewise, the web app must never load or inject `torahtools.sty` or translate
these flags into a hidden CSS/post-render pass.

## Remaining migration work

This audit does **not** declare the whole desktop migration complete. It closes
only the “translate useful torahtools switches into V9 configuration” item.

The remaining page-editing parity is the **Page Tweaker** contract: per-page
`lines_diff` (desktop clamp ±5) and the separate emergency “move one note
line” control. Those must be implemented as V9 planner inputs, not as a second
post-render geometry engine.
