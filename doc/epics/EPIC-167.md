# EPIC-167: Refactoring Phase 6.5 part 2 — Settings editor: browser-profiles and microphone services, site-extension listing, composite sections on the field kit

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the twenty-seventh epic of the [refactoring roadmap](../refactoring-roadmap.md) and part 2 (the last part) of
roadmap item **6.5, Settings editor** (findings **EDT-1** step 5 and **EDT-2** steps 3–5 in
`doc/reviews/refactoring-2026-11/08-editors-tools.md`). Part 1 ([EPIC-166](EPIC-166.md)) built the field kit in
`editors/settings/fields/`, turned the simple sections into field lists, moved headers into the shell and routed
Language, Theme and MCP through their services.

The code was checked on 2026-11-14, after EPIC-166. The current state:

- **Browser profiles.** `BrowserProfilesSectionModel.ts` (175 lines) imports `getPartitionString` from another
  editor's internals (`editors/browser/browser-state.ts:193`), calls `require("electron").ipcRenderer` with
  `BrowserChannel.*` for clearing profile data and permission decisions, owns the profile rules (unique name, remove =
  clear data + clear permissions + reset default) and maps the default profile to `"default"` inconsistently
  (`name || "default"` in three calls, plain `name` in the remove path). It still carries a `DepsGate` for the Tor
  SOCKS port draft. `BrowserProfilesSection.ts` (672 lines) has its own Enter-to-blur handler, two hand-written
  link-or-placeholder path rows (bookmarks file, Tor executable) and builds the translation-target list from
  `ui/translation/*` itself.
- **Microphone.** `MicrophoneAudioSectionView` (inside `SettingsSections.ts`, 672 lines) calls raw `ipcRenderer`
  `on/invoke/send` on `AUDIO_STATUS`, `AUDIO_STATUS_GET`, `AUDIO_RETRY` and `AUDIO_SETTINGS_DEVICES`, maps untyped
  status `mode` strings to messages, strips Chromium's `"Default - "` label prefix, and keeps two hand-rolled number
  drafts (attenuation as a view field, notches as closure-local drafts). `AudioProcessingStatus.mode` is plain
  `string` (`src/ipc/audio-channels.ts:16`). The feature's home is `src/renderer/api/speech/microphone-settings.ts`.
- **Site extensions.** The "listings + trust grants" join is computed twice: `SiteExtensionsSection.refresh` (counts
  trusted and broken extensions) and `tools-hub/SiteExtensionsTab.refresh` (entries plus orphan grants). The Settings
  section's folder row is a third hand-written value box next to `PathField`.
- **Theme and Default browser** have no setting rows: Theme is a card grid over `app.themes` (done in US-1947),
  Default browser is a registration status view over `api`. Nothing to rebuild from fields (see Decisions).

## Goals

- **`api/browser-profiles.ts`** — a browser-profiles service that owns the profile rules, the partition-string and
  `"default"` mapping and the `BrowserChannel` calls; `getPartitionString` moves to a shared module that both the
  browser editor and the service import. `BrowserProfilesSectionModel` keeps only form state.
- **A microphone settings service** in `api/speech/` with `listDevices()` (owning the `"Default - "` rule), a typed
  status union declared next to `AudioProcessingStatus`, `onStatus`, `retry`, and notch read/write; the Microphone
  section renders what it returns and moves to its own file.
- **`siteExtensionStore.listWithTrust()`** (+ a summary) consumed by the Settings section and the Tools hub tab.
- **Composite sections on the field kit:** Browser profiles (Tor port, bookmarks and Tor paths, Enter-to-blur, the
  Tor `DepsGate`), Microphone (attenuation and notch numbers) and Site extensions (folder row) use
  `NumberField`/`PortField`/`PathField`/`CheckboxField` where the control matches.

## Decisions this epic acts on

- **Scope: four tasks; this completes item 6.5.** US-1948 browser-profiles service → US-1951 Browser profiles section
  on fields (planned after US-1948 is implemented, so the plan reads the real service). US-1949 microphone service +
  Microphone section, US-1950 site-extension listing + Site extensions section, planned in parallel with US-1948
  (disjoint files). Implementations run one at a time.
