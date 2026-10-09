# US-1638: `app.themes` scripting / MCP API

Epic: [EPIC-123: Custom themes](../../epics/EPIC-123.md)

## Progress

- [x] Read project guidance and reviewed implementation plan.
- [x] Implement the `app.themes` facade, public types, and service registration.
- [x] Add preview overlay and preserve it across settings/theme-file reloads.
- [x] Add MCP discovery hints and scripting/agent guides.
- [x] Run typecheck, lint, and production build; fix reported issues.
- [x] Record live MCP verification observations.

### Live verification (Claude, 2026-10-09)

Over MCP against the dev renderer; every theme created was deleted afterwards.

- **Discovery:** `call themes` lists all twelve members; `save`, `rename`, `delete`, `apply` and
  `preview` carry their CAUTION annotations.
- **Read side:** `list()` 11 themes; mutating a `get()` result left the registry unchanged (clone);
  `derive()` returned 77 colors; `contrast()` 17 pairs; `fork("persephone")` returned no `id`.
- **No overwrite between forks:** two forks of Persephone saved under the same name became
  `custom-claude-fork` and `custom-claude-fork-2`; the first fork's colors equal Persephone's.
- **rename** kept the id and changed the name in the registry.
- **apply** switched `current` and persisted `settings.theme` in the calling window.
- **preview** published `current.id === "preview"`, applied the draft background, and left
  `settings.theme` untouched. It survived a theme-file rewrite (registry reload) and an
  `appSettings.json` rewrite (settings reload). `endPreview()` restored the persisted theme.
- **Explicit selection ends preview:** `apply("persephone")` during a preview replaced it and
  persisted.
- **Deleting the active theme** switched to `persephone` and persisted it.
- Not checked live: Monaco and board palettes during a preview (no editor or board on screen), and
  window-local preview with a second window.

