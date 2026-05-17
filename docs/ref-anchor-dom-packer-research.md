# dom_packer reference-anchor research

## Scope

This note documents the safe investigation before changing `src/engine/dom_packer.js`.

Current branch already has:

- Stage A: `scripts/ravtext-ref-identity-audit.js`
- Stage B: `renderer.js` emits `data-stream`, `data-num`, `data-anchor`, and reads future tuple metadata from `tup[7]`.

This document is for Stage C: fixing the root `absoluteAnchor` / `localAnchor` problem in `dom_packer.js`.

## Core finding

`dom_packer.js` currently mixes two meanings in the same field:

```text
note.anchor
```

Sometimes it means original paragraph offset. Sometimes it means offset inside a split continuation segment.

The main conversion point is:

```js
const remainingNotes = para.notes
  .filter((n) => n.anchor >= prefix)
  .map((n) => ({ ...n, anchor: n.anchor - prefix }))
  .flatMap(preSplitLongNote);
```

After this line:

- `prefix` is the absolute paragraph offset already consumed.
- `n.anchor` becomes local to `remaining`.
- Later code still serializes the value as `tup[2]` and downstream code cannot know whether it is local or absolute.

## Important nuance

Not all surrounding code is wrong. Many forward-pack calculations already assume this local model:

- `findMaxFittingPrefix(...)` compares `n.anchor < prefixOffset + mid`.
- The caller currently passes `prefixOffset = 0` because `remainingNotes` were already converted to local anchors.
- `clampPrefixToSatisfiedAnchorLine(...)`, `lastAnchorBefore(...)`, and `firstAnchorAtOrAfter(...)` also operate on local anchors after the conversion.

Therefore, a big global change from local to absolute in one commit is dangerous.

## Safer Stage C split

### Stage C1 — Preserve current layout behavior, add metadata

Do not change pagination logic yet.

Change only the identity carried with each note:

```js
.map((n) => ({
  ...n,
  absoluteAnchor: typeof n.absoluteAnchor === "number" ? n.absoluteAnchor : n.anchor,
  localAnchor: n.anchor - prefix,
  anchor: n.anchor - prefix,
}))
```

Then update `addNotesToStreams(...)` to serialize metadata:

```js
out[note.stream].push([
  paraIdx,
  note.text,
  anchor, // keep current layout/render fallback compatible for now
  num,
  cont,
  children,
  runs,
  {
    stream: note.stream,
    num,
    uid,
    anchor,
    absoluteAnchor,
    localAnchor,
  },
]);
```

Expected effect:

- Current packer behavior stays the same.
- Stage B renderer can use `tup[7].absoluteAnchor` for exact output identity.
- Debug HTML can distinguish `@01:98` from `@04:98`.
- This is much safer than changing every `n.anchor < wordEnd` comparison at once.

### Stage C2 — Preserve tuple metadata during rebalance/split

There are many direct tuple constructions after the forward packer.

Examples of risky patterns:

```js
notes.push([paraIdx, part1, target.anchor, tupNum, tupCont, ..., part1Runs])
notes[target.idx] = [paraIdx, part2, target.anchor, tupNum, 1, [], part2Runs]
```

These direct arrays must be replaced with a helper that preserves `tup[7]`.

Recommended helpers:

```js
function noteTupleMeta(tup, streamCode = "") { ... }
function withNoteTupleText(tup, text, cont, children, runs, overrides = {}) { ... }
function makeNoteTuple(paraIdx, text, anchor, num, cont, children, runs, meta = {}) { ... }
```

Required behavior:

- Keep `absoluteAnchor` from the original tuple if present.
- Keep `uid` from the original tuple if present.
- Update `localAnchor` only when intentionally splitting by local text, not when merely moving the tuple between pages.
- Preserve `stream` and `num`.

### Stage C3 — Only after C1/C2 passes: normalize packer calculations

At this point we can consider the larger cleanup:

- Add `noteAbsoluteAnchor(note)`.
- Add `noteLocalAnchor(note, prefixOffset)`.
- Convert local calculations to explicit helpers.
- Pass real `prefix` into `findMaxFittingPrefix`.
- Remove the renderer fallback that guesses local anchors for split paragraphs.

This should be its own PR, not mixed into Stage C1.

## Hotspots found

### Forward packer

1. `remainingNotes` conversion from absolute to local.
2. `addNotesToStreams(...)` serializes `note.anchor` to `tup[2]` with no metadata.
3. `findMaxFittingPrefix(...)` relies on the caller's anchor convention.
4. `clampPrefixToSatisfiedAnchorLine(...)` and `clampPrefixToFirstAnchorLine(...)` rely on the local-anchor convention.

### Rebalance / post-pass

These functions inspect or create note tuples and therefore must preserve future `tup[7]` metadata:

- `findMovableNoteIndices(...)`
- `findMovableNoteIndicesLimited(...)`
- `buildMoveTrial(...)`
- `buildPrefixTrial(...)`
- `findEarliestAnchoredNote(...)`
- `trySplitFirstAnchoredNoteOntoCur(...)`
- `pullOneAnchoredNote(...)`
- `tryPushTailToFitAnchoredNote(...)`
- `tryPushShortTailForward(...)`
- `sortStreamNotes(...)`

The important risk is not just reading `tup[2]`; it is creating a new tuple and dropping `tup[7]`.

## Recommended next code action

Start with Stage C1 only.

Minimal patch:

1. Add helper functions near `addNotesToStreams`:

```js
function noteAbsoluteAnchor(note) { ... }
function noteLocalAnchor(note) { ... }
function noteUid(note, paraIdx, num, absoluteAnchor) { ... }
function noteMetadata(note, paraIdx, num, anchor) { ... }
```

2. Modify `addNotesToStreams(...)` to append metadata as `tup[7]`.

3. Modify only the `remainingNotes` map to preserve `absoluteAnchor` and `localAnchor` while keeping `anchor` local.

Do not change `findMaxFittingPrefix`, `clamp...`, or rebalance yet.

## Success check after Stage C1

After rendering a debug HTML:

```js
RavTextAuditRefIdentity()
```

Expected result:

```text
streamRefsMissingIdentity = 0
streamRefsWithFullIdentity = streamRefElements
```

Then verify that each main `.stream-ref` has:

```html
<span class="stream-ref" data-stream="04" data-num="98" data-anchor="ABSOLUTE_ANCHOR">
```

The visual layout should not materially change in C1.

## Why this order

Changing the whole packer to absolute anchors immediately would require rewriting every local comparison and every rebalance helper at once. That is exactly the kind of large change that can break pagination.

C1 gives us traceability first. Once every rendered reference carries exact identity, later changes can be tested precisely instead of guessing from `[98]` text alone.
