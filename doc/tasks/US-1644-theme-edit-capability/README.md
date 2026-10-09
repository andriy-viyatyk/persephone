# US-1644: `theme.edit` capability — Edit and + on Settings theme tiles

## Goal

Add Edit buttons to every Settings theme tile and one trailing creation tile to the always-rendered Custom group. Both actions go through the platform capability system: select and persist a theme before Edit, and invoke a trusted installed board claiming `theme.edit@1`; if no handler exists, open Tools & Editors on Search boards and explain how to install Theme Editor.

## Background

### Verified findings

- **Capability ids and validation:** `CapabilityId` is `string` and there is no registry/allowlist of known ids. `registerCapability()` validates non-empty/no-whitespace/no-`@` ids, integer versions and known declaration field shapes. `invokeCapabilityOutcome()` resolves arbitrary ids/versions. Today payload validation is deliberately special-cased for `certificate.view` in `certificate-view.ts` and `content.view`; manifest `payloadSchema` is copied as descriptive metadata, not enforced. Add a first-class `ThemeEditPayload` and explicit platform-owned validator for the new public contract. `app.capabilities.invoke(id, payload, {version})` is the renderer API; a typed overload belongs in both source and public editor types (`src/renderer/api/types/capabilities.d.ts`, build-copied to `assets/editor-types/`).
- **Registration and trust:** `normalizeCapabilities()` in `src/renderer/editors/board/board-manifest.ts` passes declarations through to the capability registry. Board capability registration is rebuilt from trusted board declarations; `capabilityBus.invoke()` checks `isBoardPermitted()` before dispatch and again reacts to revoked trust. The manifest's `permissions.capabilities` disclosure is not a separate permission gate, and `appScripting` does not gate platform-to-board dispatch. Theme Editor’s `themes: true` permission independently gates its `persephone.themes.*` bridge and is already in its manifest; no new permission is needed.
- **Dispatch / result / fallback:** `invokeCapabilityOutcome()` throws `CapabilityError("no-handler", ...)` if no candidate resolves (also for headless candidates). Callers can distinguish that from `untrusted`, `timeout`, `rejected`, `busy`, etc. `capability-feedback.ts` is the existing pattern for specializing only `no-handler` into a warning toast. `priority` sorts handlers descending; platform wins equal-priority ties, then registration order breaks ties. `headless: true` excludes a candidate from page invocation. `alwaysOpensNewPage: true` forces each invocation onto a new board page; absent/false reuses the first open page for that board root, focuses it, and serializes requests. Use no `alwaysOpensNewPage` for Theme Editor. `src/renderer/api/capability-feedback.ts` provides the closest edit-capability precedent: `openImageForEdit()` invokes `image.edit`, while `getMissingEditCapabilityMessage()` and `notifyEditCapabilityFailure()` distinguish a missing handler from other failures.
- **Board receive path:** On a fresh handler page, `boardCapabilityTransport` stores the initial intent in `takeInitialIntent(pageId)` and `BoardWebview.transferPort()` includes it in `BoardPortInitMsg`. On a reused page, `BoardWebview` posts `capabilities:intent`; `src/board-shim.ts` exposes `persephone.intent.get()` and `.onRequest(callback)` for both paths, with `.resolve()`/`.reject()` settling the request. Existing `assets/guides/agents/boards.md` documents the contract. Per-page requests are FIFO. Transport does not decide what to do with a dirty board draft; board code must safely defer/resolve/reject a repeated invocation.
- **No second editor page:** A handler without `alwaysOpensNewPage` reuses/focuses the existing board page in the current renderer window, so the Theme Editor can handle fresh and already-open invocations in one intent callback. `INTENT_DEADLINE_MS` is 10 seconds (`src/ipc/capability-bus-channels.ts:3`). The deadline starts when `capabilityBus.invoke()` is called (`src/renderer/api/capability-bus.ts:271`), before opening a page/cold board boot; timeout settles the caller and delivers cancellation to the board (`:319`). Therefore Settings must set `deadlineMs: 30_000` for cold startup tolerance, and the board must resolve accepted intents before source loading or any user dialog.
- **Theme Editor today:** `C:/projects/persephone-boards/boards/theme-editor/board-manifest.json` is version `1.0.0`, requires bridge `1.35.0`, grants only `themes: true`, and currently claims no capability. It has not been published: `boards-manifest.json` has no entry, the board-path git history is empty, and its files are staged only. `app.js` `initialize()` restores a `pageState` draft if present, otherwise calls `loadSource(state.current.id)`; `loadSourceCore(id)` loads custom files through `themes.file(id)` or exact built-in forks through `themes.fork(id)`. `applyTheme()` in Persephone clears `activePreview`; then `scheduleExternalRefresh()` marks a mismatching live draft preview superseded and clears `state.hasPreview`, but a dirty draft prevents source reload. `newDraft()` currently builds a generic “New Theme” from current colors rather than forking all active-theme overrides. It already has `page.setModified`, `onSaveRequest`, `onDiscardRequest`, and `pageState` draft persistence per US-1641/BT-036. There is no `persephone.intent.onRequest()` handler in the current Theme Editor. Save on an id-less draft calls `themes.save()` and creates a custom theme; Save As explicitly removes an id.
- **Existing edit-capability precedent:** the Excalidraw board is bundled under `assets/boards/`, outside `persephone-boards`; `assets/boards/excalidraw/board-manifest.json:31` claims `image.edit@1` and `diagram.edit@1`, both priority 50 with `alwaysOpensNewPage: true`. `cert-viewer` in `persephone-boards` is the manifest example for an ordinary catalog board claiming `certificate.view`.
- **Settings layout:** `ThemeSectionView.renderThemes()` always appends Dark, Light and Custom headings/grids, even if a group has no items. So the Custom row exists when empty and a single `+` tile can always appear last there. Theme tiles are 160×100 panel elements; custom tiles currently add a hover/focus × delete button in `settings.css`. Tile application is `applyTheme(themeId)` followed by `settings.set("theme", themeId)`.
- **UIKit and navigation:** `IconButtonView` supports `title`, `onClick`, `hideUntilParentHover`, and `IconRef`. `hideUntilParentHover` only reveals correctly when the button is inside a Panel configured with `revealChildrenOnHover`; current theme action buttons are siblings of the inner Panel under a plain `div`, so the current tile structure does not meet that requirement. Extend the existing remove-button hover/focus CSS selector to cover Edit. The icon registry has `plus` and `rename`, but no pencil/edit glyph; `rename` is not semantically equivalent. `app.pages.showToolsHubPage({ tab: "search" })` deduplicates the Tools & Editors hub page and selects Search boards on its `ToolsHubEditor`. Internal UI toasts use `ui.notify(message, "warning"|"error")`.
- **Bridge version:** Capability declaration/invocation and `persephone.intent` already exist in the current app bridge. The new payload remains within existing intent transport; no board shim/bridge wire change is required, so keep `BOARD_BRIDGE_VERSION` at the unreleased EPIC-123 version `1.35.0`.

