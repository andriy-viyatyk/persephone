# US-1677: `app.languages` write side

## Goal

Add typed scripting and MCP methods to save and delete user language packs and to apply a selected language. Keep pack writes in the user's data directory, and make language application follow the Settings picker lifecycle.

## Background

`src/renderer/api/languages.ts` implements the read facade used by both the script API and the ai-vision namespace. `ILanguages` in `src/renderer/api/types/languages.d.ts` is the shared public contract. Add the write methods to this existing service; `src/renderer/api/app-service-registry.ts`, `src/renderer/api/types/app.d.ts`, `src/renderer/api/app.ts`, and `src/renderer/scripting/ai-vision/root.ts` already expose it. `src/renderer/scripting/ai-vision/namespaces/languages.ts` currently describes it as read-only and owns its English `$help` text.

`languages.validate(pack)` calls `validateLanguagePack(input, filename)` from `src/shared/i18n/validate-pack.ts`. The loader returns a normalized `value` even when it has warnings, after dropping unknown keys, invalid messages, and placeholder mismatches. `validate()` considers a pack valid only when a normalized value exists and the warning list is empty. `save()` must use that exact validation path and refuse every warning so saved data never silently loses a submitted entry.

`refreshLanguagePacks()` in `src/renderer/i18n/startup.ts` resolves assets with `api.getAssetsPath("languages")` and user data with `api.getCommonFolder("userData")`, then reads `<userData>/data/languages`. The renderer filesystem facade in `src/renderer/api/fs.ts` initializes its data root from the same `getCommonFolder("userData")`; `fs.resolveDataPath("languages")` yields the user-pack directory, and `fs.mkdir()` recursively creates it. Writes through `fs.write()` create parent directories, but the atomic-write pattern in `src/renderer/api/custom-theme-storage.ts` explicitly writes a sibling `.tmp` and renames it over the destination. Reuse that pattern.

Roadmap D7 defines `<code>.lang.json`, user-over-built-in per-key precedence, and user pack storage under `%APPDATA%\\persephone\\data\\languages`. EPIC-127 G8 requires API saves to that user directory only. A partial user pack for a built-in code is intended: it replaces only the user-supplied keys at lookup time. Therefore `save()` should replace the user file by default and offer `{ merge: true }` to preserve previous user edits while replacing the incoming keys. On merge, use the submitted pack's metadata, merge message maps, and merge source hashes for untouched messages; when an incoming message replaces an existing message without a source hash, remove the old hash for that key rather than attaching a stale hash to new text.

Protect the destination from path traversal. `validateLanguagePack()` checks filename/code equality but does not enforce a language-code grammar. Before constructing a path, require a safe BCP-47-like code segment (letters/digits separated by hyphens, with a 2–8-letter primary subtag), normalize through `normalizeLanguageCode()`, and use only that normalized code in the filename. Reject `en` and `en-XA` for writes; `en-XA` is synthetic and only available to `apply()` in development.

The Settings picker in `src/renderer/editors/settings/sections/LanguageSection.ts` sets `settings.language`, awaits `flushSettingsSave()`, then awaits `api.reloadAllWindows()`. `src/ipc/main/core-handlers.ts` handles `reloadAllWindows` by broadcasting `EventEndpoint.eReloadForLanguage` and returns; each renderer's `RendererEventsService.handleReloadForLanguage()` first awaits `saveWindowStateForShutdown()` and then calls `window.location.reload()`. On startup, `src/renderer/i18n/startup.ts` reads the saved setting and packs, then reports its resolved locale through `api.setActiveLocale()`. `src/main/i18n-locale.ts` handles that report by re-reading both built-in and user packs, updating main-process translations, and rebuilding the tray. Thus apply should reuse the picker path, and main-process pack re-reading already occurs after the renderer reload; no separate main-process reload is needed in `save()`.

