# Ref anchor identity fix — staged plan

## Goal

Make every rendered main reference traceable from source marker to rendered output:

```text
source marker: @04:98
rendered main ref: .stream-ref[data-stream="04"][data-num="98"][data-anchor="..."]
```

This prevents two separate problems:

1. Human/debug ambiguity: `[98]` alone cannot tell whether it belongs to `@01`, `@04`, or `@05`.
2. Layout ambiguity: local split offsets and original paragraph offsets must not share the same `anchor` field.

## Stage A — safe diagnostics only

Current branch adds `scripts/ravtext-ref-identity-audit.js`.

It does not change runtime behavior. It only scans rendered pages and reports whether `.stream-ref` elements have full identity fields.

Run in browser console after rendering:

```js
import('/scripts/ravtext-ref-identity-audit.js').then(m => m.auditRefIdentity())
```

Or, if loaded globally:

```js
RavTextAuditRefIdentity()
```

Expected current result before runtime changes:

```text
streamRefsMissingIdentity > 0
```

That confirms the current output still has visual refs without machine identity.

## Stage B — renderer metadata, no pagination change

Change only `src/engine/renderer.js`:

1. In `buildParaNotesIndex`, read tuple metadata from `tup[7]` when available.
2. Preserve legacy behavior if `tup[7]` is absent.
3. In `appendMainRefElement`, emit:
   - `data-stream`
   - `data-num`
   - `data-uid`
   - `data-anchor`

This stage should not change visual layout.

## Stage C — dom_packer anchor model

Change `src/engine/dom_packer.js`:

1. Add helper functions:
   - `noteAbsoluteAnchor(note)`
   - `noteLocalAnchor(note, prefixOffset)`
   - `noteWithLocalAnchor(note, prefixOffset)`
2. Stop doing `anchor: n.anchor - prefix`.
3. Keep `anchor`/`absoluteAnchor` as original paragraph offsets.
4. Store temporary split offset only as `localAnchor`.
5. Update filters that compare notes to local `wordEnd` so they use `noteLocalAnchor(...)`.
6. Pass the real `prefix` into `findMaxFittingPrefix`.

## Stage D — measurement parity

Make measurement include the same main refs that final rendering includes.

Rule:

```text
what is measured = what is rendered
```

Without this, refs can still shift line breaks after pagination.

## Safety rule

Do not merge stale anchor branches. Apply changes onto current `main` only, with small PRs and one behavior layer at a time.
