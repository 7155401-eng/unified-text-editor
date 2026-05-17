# Backup: settings sync 413 fix

Date: 2026-05-17

## Main code commit

`7ad5c8779719b303d4b48ab58efb32cc2bb2cc27`

## Problem

Console logs showed repeated `/api/settings` failures with HTTP 413. A localStorage size inspection showed that `ravtext.panes.state.v1` alone was about 527KB, and the full `ravtext.*` settings payload was about 551KB.

That key is document/pane state, not a user settings preference, and should be saved through `/api/documents/current`, not `/api/settings`.

## Files changed

- `src/server_persistence.js`

## Practical fix

1. Added a payload-size guard for settings sync: `MAX_SETTINGS_SYNC_BYTES = 200 * 1024`.
2. Added `ravtext.panes.state.v1` to the settings-sync blacklist.
3. Added temporary/content/security keys to blacklist:
   - `ravtext.nikud_merger.autosave`
   - `ravtext.cssInject.css`
   - `ravtext.caricature.gemini_api_key`
   - `ravtext.torah_transcription.config`
4. Added blacklist prefixes:
   - `ravtext.ai.apiKey.`
   - `ravtext.caricature.`
   - `ravtext.torah_transcription.`
   - `ravtext.talmudLayout.smartCache.`
5. Added `_lastFailedSettingsSig` to avoid retrying the exact same failed settings payload.
6. Added warning diagnostics that summarize the largest synced settings keys when a settings save fails.
7. Guarded the `pagehide` beacon path with the same size/signature checks.

## What this should not affect

- It should not delete local document state.
- It should not block `/api/documents/current` document sync.
- It should not block normal settings such as `ravtext.streamSettings.v1`, `ravtext.customStyles.v1`, layout flags, or style choices.

## Expected result

The browser should stop sending oversized `/api/settings` PUT/beacon payloads and should stop repeatedly hitting HTTP 413 for the same settings snapshot.

## Verification checklist

1. Log in and open the app.
2. Change a small setting, such as a stream title or layout flag.
3. Confirm `/api/settings` no longer returns 413.
4. Confirm document content still saves via `/api/documents/current`.
5. Confirm `ravtext.panes.state.v1` remains in localStorage locally but is not included in the `/api/settings` payload.