- **Theme and Default browser stay as they are.** EDT-1 step 5 says "keep the composite sections as custom views, but
  build them from the same fields". Neither has a settings-key row, so there is no field to build them from; forcing
  one would add a field kind with a single consumer. Recorded as met.
- **Behaviour is kept.** Every setting keeps its key, value type, normalisation, commit moment, clamping/rejection rule
  and reset value. The default-profile mapping becomes consistent only if the plan shows the remove path's plain
  `name` is never empty there (otherwise it keeps today's exact argument and records it). The microphone status texts,
  their mapping and the default-device rule are unchanged; a status `mode` the union does not list keeps today's
  fallback text. Rendered DOM structure, CSS classes and every `data-name` stay identical (checked by a before/after
  structural fingerprint of every Settings section, as in EPIC-166).
- **Contracts that must not change:** the settings file format and its comments, `appSettings` vs `uiPreferences`
  (D12), browser partition strings (persisted profile data lives under them), the site-extension trust file, IPC
  channel names and payloads (the typed status union types the existing payload; producers send the same strings),
  `app.*` script API, ai-vision paths and output, MCP `call`, `data-name`, `window.persephone` (not touched, so no
  `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Owners.** `api/browser-profiles.ts` (profile rules, partition/`"default"` mapping, browser IPC for profiles);
  `src/shared/browser-partition.ts` or an equivalent shared/core home for `getPartitionString` (the plan proves both
  main-side comment references and both renderer importers); the translation-target list owner named by the US-1948
  plan (an existing `ui/translation/` function if one fits, not the section); `api/speech/microphone-settings.ts` (or a
  sibling file in `api/speech/`) for the microphone service; `api/site-extensions.ts` for `listWithTrust()`.
- **No new protocol code** (guardrail 1): the services call the existing channels; no new correlator or envelope. **No
  `await import()` to break a cycle** (guardrail 5). **God files only shrink** (guardrail 3): `SettingsSections.ts`
  (672), `BrowserProfilesSection.ts` (672), `BrowserProfilesSectionModel.ts` (175), `SiteExtensionsSection.ts` (109),
  `tools-hub/SiteExtensionsTab.ts`.
- **Live verification limits.** The settings file is the user's real configuration: a live check may toggle one value
  and restore it at once, never reset or overwrite the file; it never creates, deletes or renames a real browser
  profile and never starts microphone capture.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1948 | `api/browser-profiles.ts` service and shared partition helper | Done |
| US-1949 | Microphone settings service, typed status, Microphone section on fields | Done |
| US-1950 | `siteExtensionStore.listWithTrust()` for Settings and the Tools hub | Done |
| US-1951 | Browser profiles section on the field kit | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the files under
  "God files only shrink". For every exported symbol that moves or is renamed, list its importers and update them (no
  re-export shims). Every `data-name` in a touched view listed and shown preserved. No unit tests or harnesses.
- **US-1948.** Every `BrowserChannel` call and `getPartitionString` use in Settings → the service method replacing it,
  with the exact argument passed today (including the `"default"` mapping per call). Which profile rules move. Where
  the translation-target list goes. The service API shape follows existing `api/` services (see `api/themes.ts`,
  `api/languages.ts`); say whether it is on `app` (only if a script-API addition is intended — default: not exposed).
- **US-1949.** The status union (every `mode` string any producer sends, found by grep, not assumed); today's
  mode → message mapping kept verbatim; the device listing and default rule; notch/attenuation commit rules today vs
  `NumberField` (range from the settings schema, commit moment, rejection/clamp, resync on external change); the
  section's new file and the lines leaving `SettingsSections.ts`.
- **US-1950.** Both joins today, field by field, and the one entry type that serves both; what the summary counts
  (trusted, broken) and how it is derived; the local grant type in the tab replaced by the IPC type; the folder row on
  `PathField` (same DOM) or why not.
- **US-1951.** Per row of the section: control, key, today's commit rule, `data-name` → the field that replaces it;
  the Tor port on `PortField` (today's range/commit/Enter rule vs `PortField`); the two link-or-placeholder rows on
  `PathField`; what is left in the model.

## Out of scope

- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-166. Findings re-checked against the code (see Overview). Codex weekly window had 33% left at
  the start; the policy pick is Luna for planning as well.

### 2026-11-14 — plan reviews and implementation
- **US-1950.** Plan accepted without corrections. `siteExtensionStore.listWithTrust()` + `summary()` own the join; the
  Settings folder row stays hand-written because `PathField` would drop its named Browse/Reset buttons, the dedicated
  Browse label and the always-present hidden Reset (a DOM and `data-name` change). The browser runtime does no listing
  join (host-scoped lookups only), so it is untouched. `SiteExtensionsSection.ts` 109 → 104, `SiteExtensionsTab.ts`
  242 → 237.
- **US-1949.** Corrections: `blurOnEnter` was not shared (its only uses were the microphone rows), so it moves with the
  section instead of being left unused; the service shape named exactly (`microphoneSettings.listDevices / onStatus /
  retry`), with the status listener attached before the snapshot request as before; the attenuation `NumberField` keeps
  the row panel and its `data-name`. Notch inputs stay custom: today they resync only when the profile is rebuilt, and a
  `NumberField` subscription would make them resync on every external change (a behaviour change). The status union
  lists the seven modes the renderer producers send; main keeps accepting any string and an unknown mode keeps the
  "unfiltered" fallback text. `SettingsSections.ts` 672 → 461; new `MicrophoneAudioSection.ts` (198).
- **US-1948.** Corrections: no `BrowserProfilesSectionActions` coordinator (a third file for a section US-1951 reshapes
  next); confirmations, file dialogs and the non-profile setting writes stay in the model, which calls the service for
  every profile rule and IPC call. The service reads `settings` at call time instead of the section props (same values;
  for remove, read after the two awaited IPC calls, which is what today's code intends). The remove path keeps passing
  the raw name to `clearPermissionDecisions` (the other permission calls map `""` to `"default"`), because nothing
  guarantees stored profile names are non-empty. Only methods with a consumer are added.
- **Live check (cold start, after US-1949 + US-1950):** all 26 Settings section fingerprints identical to the baseline;
  the attenuation field shows an external change, commits on Enter and rejects an out-of-range value (value restored);
  the notch rows render for the selected device; the site-extension summary renders.
- **Live check (cold start, after US-1948):** fingerprints identical; a browser tab opens on the default profile
  partition through the moved `getPartitionString`; the translation-target select renders.
- **US-1951.** Corrections: the named-profile bookmark row also uses `PathField`, over a module-private
  `profileBookmarksStore(name)` adapter (get from `browserProfiles.list()`, watch `browser-profiles`, clear still writes
  `bookmarksFile: undefined`), so `BookmarksFileLineView` is deleted instead of being moved to a new file (that would
  have kept a second copy of the idiom this epic removes); `ChoiceField` item updates named, with the disposal guard;
  the `PathField` `onError` re-throw documented as keeping today's unhandled rejection, not a new toast. Accepted as
  planned: the Tor port on `PortField` (its `parseInt`, inclusive range and `preserveDraftOnSameValue` are today's
  `DepsGate` rule, so the gate and draft leave the model); opt-in `PathField` options (existing host, leading content,
  full-path title, clear title) and `ChoiceField` options (`size`, `fallbackToFirst`) with no change for existing
  consumers. Network lines, profile colours/menus, permission lists and the new-profile form stay custom (not
  single-key settings). `BrowserProfilesSection.ts` 672 → 660 (US-1948) → 604, `BrowserProfilesSectionModel.ts`
  175 → 167 → 133.
- **Live check (cold start, after US-1951):** all 26 section fingerprints and per-section `title` attribute counts
  identical to the baseline; Tor port shows an external change, commits the integer prefix of `"<port>x"` on Enter and
  rejects 80 (value restored); the Windows SSO checkbox writes on click (restored at once); the translation select
  renders.
- **Completion (2026-11-14).** `/review` (Codex): no findings. `/document` updated `browser-editor.md`,
  `folder-structure.md`, `key-files.md` and `model-view-pattern.md` (one folder-structure line corrected by the epic
  owner: the notch settings are not in the microphone service). `/userdoc`: no guide change needed. No English message
  was added or changed; `npm run i18n:check` reports every pack complete (1672/1672). Roadmap item 6.5 is complete.
  Next roadmap item: 6.6 Tool editors.