### Before → after

```ts
// Current API: generic invocation only, no named theme.edit payload overload.
await app.capabilities.invoke("certificate.view", payload);

// Planned Settings actions use the typed v1 contract.
await app.capabilities.invoke("theme.edit", { mode: "edit", themeId }, { version: 1, deadlineMs: 30_000 });
await app.capabilities.invoke("theme.edit", { mode: "new" }, { version: 1, deadlineMs: 30_000 });
```

```ts
// Before: Settings tile selection only applies and persists its theme.
applyTheme(themeId);
settings.set("theme", themeId);

// After: Edit preserves that behavior, then hands off through the platform capability.
applyTheme(themeId);
settings.set("theme", themeId);
await app.capabilities.invoke("theme.edit", { mode: "edit", themeId }, { version: 1, deadlineMs: 30_000 });
```

```jsonc
// Before: Theme Editor has a themes-only permission and no capability claim.
{ "permissions": { "themes": true, "appScripting": false } }

// After: same permission boundary; v1 handler is reusable in its existing page.
{
  "permissions": { "themes": true, "appScripting": false },
  "capabilities": [{ "id": "theme.edit", "version": 1, "priority": 50, "title": "Theme Editor" }]
}
```

## Implementation Plan

### Investigation checklist

- [x] Capability registry, dispatch, trust checks, no-handler behavior, board intent receive path, 1.35.0 compatibility.
- [x] Theme tile groups/dimensions/application, Tools & Editors tab opening, and icon availability.
- [x] Finish board initialization/publishing metadata and enumerate docs / excluded files.