For an MCP call, `apply()` must resolve a small `{ code, scheduled: true }` result before initiating the broadcast, because that broadcast reloads the calling renderer too. Schedule `api.reloadAllWindows()` on a later task (with a short delay so the call result can cross the MCP bridge); do not await the broadcast from `apply()`. The existing broadcast handler does not synchronously reload a renderer: the receiver first saves window state asynchronously, then reloads. Acceptance must verify that an MCP caller receives the scheduled result before the calling window disappears. `apply()` always schedules the reload, even when `settings.language` already equals `code`, because a just-saved pack needs a reload to take effect.

All method signatures, results, warnings, and `$help` are agent-facing documentation and remain English per roadmap D3. `apply` help must state that it reloads every window and that an agent must ask the user first (G7).

### Before → after API shape

```ts
// Before
interface ILanguages {
  validate(pack: unknown): PackValidationView;
  validateBoard(boardRoot: string, code: string): Promise<BoardValidationView>;
}

// After
interface ILanguages {
  validate(pack: unknown): PackValidationView;
  validateBoard(boardRoot: string, code: string): Promise<BoardValidationView>;
  save(pack: unknown, options?: { merge?: boolean }): Promise<LanguageSaveResult>;
  delete(code: string): Promise<LanguageDeleteResult>;
  apply(code: string): Promise<LanguageApplyResult>;
}
```

Use compact serializable results: save returns `{ code, path, saved: true, warnings: [] }` on success and `{ code?, saved: false, warnings }` when validation refuses it; delete returns `{ code, deleted: boolean }` (`false` means there was no user pack); apply returns `{ code, scheduled: true }`. Invalid codes, protected save codes, unsupported apply codes, and filesystem errors should throw clear errors. `delete()` only resolves a path inside the user language directory, so an absent pack returns `deleted: false` and a built-in pack is never removed.

## Implementation Plan