### Verification status

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build-prod` — passed; Vite reports existing ineffective dynamic import and large-chunk warnings.
- Live renderer/MCP verification was not available in this environment; the observations required by the acceptance criteria remain outstanding.

## Goal

Expose custom and built-in themes through a typed `app.themes` service that scripts and MCP callers can use to inspect, derive, fork, preview, save, rename, delete, and apply themes. All values crossing this public boundary are plain `CustomThemeFile`, `ThemeDefinition`-shaped, or contrast-report data; renderer models and registry objects stay private.

## Background

### Existing theme layers

- `src/renderer/theme/custom-theme.ts` owns `deriveTheme`, `buildCustomTheme`, `baseFromTheme`, `overridesFor`, `contrastReport`, and `validateCustomThemeFile`. API code must call these functions rather than re-deriving colors, validating files independently, or routing overrides itself.
- `src/renderer/api/custom-theme-storage.ts` owns `loadAll`, `saveCustomTheme`, `renameCustomTheme`, `deleteCustomTheme`, file validation/building, writes, and the themes-directory watcher. `loadAll()` returns `{ file, theme }` records; the public facade must project these into plain API values.
- `src/renderer/theme/themes/index.ts` owns the combined registry, `getAvailableThemes()`, `getThemeById()`, `applyTheme()`, `replaceCustomThemes()`, and same-id definition revisions. `themeState` is a plain `{ id, isDark, revision }` snapshot.
- `src/renderer/api/settings.ts` applies the persisted setting while loading it. US-1637's live finding is that `app.settings.set("theme", id)` persists but does not apply the theme in the calling window; other windows apply it through their settings-file watcher. `app.themes.apply(id)` must explicitly perform both operations.
- US-1637's live renderer check verified Settings selection, custom-file watcher updates, active-file deletion falling back to `persephone` in memory, restoration of that file, cold-start application, and propagation to a second window. It did not verify Monaco or board palettes after same-id replacement.

### Existing `app.*` and MCP pattern

`src/renderer/api/types/app.d.ts` is the script contract. Every service has a public interface in `src/renderer/api/types/*.d.ts`, is registered in `src/renderer/api/app-service-registry.ts`, and is exposed by the descriptor-backed `app` getters in `src/renderer/api/app.ts`. `src/renderer/scripting/api-wrapper/AppWrapper.ts` exposes registered services to scripts; its comment documents that service APIs pass through, so the service itself must expose only safe, serializable public values. The compile-time service-table checks require `IApp`, the descriptor list, and wrapper surface to agree.

`vite.renderer.config.ts:38-75` copies every API `.d.ts` into `assets/editor-types/` on dev startup/build and watches those source files. No hand-maintained duplicate declaration should be added to `assets/editor-types/`.

For MCP, `src/renderer/scripting/ai-vision/root.ts` describes root service paths, `src/renderer/scripting/ai-vision/namespaces/index.ts` registers AiVision descriptors against service instances, and a namespace descriptor supplies member signatures, summaries, `caution`, and `$help`. `src/renderer/scripting/ai-vision/call.ts` resolves the renderer tree and `src/renderer/api/mcp/call-command.ts` is the generic MCP call entry; those generic routes need no theme-specific behavior. `app.call()` uses the same renderer tree. The `IAiMember.caution` field is the existing annotation for writes and visible side effects (see `namespaces/settings.ts` and `namespaces/recent.ts`).

Agent-facing scripting examples live in `assets/guides/scripting/api/`; the index is `assets/guides/scripting/api/index.md`, and the longer agent procedure is `assets/guides/agents/scripting.md`. These guides are shipped from `assets/guides/` and should explain both direct script calls and `call` paths.

### Preview ownership and reload behavior

Preview is renderer-window-local, exists only in renderer memory, and never writes `appSettings.json` or a theme file. A temporary definition must remain discoverable through `getThemeById(themeState.get().id)` because Monaco's `configure-monaco.ts` subscription looks up the active definition by that id. Use the reserved runtime id `preview` for every preview, publish it in `themeState.id`, and keep the definition in a private active-preview overlay consulted by `getThemeById("preview")`. Since `preview` fails storage's `^custom-...` safe-id pattern, it cannot become a saved theme; the overlay also cannot shadow a saved or built-in id. Exclude it from `getAvailableThemes()` so it does not become a selectable/cyclable registry entry. `current` returns a cloned plain definition with id `preview` and the draft's name while previewing. This lets existing Monaco, board-palette, CSS, and global-style subscribers see the actual preview definition and revision.

`custom-theme-storage.ts`'s `reloadRegistry()` calls `replaceCustomThemes(..., settings.theme)`, and `settings.ts:loadSettings()` applies `newSettings["theme"]` on watcher reload. Both paths must preserve and reapply an active preview. Keep the persisted setting as the restoration source: `endPreview()` clears the overlay and applies the latest `settings.theme` if it exists, otherwise `persephone`. An explicit `app.themes.apply(id)`, Settings picker selection, or theme cycling ends preview and selects the registry definition. Saving a draft persists only; it does not select a theme or end preview. A preview left running by a script stays active until explicitly ended or superseded, but a renderer reload or app restart ends it. US-1639 will own cleanup of a board-started preview when that board closes or reloads.


### `applyTheme()` caller classification

Keep `applyTheme(id)` as the explicit-selection entry point: it clears preview, applies the registry definition, and publishes theme state. Add one preview-aware entry point, for example `applyThemePreservingPreview(id)`, and use it only for the two reload paths. Startup continues to call `applyTheme()` before a preview can exist.

| Caller | Meaning | Before | After |
|---|---|---|---|
| `src/renderer/api/settings.ts:348` | Settings-file load/reload | `applyTheme(newSettings["theme"])` | `applyThemePreservingPreview(newSettings["theme"])` |
| `src/renderer/editors/settings/sections/ThemeSection.ts:177` | User selects a Settings theme card | `applyTheme(themeId)` | `applyTheme(themeId)` — explicit selection clears preview; existing `settings.set("theme", themeId)` persists. |
| `src/renderer/theme/themes/index.ts:94` | `replaceCustomThemes()` registry reload | `applyTheme(getThemeById(wantedId) ? wantedId : persephone.id)` | `applyThemePreservingPreview(getThemeById(wantedId) ? wantedId : persephone.id)` — apply saved selection only when no preview is active. |
| `src/renderer/theme/themes/index.ts:166` | `cycleTheme()` explicit selection | `applyTheme(themes[nextIndex].id)` | `applyTheme(themes[nextIndex].id)` — explicit selection clears preview. |
| `src/renderer/theme/themes/index.ts:172` | Initial startup application | `applyTheme(readStartupThemeId())` | `applyTheme(readStartupThemeId())` — preview cannot exist yet. |

```ts
// Before: all five callers invoke applyTheme().
applyTheme(newSettings["theme"]);                 // settings reload
applyTheme(themeId);                              // ThemeSection selection
applyTheme(getThemeById(wantedId) ? wantedId : persephone.id); // registry reload
applyTheme(themes[nextIndex].id);                 // cycleTheme()
applyTheme(readStartupThemeId());                 // startup

// After: only the two reload callers preserve preview.
applyThemePreservingPreview(newSettings["theme"]); // settings reload
applyTheme(themeId);                              // ThemeSection selection clears preview
applyThemePreservingPreview(getThemeById(wantedId) ? wantedId : persephone.id); // registry reload
applyTheme(themes[nextIndex].id);                 // cycleTheme() clears preview
applyTheme(readStartupThemeId());                 // startup; no preview exists
```

## Implementation Plan

1. **Add the public theme service without changing theme algorithms.** Create `src/renderer/api/themes.ts` as a thin facade over the existing custom-theme model, storage functions, settings service, and theme registry. Implement `list(): ThemeDefinition[]`, `get(id): ThemeDefinition | undefined`, `current: ThemeDefinition`, `derive(base, isDark?)`, `contrast(themeOrFile)`, `fork(id): ThemeDraft`, `save(draft)`, `rename(id, name)`, `delete(id)`, `apply(id)`, `preview(themeDraft)`, and `endPreview()`. Clone arrays/records before returning values (`colors`, Monaco `colors`, `base`, and `overrides`); never return `SavedCustomTheme`, a live registry array/member, a state object, or a class instance.

   - `list()` projects `getAvailableThemes()` to cloned plain definitions; `get()` returns a clone or `undefined`; `current` resolves the current theme id through `getThemeById()` and returns a clone.
   - `derive()` delegates directly to `deriveTheme()`. `contrast()` accepts a plain `ThemeDefinition`, `CustomThemeFile`, or id-less `ThemeDraft`; validate file-shaped input through `validateCustomThemeFile()` and call `buildCustomTheme()` before `contrastReport()`. For a draft, supply a private valid placeholder id only for validation/building. Invalid input rejects with a readable error.
   - Define script-facing `ThemeDraft` as `Omit<CustomThemeFile, "id"> & { id?: string }`. `fork(id)` gets the registry definition, extracts `baseFromTheme(theme)`, computes `overridesFor(theme, base)`, and returns a `ThemeDraft` without an id, with `schemaVersion: 1`, preserved `theme.isDark`, and a copy name. It does not allocate or reserve an id. `save(draft)` without an id delegates to the existing storage create path, which generates a unique id at save time; with an id, it replaces that existing custom theme only. The saved file returned by `save()` is the canonical file/id.
   - `save()` delegates to `saveCustomTheme()` and returns a cloned `CustomThemeFile`; `rename()` delegates to `renameCustomTheme()` and returns its cloned file. Do not expose the storage layer's `{file, theme}` wrapper.
   - `delete()` delegates to `deleteCustomTheme()` directly. This is required for the US-1637 behavior that deleting the currently selected file persists `persephone` in this window and reloads the registry; do not delete files or persist fallback independently in the API facade.

2. **Add the script-facing declarations.** In `src/renderer/api/types/themes.d.ts`, declare public structural types for `CustomThemeBase`, `CustomThemeFile`, `ThemeDraft = Omit<CustomThemeFile, "id"> & { id?: string }`, theme colors/Monaco colors, and contrast measurements/report, plus `IThemes`. Type method inputs and outputs in the file itself or through other script-facing declarations; do not import internal renderer model types into the shipped `.d.ts` graph. Add `readonly themes: IThemes` to `IApp` in `src/renderer/api/types/app.d.ts`, with JSDoc examples. The build plugin copies `themes.d.ts` and regenerates `_imports.txt` automatically.

   API return contract:

   | Member | Return |
   |---|---|
   | `list()` | cloned `ThemeDefinition[]` |
   | `get(id)` | cloned `ThemeDefinition \| undefined` |
   | `current` | cloned active `ThemeDefinition` (the preview definition while previewing) |
   | `derive(base, isDark?)` | plain derived `ThemeDefinition` |
   | `contrast(themeOrFile)` | plain `ContrastReport` |
   | `fork(id)` | id-less `ThemeDraft` derived via the US-1636 helpers |
   | `save(draft)` / `rename(id, name)` | `Promise<CustomThemeFile>` |
   | `delete(id)` / `apply(id)` / `endPreview()` | `Promise<void>` |
   | `preview(themeDraft)` | cloned active `ThemeDefinition` with id `preview` and the draft name |

3. **Register the service and path hints.** Add the `themes` service descriptor to `src/renderer/api/app-service-registry.ts`, with a dynamic import of `src/renderer/api/themes.ts` and `IApp["themes"]` return type. Add the `themes` root property to `src/renderer/scripting/ai-vision/root.ts`. Add `src/renderer/scripting/ai-vision/namespaces/themes.ts` with a descriptor for each public member, accurate signatures and short discovery summaries; annotate `save`, `delete`, `apply`, and `preview` with `caution`. `$help` must say preview is renderer-memory state that ends on window reload/app restart, persists until `endPreview()` or explicit selection while the renderer stays open, is window-local, and does not persist settings/files; also explain that apply changes this window immediately and saves the selected id. Include a forward pointer that US-1639 will clean up a board-owned preview on board close/reload. Register the service instance with `registerAiVisionFor(themes, describeThemes)` in `namespaces/index.ts`. The generic call path already resolves these descriptor-backed nodes; do not add parallel MCP handlers.

   Required before/after root member shape:

   ```ts
   // Before: root has no theme-management path.
   { name: "settings", kind: "property", node: true, summary: "Application settings (read/write)." },

   // After: scripts and MCP discover the same typed namespace.
   { name: "themes", kind: "property", node: true, summary: "Inspect, derive, preview, and manage themes." },
   ```

   Required mutation annotations follow the existing `caution` field on `IAiMember`:

   ```ts
   { name: "preview", kind: "method", signature: "preview(themeDraft)", summary: "Apply a temporary theme in this window.", caution: "changes this window's appearance until endPreview() or explicit selection" }
   { name: "save", kind: "method", signature: "save(draft)", summary: "Persist a custom theme file.", caution: "writes a custom theme file to the user's data folder" }
   { name: "apply", kind: "method", signature: "apply(id)", summary: "Apply and persist the selected theme.", caution: "changes this window's appearance and persists the selected theme" }
   { name: "delete", kind: "method", signature: "delete(id)", summary: "Delete a custom theme file.", caution: "deletes a custom theme file; deleting the selected theme persists the persephone fallback" }
   ```

4. **Implement a temporary preview overlay in `src/renderer/theme/themes/index.ts`.** Add a private active-preview definition and explicit operations used by `src/renderer/api/themes.ts`. `preview(themeDraft)` accepts `ThemeDraft` with optional id; ignore/strip any supplied id for preview identity, and validate/build through US-1636 by adding a private valid placeholder custom id for that operation. Set the resulting definition's runtime id to reserved `preview`, apply its colors, color scheme, and native theme in the calling renderer, and advance `themeState.revision`. Make `getThemeById("preview")` resolve the overlay only while active; do not insert it into `themes` or return it from `getAvailableThemes()`. `current` returns a cloned definition with id `preview` and the draft name. `endPreview()` clears the overlay and applies the current persisted setting (falling back to `persephone`). Keep all app/settings persistence out of this theme-registry module to avoid the existing `settings.ts` import cycle.

5. **Preserve preview only on the two reload paths.** Keep `applyTheme(id)` as the explicit-selection function and have it clear preview. Add one preview-aware registry entry point and call it from exactly `src/renderer/api/settings.ts:348` (settings-file load/reload) and `src/renderer/theme/themes/index.ts:94` (`replaceCustomThemes()` reload). Continue using explicit `applyTheme(id)` from `src/renderer/editors/settings/sections/ThemeSection.ts:177` (picker selection), `src/renderer/theme/themes/index.ts:166` (`cycleTheme()`), and `src/renderer/theme/themes/index.ts:172` (startup, before preview can exist). Follow the caller table and before/after example above. A settings reload must not clear the preview; `endPreview()` reads the latest `settings.theme`, not the value captured when preview began. Ensure every preview application and registry change increments/publishes `themeState.revision` after CSS is applied so `configure-monaco.ts`, `board-theme.ts`, `ThemeSection.ts`, and `global-styles.ts` observe the actual definition.

   `applyThemePreservingPreview(id)` applies that id normally when no preview is active and reapplies the overlay when one is active. The registry reload passes its existing validated selected-id-or-`persephone` fallback expression to this function.

6. **Implement explicit apply semantics in `src/renderer/api/themes.ts`.** Resolve `id` through `getThemeById()` and reject unknown ids. Clear preview, call `applyTheme(id)` immediately in this renderer, then call `settings.set("theme", id)` to persist and notify other windows. Do not rely on `settings.set()` to apply locally: US-1637 live verification established that it does not. `apply()` must not dispatch through a delayed watcher to update its own window.

7. **Document the API for script and agent users.** Add `assets/guides/scripting/api/themes.md` with examples for listing/getting/current, deriving, contrast, forking a built-in, previewing/restoring, saving/renaming/deleting, applying, and file export/import. State plainly that `fork()` returns an id-less draft, `preview()` accepts that draft, and preview is renderer-memory state that is local to one window and writes no settings or files. It ends on window reload or app restart; within a running renderer it stays active until `endPreview()`, `app.themes.apply()`, or explicit selection such as Settings picker/theme cycling. `apply()` persists and applies immediately in the caller's window. Mention US-1639 will end a board-owned preview when the board closes/reloads. Add the link and namespace entry to `assets/guides/scripting/api/index.md`, add `app.themes` to the root summary in `assets/guides/scripting/api/app.md`, and add an agent workflow to `assets/guides/agents/scripting.md` for turning a natural-language palette request into a derived/forked draft, checking `contrast()`, previewing, saving, and applying only when requested. Include MCP `call themes.list`, `themes.preview`, and `themes.endPreview` examples, with mutation cautions.

8. **Keep adjacent work out of this task.** US-1639 owns `themes` board permission and `persephone.themes` bridge; US-1640 owns the board UI. Do not add a board bridge alias or change any board permission/version files here.

## Concerns

- **Preview and lookup identity:** Monaco resolves `themeState.id` through `getThemeById()`. The preview definition must therefore be available under reserved id `preview` while remaining absent from registry enumeration and unable to shadow a saved theme.
- **Two independent reload sources:** US-1637's themes-folder reload and the settings-file reload both apply themes today. Both must preserve preview. Avoid converting a reload fallback to persisted state; only explicit `app.themes.apply()` and US-1637's successful delete of the selected file write `settings.theme`.
- **Fork/save ID flow:** `CustomThemeFile.id` is required, while a fork must not reserve an id. Expose `ThemeDraft` with optional id; `fork()` omits it and the existing storage create path allocates the id at save time. An explicit id continues to mean replacement of that existing custom theme only.
- **Preview lifetime:** Preview is volatile renderer memory. `$help` and the shipped guide must say that renderer reload/restart ends it, while an unended script preview stays active until explicit cleanup or selection. US-1639 owns board-close cleanup.
- **Return values:** storage returns a `{ file, theme }` pair and the registry stores shared definitions. Clone plain data on the public facade boundary so callers cannot mutate the registry by editing a returned `colors` or `overrides` object.
- **Runtime verification:** Codex cannot run Persephone. Claude must verify the calls against a running dev renderer over MCP before US-1638 is marked implemented. No unit tests or test harness are to be added.

## Acceptance Criteria

- `app.themes` is available to renderer scripts, TypeScript IntelliSense, `app.call()`, and MCP `call` through the same namespace and signatures.
- The public methods are `list()`, `get(id)`, `current`, `derive(base, isDark?)`, `contrast(themeOrFile)`, `fork(id)`, `save(draft)`, `rename(id, name)`, `delete(id)`, `apply(id)`, `preview(themeDraft)`, and `endPreview()`.
- Every returned value is plain data shaped as `CustomThemeFile`, `ThemeDefinition`, or `ContrastReport`; no storage wrapper, mutable registry array, or internal model instance escapes.
- `derive`, `contrast`, and `fork` call the US-1636 helpers. `fork()` returns an id-less `ThemeDraft`; `save()` without id uses the existing storage create path, which generates the id at save time, while an explicit id replaces that existing custom theme only. No id is reserved or allocated at fork time. Storage calls go through US-1637 APIs; no derivation, validation, override routing, path generation, or custom-file I/O is duplicated.
- `apply(id)` immediately applies in the calling window and persists `settings.theme`; it does not depend on another window's settings watcher.
- `delete(id)` delegates through `deleteCustomTheme()`. Deleting the active theme persists the `persephone` fallback using the existing storage behavior.
- `preview(themeDraft)` accepts an id-less draft, applies in this window only, changes neither settings nor theme files, and publishes `themeState.id === "preview"`. `getThemeById("preview")` resolves the private overlay while active; `current` returns the preview definition with the draft name. Preview stays active across registry/theme-file reloads and settings-file reloads; `endPreview()` applies the latest persisted theme or `persephone`, and explicit apply/selection ends preview. A window reload or restart ends the in-memory preview; a running script's preview stays until ended or explicitly superseded. US-1639 will clean up board-owned preview when the board closes/reloads.
- Preview and apply publish a new theme revision after CSS/native theme application. Monaco re-reads the preview definition, and board/global-style/Settings subscribers receive the changed revision.
- MCP path hints describe all members. `$help` explains local preview and persistence. `save`, `delete`, `apply`, and `preview` have concise `caution` annotations (and `rename` is also annotated as a file mutation).
- Claude's live MCP verification covers `list/get/current`, derive/contrast/fork, create/replace/rename/delete, active-delete fallback, immediate local `apply` plus persisted setting, and preview followed by theme-file and settings-file reloads then `endPreview()`. Verify preview Monaco colors and window-local behavior with a second window. Record the real observations under a Live verification section before implementation is considered complete.
- No US-1639/US-1640 files are changed and no tests or harness are added.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1638-app-themes-api/README.md` | This investigation and implementation-ready plan. |
| `doc/active-work.md` | Link the US-1638 dashboard entry to this document. |
| `doc/epics/EPIC-123.md` | Link the US-1638 task-table entry to this document. |
| `src/renderer/api/themes.ts` | **Implementation:** public plain-data service facade over the theme model, storage, settings, and registry. |
| `src/renderer/api/app-service-registry.ts` | **Implementation:** register the typed `themes` service. |
| `src/renderer/api/types/app.d.ts` | **Implementation:** expose `IThemes` on `IApp`. |
| `src/renderer/api/types/themes.d.ts` | **New:** public structural types and signatures; build copies it to `assets/editor-types/`. |
| `src/renderer/scripting/ai-vision/root.ts` | **Implementation:** add `themes` root member to MCP/app-call discovery hints. |
| `src/renderer/scripting/ai-vision/namespaces/themes.ts` | **New:** member hints, `$help`, signatures, and mutation cautions. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | **Implementation:** register the descriptor for the theme service. |
| `src/renderer/theme/themes/index.ts` | **Implementation:** private preview overlay, preview-aware lookup/application, and preview-preserving registry reload. |
| `src/renderer/api/settings.ts` | **Implementation:** settings reload uses preview-preserving theme application. |
| `src/renderer/api/custom-theme-storage.ts` | Read-only US-1637 storage API: id-less save generates a unique id, an explicit id replaces an existing custom theme, and delete persists the selected-theme fallback; no changes planned. |
| `assets/guides/scripting/api/themes.md` | **New:** complete public API guide and examples. |
| `assets/guides/scripting/api/index.md` | **Implementation:** link `app.themes` in the API tree. |
| `assets/guides/scripting/api/app.md` | **Implementation:** include the namespace in the app object summary. |
| `assets/guides/agents/scripting.md` | **Implementation:** guide agents through theme creation, contrast review, preview, save, and apply. |
| `assets/editor-types/themes.d.ts`, `assets/editor-types/_imports.txt` | **Generated by the Vite editor-types plugin** from `src/renderer/api/types/themes.d.ts`; do not hand-maintain. |
| `src/renderer/scripting/ai-vision/call.ts`, `src/renderer/api/mcp/call-command.ts` | Read-only generic routing: existing resolver reaches the descriptor-backed `themes` service; no special handler change planned. |
| `src/renderer/theme/custom-theme.ts`, `src/renderer/theme/custom-theme-types.ts` | Read-only US-1636 algorithms/types; call existing functions without changes. |
| `src/renderer/theme/theme-state.ts`, `src/renderer/api/setup/configure-monaco.ts`, `src/renderer/editors/board/board-theme.ts`, `src/renderer/editors/settings/sections/ThemeSection.ts`, `src/renderer/theme/global-styles.ts` | Read-only same-id revision consumers verified in US-1637; no changes expected unless live verification finds a preview-specific defect. |
| `src/renderer/api/cycle-app-theme.ts` | Read-only explicit theme-selection path; theme application there already persists after cycling. |
| `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/BoardWebview.ts`, `src/shared/board-bridge-version.ts`, `assets/board-template/board-manifest.json`, `assets/board-template/index.html` | **No changes:** US-1639 owns board permission and bridge. |
| `persephone-boards` Theme Editor board files | **No changes:** US-1640 owns the separate editor board. |
| Unit-test directories / test harness | **No changes:** no harness is used for this feature; Claude verifies live through MCP. |