### Persephone (`C:/projects/persephone`)

- [x] 1. **Define and validate the capability contract.** In `src/renderer/api/types/capabilities.d.ts`, add `ThemeEditPayload` as `{ mode: "edit"; themeId: string } | { mode: "new" }` and overload `ICapabilities.invoke("theme.edit", payload, opts?)`. Mirror the type/import/overload in `src/renderer/api/capabilities.ts`. Add `src/renderer/api/theme-edit.ts` with `validateThemeEditPayload()` following the strict shape-validation pattern of `validateCertificateViewPayload()`; require an object, mode exactly edit/new, non-empty themeId for edit, and no themeId for new. Call it before handler resolution in `invokeCapabilityOutcome()`. Use `version: 1` in the manifest and invocation. `vite.renderer.config.ts` copies source API declarations into `assets/editor-types/`, so the matching public declaration should appear there through the repository's normal type-copy step.
- [x] 2. **Add the Edit and New actions.** In `src/renderer/editors/settings/sections/ThemeSection.ts`, import the renderer `app` facade, extend `ThemeOption` with an Edit `IconButtonView`, create/mount/dispose it for built-in and custom themes, and stop propagation. Edit is a small `size: "sm"` icon button styled exactly like the × delete button and shown the same way (on tile hover/focus). It sits in the tile's top-right corner group: on a custom tile Edit comes first and × last (`[Edit][×]`); on a built-in tile Edit is alone in the top-right corner. Put both buttons in one absolutely positioned top-right `data-part="actions"` row so their spacing stays consistent. Factor an async edit action that calls the same `applyTheme(themeId)` + `settings.set("theme", themeId)` path, then invokes `app.capabilities.invoke("theme.edit", { mode: "edit", themeId }, { version: 1, deadlineMs: 30_000 })`. Add a creation tile after all `customThemes` in the Custom grid, irrespective of group length, invoking `{ mode: "new" }` with the same `{ version: 1, deadlineMs: 30_000 }` options and without changing the active theme.
- [x] 3. **Fallback only when absent.** Extend `EditCapabilityId` and `missingEditCapabilityMessages` in `src/renderer/api/capability-feedback.ts` with the exact Theme Editor-specific message `The Theme Editor board is not installed. Search for and install the Theme Editor board in Tools & Editors.` Settings calls `getMissingEditCapabilityMessage(error, "theme.edit")`; only when it returns that message for `CapabilityError.code === "no-handler"` should it open `app.pages.showToolsHubPage({ tab: "search" })` and notify with the message. A `timeout` outcome gets the warning `Theme editor did not respond`; it must not open Search boards or claim the board is not installed. Report other failures according to their actual error.
- [x] 4. **Match the tile style and accessibility.** In `src/renderer/editors/settings/settings.css`, replace the existing absolutely positioned `[data-part="remove"]` rule with a `[data-part="actions"]` row (absolute, top/right 2px, `display: flex`, small gap) that is transparent until the tile is hovered or one of its buttons has `:focus-visible`; do not set `hideUntilParentHover` unless the tile is restructured under a Panel with `revealChildrenOnHover`. The `+` tile should use the same 160×100 geometry, border, radius, token colors and focus-visible treatment. `plus` exists in `src/renderer/theme/icon-registry.ts`; add the pencil icon registered as `"edit"` (see Concerns). Give buttons/tile accessible names and preserve keyboard activation.
- [x] 5. **Update app documentation/types.** Document the platform-provided id/version/payload validation, registration and trust semantics, invocation, missing-handler fallback, and board-side `persephone.intent` receive/reuse behavior in `doc/architecture/capability-bus.md` and `assets/guides/boards.md`; update `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, and `assets/guides/screens/settings.md` with Settings tile and installation behavior. Add the public type to `src/renderer/api/types/capabilities.d.ts`; the normal Vite declaration-copy step updates `assets/editor-types/capabilities.d.ts`.

### Boards (`C:/projects/persephone-boards`)

6. **Claim the capability without changing the board version.** Add a `capabilities` entry to `boards/theme-editor/board-manifest.json`: id `theme.edit`, version `1`, priority `50`, title `Theme Editor`; do not set `alwaysOpensNewPage` (default reuse/focus behavior). The board is staged and has never been published, so leave its manifest `version: "1.0.0"` and keep `minBridgeVersion: "1.35.0"`. Add the capability change to the existing `## 1.0.0` section in `boards/theme-editor/WHATS-NEW.md`. The publishing script machine-writes `boards-manifest.json` and `boards/theme-editor/versions-manifest.json`; first publication creates the catalog/version record at 1.0.0, so do not hand-edit generated files or bump the board version.
7. **Accept fresh and reused requests in `boards/theme-editor/app.js`.** Register `persephone.intent.onRequest` early enough to receive initial and later intents. Validate id/version/payload; reject malformed payloads. Once valid, resolve the intent immediately with an accepted result before loading a source or presenting any UI, so the short-lived capability request does not include board source loading or user interaction. After acceptance, handle both modes through one source-loading path; if loading fails, show a board error because the capability request is already settled. `edit` loads the requested id directly (custom stored file; built-in fork), independent of the active theme. For `new`, load the active theme's exact source representation (`themes.file(active.id)` if custom; `themes.fork(active.id)` if built-in), remove any id, set `sourceId = null` and `sourceKind = "new"`, and title it `New <active name>`. Mark the id-less draft dirty (the board already uses `restoredDraft` in `draftIsDirty()`) so Save creates a custom theme through existing `themes.save()`.
8. **Protect dirty work and resync preview after acceptance.** For a reused board: a clean draft switches to the requested edit/new source; a dirty or restored draft is preserved while an in-board `<dialog>` with Save / Discard / Cancel is shown after the intent has already been accepted. Add its markup to `boards/theme-editor/index.html` and styles to `boards/theme-editor/styles.css` (the board rules prohibit native `confirm`). Clicking Edit in Settings calls `applyTheme()`, which clears the app's active preview before the accepted intent reaches the board. `scheduleExternalRefresh()` sees the external theme change; when a dirty draft's prior preview was active it marks that preview superseded and clears `state.hasPreview`, while retaining the draft. On Cancel, reapply the unchanged draft preview with the existing `queueDraftRefresh({ preview: true })` path. On Discard, load the requested source; on Save, persist the current draft and then load the requested source. Thus the editor's internal state and the app's effective theme agree after every dialog choice.
9. **Update board docs/publishing.** Update `boards/theme-editor/CLAUDE.md` to describe the capability entry, Edit/New payloads, immediate intent acceptance, new-draft semantics, dirty repeated invocations and preview resync. Update relevant Theme Editor documentation under `C:/projects/persephone-boards/doc/` and add a release note under the existing `1.0.0` heading in `boards/theme-editor/WHATS-NEW.md`. On first publication, `scripts/publish-board.mjs` generates the `boards-manifest.json` and `boards/theme-editor/versions-manifest.json` entries at version 1.0.0; no version bump or manual catalog edit is needed.