1. [x] **Extend the public language API.** Added save/delete/apply option and result interfaces and methods, keeping `save` input as `unknown`; JSDoc documents replace-by-default, merge, warning refusal, user-only deletion, `auto`, and the user-confirmation requirement.
2. [x] **Implement writes in the renderer facade.** Save reuses `validate()`, rejects unsafe and protected codes, reads only user packs for merge, validates merged output, retains/removes source hashes per incoming key, and atomically writes UTF-8 JSON to the user language folder.
3. [x] **Implement user-only deletion.** Delete validates and normalizes the code, checks only the user language path, and leaves built-in packs and settings untouched.
4. [x] **Implement picker-equivalent apply.** Apply accepts the documented special codes and available packs, persists the setting, and schedules the every-window reload after returning its scheduled result.
5. [x] **Expose methods and document their MCP behavior.** Added discovery signatures, English help covering validation, replace/merge, user-only deletion, and the reload/user-first requirement; updated the root member summary.
6. [ ] **Verify the behavior.** Verify save/merge, `get(code, area)` provenance, apply/reload, deletion, warning refusal, and MCP result delivery through the existing manual/MCP QA path. Do not add automated tests.
   - [x] `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass. Live MCP saved a one-message `uk` pack, merged a second message and confirmed both with `from: "user"`, refused a wrong-placeholder `zz` pack without creating a file, then deleted `uk`; the `uk`, `zz`, and temp files are absent.
   - [ ] Live `apply()` result timing remains unverified because this task explicitly forbids calling it live.

## Concerns

- **Warnings are refusals.** `validateLanguagePack()` returns a normalized value despite dropped entries, so checking only for `value` would silently discard malformed or unknown messages. Refuse if the validator yields any warning and return those warnings in the save result.
- **Merge scope is user-only.** A partial user pack should remain partial; copying the built-in pack into it would create unnecessary files and stale translations. `{ merge: true }` merges only an existing user pack and the new payload.
- **Source hashes track exact message revisions.** When an incoming message replaces an old message but omits its source hash, discard the previous hash for that key. Unchanged messages retain their old source hashes.
- **Locale code safety.** The shared validator checks filename equality, not code syntax. Enforce a path-safe BCP-47-like code before writing or deleting and build the path from its normalized form.
- **Reload result delivery.** Reload IPC is broadcast and the receiving renderer reload is asynchronous after saving its window state. The apply method must not await it; the MCP acceptance step checks the result is returned before reload begins.
- **Active pack deletion.** Deleting a selected user pack does not rewrite the setting or reload windows. Built-in text takes effect on a later reload; applying the current code remains an explicit operation.

## Acceptance Criteria

- `app.languages.save(pack, options?)`, `delete(code)`, and `apply(code)` are available with types in `src/renderer/api/types/languages.d.ts` and method discovery in ai-vision.
- `save()` calls the same validator as `validate()` and returns warnings without writing when validation has any warning; it refuses `en`, `en-XA`, and unsafe codes.
- Successful `save()` writes a UTF-8, no-BOM, pretty-printed user file atomically at `<userData>/data/languages/<code>.lang.json`, creating the directory if needed. Default mode replaces that file; `{ merge: true }` preserves untouched user messages/source hashes and replaces only submitted keys.
- Built-in codes can have partial user override packs. The saved user pack contains only user data, and reads continue to show user provenance for overridden keys.
- `delete()` removes only a user pack. Missing user packs return `{ code, deleted: false }`; a same-code built-in pack remains intact and becomes effective again after reload.
- `apply("auto")` and `apply("en")` work without a file; `apply("en-XA")` works only in development. Other codes require a pack in built-in or user pack storage and invalid/unavailable codes fail clearly.
- `apply()` flushes the language setting, returns `{ code, scheduled: true }` before initiating the broadcast, schedules a reload even when the setting is unchanged, and matches Settings by reloading every window. MCP QA confirms the result reaches the caller before its renderer reloads.
- The startup locale report causes `src/main/i18n-locale.ts` to re-read user and built-in packs and rebuild the tray; no direct main-process pack-refresh call is added to save/apply.
- `$help` is English and tells the agent that apply reloads every window and requires asking the user first.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/api/languages.ts` | Implement validated save, user-only delete, and persisted/scheduled apply. |
| `src/renderer/api/types/languages.d.ts` | Add write method signatures and result types. |
| `src/renderer/scripting/ai-vision/namespaces/languages.ts` | Describe write methods and add English `$help` warnings. |
| `src/renderer/scripting/ai-vision/root.ts` | Update the `languages` member summary. |
| `doc/active-work.md` | Link US-1677 under EPIC-127. |
| `doc/epics/EPIC-127.md` | Link US-1677 in the epic task table. |
| `src/renderer/api/custom-theme-storage.ts` | **No change:** reuse its atomic temp-file/rename pattern. |
| `src/renderer/api/fs.ts` | **No change:** reuse `resolveDataPath`, `mkdir`, `write`, `rename`, `exists`, and `delete`. |
| `src/renderer/i18n/startup.ts` | **No change:** reuse `refreshLanguagePacks()` and its user-data resolution. |
| `src/renderer/editors/settings/sections/LanguageSection.ts` | **No change:** its `settings.set` → `flushSettingsSave` → reload flow is the apply reference. |
| `src/renderer/api/settings.ts` | **No change:** reuse `flushSettingsSave()`. |
| `src/ipc/main/core-handlers.ts` | **No change:** reuse `reloadAllWindows` broadcast. |
| `src/renderer/api/internal/RendererEventsService.ts` | **No change:** existing reload handler saves window state before reloading. |
| `src/main/i18n-locale.ts` | **No change:** startup locale reports already re-read packs and rebuild the tray. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | **No change:** language facade registration already exists. |
| `src/shared/i18n/validate-pack.ts` | **No change:** use its existing `validateLanguagePack` and `normalizeLanguageCode`; add only the API path-safety check. |
| `assets/editor-types/**` | **Generated:** refresh declarations through the existing editor-types build workflow; do not hand-edit. |