### Files that need no changes

- `src/renderer/editors/board/board-api.d.ts` — explicitly out of scope; the app’s board script shim/types are not this declaration surface.
- `src/ipc/board-bridge-channels.ts`, `src/board-shim.ts`, `src/renderer/editors/board/BoardWebview.ts` — intent transport and receive APIs already cover this payload; no wire-format change is proposed.
- `src/renderer/editors/board/board-manifest.ts` — `BoardCapabilityDeclaration` and `normalizeCapabilities()` already accept arbitrary capability ids, versions and metadata.
- `src/shared/board-bridge-version.ts` — no new bridge API; continue using 1.35.0.
- `src/renderer/api/board-capability-transport.ts`, `src/renderer/api/capability-bus.ts` — generic trust-gated resolution, serialization, deadlines, page reuse and no-handler outcomes already fit this use case.
- `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/api/types/pages.d.ts`, `vite.renderer.config.ts` — Search-tab navigation and declaration copying already exist.
- Unit tests/test harnesses — prohibited by task constraints.

## Concerns / Open questions

User decisions (2026-10-09): "New <active name>" is the new-theme baseline; Edit switches the active theme and an open Theme Editor resets to that theme (via the dirty-draft prompt when it holds unsaved work); the pencil icon matches the × icon and precedes it on custom tiles.


- **Intent lifetime versus editor interaction.** `INTENT_DEADLINE_MS` is 10 seconds and begins at invocation, covering page creation and cold board startup; a Save/Discard/Cancel dialog cannot be part of the pending request. Recommendation: pass `deadlineMs: 30_000` from Settings, validate and accept the intent immediately in the board, then run loading and dirty-draft UI independently. Search boards only for `no-handler`; report `timeout` as the warning “Theme editor did not respond.”
- **Preview cleared before the request arrives.** `applyTheme()` in Settings clears `activePreview`. On the ensuing theme-change notification, `scheduleExternalRefresh()` marks a draft preview superseded and clears `state.hasPreview`; because the draft is dirty it does not replace that draft. Recommendation: keep the dirty draft, restore its preview if the user cancels, and load the requested source after Save or Discard.
- **New draft baseline/name.** Recommendation: fork the active theme into an id-less draft with a conspicuous `New <active name>` title, set `sourceKind = "new"`, and mark it dirty through the existing `restoredDraft` dirty-state flag; do not save until the user chooses Save, then create a new custom id. This uses verified existing `themes.fork()` / `themes.file()` and `themes.save()` behavior.
- **Edit icon.** `plus` is present but no pencil/edit icon is currently registered. Decided: add a pencil icon to `src/renderer/theme/icons.ts` and register it as `"edit"` in `icon-registry.ts`, drawn at the same size and stroke weight as the `close` icon.
- **First board publication.** Theme Editor is not in `boards-manifest.json` and has no published history. Recommendation: retain `version: "1.0.0"`, add the capability note under the existing 1.0.0 `WHATS-NEW.md` heading, and let the first publish generate the catalog/version records. No Persephone bridge bump is needed.

## Acceptance Criteria

- Every built-in/custom theme tile provides Edit; it applies and persists the selected theme before invoking typed `theme.edit@1` with that exact id.
- Custom group is rendered even empty and ends with one same-size `+` tile opening `{ mode: "new" }`.
- A trusted installed capability claimant is resolved through the generic registry; its existing page is focused/reused; handler receives invocations through the established board intent API.
- Missing handler opens Tools & Editors with Search boards selected and displays the requested install guidance. Other capability failures are not misreported as a missing board.
- Theme Editor validates and accepts each request before loading a source or opening UI; Settings uses a 30-second deadline and reports timeout as “Theme editor did not respond.”
- Theme Editor loads requested ids, supports a new draft forked from the active theme, and never silently replaces dirty/restored work on reused invocation. Cancel restores the draft preview; Save/Discard loads the requested theme.
- `BOARD_BRIDGE_VERSION` remains `1.35.0`; Theme Editor stays at its first unpublished version `1.0.0`; required docs are updated across both repositories.

## Files Changed Summary

| Repository | File | Planned change |
|---|---|---|
| `persephone` | `doc/tasks/US-1644-theme-edit-capability/README.md` | This task plan |
| `persephone` | `doc/active-work.md`, `doc/epics/EPIC-123.md` | Dashboard and epic tracking |
| `persephone` | `src/renderer/api/capabilities.ts`, `src/renderer/api/types/capabilities.d.ts`, generated `assets/editor-types/capabilities.d.ts`, `src/renderer/api/theme-edit.ts`, `src/renderer/api/capability-feedback.ts` | Typed v1 contract, validation and missing-handler fallback |
| `persephone` | `src/renderer/editors/settings/sections/ThemeSection.ts`, `src/renderer/editors/settings/settings.css` | Edit and creation tiles, sizing/states |
| `persephone` | `src/renderer/theme/icons.ts`, `src/renderer/theme/icon-registry.ts` | Pencil icon (plus is already registered) |
| `persephone` | `doc/architecture/capability-bus.md`, `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, `assets/guides/screens/settings.md` | Capability and user docs |
| `persephone-boards` | `boards/theme-editor/board-manifest.json`, `app.js`, `index.html`, `styles.css`, `CLAUDE.md`, `WHATS-NEW.md`, catalog/version records, `doc/` | Claim/handle intents and release metadata/docs |

