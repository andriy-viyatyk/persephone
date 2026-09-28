# US-1541: Built-in capability resolution runs the handler it resolved; one image-edit helper

Epic: [EPIC-115](../../epics/EPIC-115.md)

## Goal

Make capability invocation run the exact platform handler selected by resolution, and ensure a `content.view` candidate only competes for the representation it declares. Centralize image edit handoffs so callers provide image data and a suggested title without knowing Excalidraw's filename extension.

## Background

### Verified capability resolution

`src/renderer/api/capabilities.ts` currently stores platform callbacks in `builtinHandlers` keyed by `capabilityKey(id, representation)` (`id:representation`), while platform registrations carry `handlerKey: definition.id` and no `representation`. `invokeCapabilityOutcome()` resolves a registration, then looks up the callback using the invocation's `id` and payload representation rather than `registration.handlerKey`. For `content.view`, `createPageHandler()` checks the payload representation against the captured representation, but this does not help candidate selection because `orderedCandidates()` filters only by MIME `accepts`.

`seedPlatformCandidates()` is guarded and lazy. It runs from registration, unregister, resolution, legacy intent, list, handlers, and invoke paths. It reads all definitions from `editorRegistry.getAll()` and seeds from declarations. The six built-in `content.view` registrations in `src/renderer/editors/register-editors.ts` declare `grid`, `log`, `markdown`, `svg`, `html`, or `mermaid`; `text.open` is also platform-seeded. `src/renderer/index.ts` imports that registration module before mount; at its end the editor table is fully registered before `customEditorRegistry.ensureInitialized()` begins, and that board-registry warm-up currently reaches the lazy seed. An explicit seed can therefore run immediately after the editor registration loop and before that warm-up.

A direct import from `src/renderer/editors/register-editors.ts` to `src/renderer/api/capabilities.ts` for explicit seeding does not create an import cycle: `capabilities.ts` imports `editorRegistry` and `capability-bus`, neither of which imports `register-editors.ts`. The existing `customEditorRegistry` import in `register-editors.ts` already reaches `capabilities.ts` through the board registry. Keep the seed guard so repeated registration during HMR is idempotent.

Board manifest capability declarations in `src/renderer/editors/board/board-manifest.ts` currently have no `representation` field. There are no checked-in board manifests declaring `content.view`; bundled Excalidraw declares only `image.edit` and `diagram.edit`. To make a high-priority board handler compete only for representations it actually declares, add a representation field to the board declaration and carry it through normalization and registration. A `content.view` board declaration without a representation should be refused with a clear registration diagnostic; existing checked-in manifests are unaffected, while external boards using that id will need to declare each supported representation.

The four checked documentation sources named in this plan all currently list capability declaration fields: `assets/guides/agents/boards.md`, `assets/guides/boards.md`, `assets/board-template/CLAUDE.md`, and `doc/architecture/capability-bus.md`. Update their field lists/examples to document the open-string `representation`, the requirement for `content.view`, one declaration per representation, and the `minBridgeVersion: "1.21.0"` gate.

### Verified image-edit duplication

`src/renderer/api/capability-feedback.ts` already owns `getMissingEditCapabilityMessage()`, which recognizes typed `no-handler` errors for `image.edit` and `diagram.edit`. The image-edit handoff is still repeated:

- `src/renderer/editors/image/ImageEditor.ts` builds image dimensions and an `.excalidraw` title before invoking `image.edit`.
- `src/renderer/editors/svg/SvgEditor.ts` builds an SVG data URL, reads dimensions, appends `.excalidraw`, and invokes `image.edit`.
- `src/renderer/editors/mermaid/MermaidEditor.ts` does the same for rendered Mermaid SVG. Its diagram-edit method is a distinct `diagram.edit` flow and remains separate from image editing.
- `src/renderer/editors/html/HtmlEditor.ts` captures a PNG and calls `pagesModel.addDrawPage()` with an `.excalidraw` suffix.
- `src/renderer/api/pages/PagesLifecycleModel.ts:addDrawPage()` calls `image.edit` and defaults to `untitled.excalidraw`; the scripting API wrapper `PageCollectionWrapper.addDrawPage()` routes through this method.
- `src/renderer/content/builtin-schemes.ts:resolveData()` handles `target === "image.edit"` data URLs by calling `addDrawPage()` and owns a duplicate notification catch.
- Image, SVG, and Mermaid editor views and the HTML capture helper contain separate warning/error notification handling around failures.

The screen-snip button itself opens the capture in an Image viewer (`src/renderer/ui/app/MainPageView.ts:runSnip`); the ensuing edit action reaches `ImageEditor`. The `addDrawPage` scripting path and the `builtin-schemes` path are separate routes and both must be covered.

Preserve each image-edit caller's final page title while moving extension ownership into the helper: `ImageEditor` uses `baseName + ".excalidraw"`; SVG strips `.svg` then appends `.excalidraw`; Mermaid strips any `\.\w+` suffix then appends `.excalidraw`; HTML uses `suggestedImageName() + ".excalidraw"`; `builtin-schemes` uses `(data.title || "drawing") + ".excalidraw"`; and `addDrawPage()` defaults to `untitled.excalidraw`. The shared helper appends `.excalidraw` unless the supplied title already ends with it, case-insensitively. One intentional visible change is accepted: `page.addDrawPage(url, "foo")` will open a page titled `foo.excalidraw` instead of `foo`; document this in the scripting API declaration.

EPIC-105 D5 states the seam's intent: a handoff carries image data, dimensions, and a suggested name, while the handler constructs its own file format. Current `.excalidraw` suffixes at these callers leak the handler's format through the seam.

### Board-visible contract decision

This story changes what boards can see in two additive ways: board manifest capability declarations gain `representation` and invalid `content.view` declarations produce a new Board Info registration diagnostic; and `persephone.capabilities.list()` entries gain optional `representation`. Board authors need a bridge gate for the new manifest contract. Bump `BOARD_BRIDGE_VERSION` from `1.20.0` to `1.21.0` in `src/shared/board-bridge-version.ts`, document the new field and gate in the board-authoring docs, and have boards that use representation-scoped `content.view` declarations set `minBridgeVersion: "1.21.0"`. Capability result shapes and the `persephone.*` member set remain unchanged; the bridge version still bumps because registration/discovery behavior visible to board authors changes.

## Implementation Plan

1. **Make selected registration identity and representation authoritative** in `src/renderer/api/capabilities.ts`, `src/ipc/capability-bus-channels.ts`, and the board-manifest declaration path.
   - Extend `CapabilityDeclaration`/`CapabilityRegistration` in `src/ipc/capability-bus-channels.ts` with optional open-string `representation`; `EditorCapabilityDeclaration` in `src/renderer/editors/base/editorRegistry.ts` already provides the built-in field.
   - Key `builtinHandlers` first by the platform handler key (`handlerKey`, currently the editor id), with an inner capability key if one editor declares more than one capability. Invocation must select through the resolved `registration.handlerKey`.
   - Seed each built-in registration with its declared `representation`.
   - Add optional string `representation` to `BoardCapabilityDeclaration` and `IBoardCapabilityDeclaration`; preserve it in `normalizeCapabilities()` and `BoardEditorFacade`'s manifest copy. For board `content.view` declarations, accept any non-empty trimmed string (including extensions such as `pdf`), and refuse only a missing, blank, or non-string value.
   - Add optional `representation?: string` to renderer `CapabilityInfo` and `CapabilityHandlerFilter` in `src/renderer/api/types/capabilities.d.ts`; copy it in `copyInfo()`. Do not edit `src/renderer/editors/board/board-api.d.ts`: it is unwired and deliberately not maintained; the prose guides are the board reference. `src/board-shim.ts` carries `list()` results through as unknown and has no handler-filter or `handlers()` API, so there is no filter type to add there.
   - Keep the existing `resolveCapability(id, version, filter)` shape. Put `representation?: string` beside `mime?: string` in `CapabilityHandlerFilter`; `orderedCandidates(id, filter)` rejects a candidate that has a representation when it differs from `filter.representation`, and includes all representations when no representation filter is supplied. `copyInfo()` exposes each candidate's representation so `handlers("content.view", { representation: "svg" })` can answer which handlers apply.
   - In `invokeCapabilityOutcome()`, derive representation from the `content.view` payload and merge it into the filter passed to `resolveCapability()`, preserving any `mime` filter. This ensures priority is applied only among handlers eligible for that requested representation. Built-in `ContentRepresentation` typing for the `invoke("content.view", payload)` overload remains closed and unchanged; board declarations and discovery use open strings.
   - Preserve useful errors for missing/invalid representations and ensure board winners still dispatch through `capabilityBus`.

   Before and after (conceptual):

   ```ts
   // Before: resolved registration is ignored when selecting the platform callback.
   builtinHandlers.get(capabilityKey(parsed.bareId, representation));

   // After: run the callback belonging to the resolved registration.
   builtinHandlers.get(registration.handlerKey)?.get(
       capabilityKey(registration.id, registration.representation),
   );
   ```

2. **Seed platform candidates at an explicit startup boundary** in `src/renderer/api/capabilities.ts` and `src/renderer/editors/register-editors.ts`.
   - Export one explicit, idempotent seeding function and call it immediately after the `EDITORS` registration loop, before `customEditorRegistry.ensureInitialized()`; the verified imports have no cycle.
   - Keep the `platformCandidatesSeeded` guard for HMR re-runs. Drop lazy seed calls from registration, unregister, resolution, legacy-intent, list, handlers, and invoke entry points; later board registration/unregistration only updates board candidates.

3. **Add one image edit handoff and one notification helper** in `src/renderer/api/capability-feedback.ts`, using dynamic imports for app/image utilities if needed to avoid a dependency cycle.
   - Add `openImageForEdit({ dataUrl, mimeType?, title })`: calculate dimensions, invoke `app.capabilities.invoke("image.edit", ...)`, and put the `.excalidraw` naming decision at this handler boundary. Normalize an already suffixed title to avoid duplicate extensions.
   - Add `notifyEditCapabilityFailure(error, capability, fallbackMessage)` alongside `getMissingEditCapabilityMessage()` to centralize warning vs error selection and preserve caller-specific failure context. Return whether a failure was reported so callers avoid a second toast or rethrow when their surrounding contract requires it.
   - Preserve the current missing-Excalidraw message text and make no-handler warnings distinguishable from other errors.

   Before and after (conceptual):

   ```ts
   // Before: each caller adds the handler's file extension and calls the bus.
   await app.capabilities.invoke("image.edit", { dataUrl, mimeType, naturalWidth, naturalHeight, title: "name.excalidraw" });

   // After: caller supplies its suggested title; helper owns dimensions, dispatch, and format naming.
   await openImageForEdit({ dataUrl, mimeType, title: "name" });
   ```

   Board declaration/discovery before and after:

   ```json
   // Before: no way to declare which content.view representation this board serves.
   { "id": "content.view", "priority": 70 }

   // After: use one entry for every supported representation, and gate on bridge 1.21.0.
   { "minBridgeVersion": "1.21.0", "capabilities": [
     { "id": "content.view", "representation": "pdf", "priority": 70 }
   ] }
   ```

   ```ts
   // Filter discovery without hiding other candidates when no filter is supplied.
   app.capabilities.handlers("content.view", { representation: "pdf" });
   ```

4. **Route every current image-edit caller through the helper**: `src/renderer/editors/image/ImageEditor.ts`, `src/renderer/editors/svg/SvgEditor.ts`, `src/renderer/editors/mermaid/MermaidEditor.ts`, `src/renderer/editors/html/HtmlEditor.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts:addDrawPage()`, and the `resolveData()` image-edit branch in `src/renderer/content/builtin-schemes.ts`.
   - Preserve image-specific source preparation (canvas export/capture, SVG serialization, MIME type, suggested basename); the Image/SVG/Mermaid model paths call the helper directly, and HTML/scheme callers also call the helper directly rather than routing through another caller's `.excalidraw` logic.
   - Remove caller-side `getImageDimensions()` and `.excalidraw` suffixing where the helper takes ownership.
   - Keep `addDrawPage(dataUrl, title?)` as the public page API and route its implementation through the helper. Pass `untitled` as its unsuffixed default title; the helper yields the same final default `untitled.excalidraw`.
   - Update the `addDrawPage()` title parameter comment in `src/renderer/api/types/pages.d.ts`: titles receive `.excalidraw` when absent, and the default final page title remains `untitled.excalidraw`. Record the accepted `"foo"` to `"foo.excalidraw"` change for scripting callers.
   - Route warning/error reporting in the related image/SVG/Mermaid/HTML UI catch paths through `notifyEditCapabilityFailure(...)`, avoiding duplicate notifications when errors are propagated.

5. **Update board-facing contracts and documentation** in `src/renderer/api/types/capabilities.d.ts`, `src/shared/board-bridge-version.ts`, and the four verified capability field lists: `assets/guides/agents/boards.md`, `assets/guides/boards.md`, `assets/board-template/CLAUDE.md`, and `doc/architecture/capability-bus.md`. Do not edit `src/renderer/editors/board/board-api.d.ts`: it is unwired and deliberately not maintained; the prose guides are the board reference. `BoardWebview.ts` already forwards additive list records, so no change is required there.
   - Expose optional string `representation` on renderer `CapabilityInfo`; expose optional `representation` in `CapabilityHandlerFilter` so `handlers()` can filter by it. Keep built-in `invoke` overload typing unchanged.
   - Update each listed authoring/architecture field list: `content.view` requires a non-empty representation; declare one capability entry per supported representation; boards using the field require `minBridgeVersion: "1.21.0"`.
   - Bump `BOARD_BRIDGE_VERSION` to `1.21.0` and describe the additive discovery/manifest behavior and compatibility gate. No new `persephone.*` member or result-shape change is planned.

## Concerns

- **Representation scope:** built-in `invoke("content.view", payload)` remains typed to the existing `ContentRepresentation` union, while board declarations and `CapabilityInfo.representation` use open strings so boards can add formats such as `pdf`. A representation filter matches a candidate that declares the same representation; candidates with no representation remain eligible, and omitting the filter lists every candidate.
- **Handler map shape:** use a nested map keyed by `handlerKey` then capability identity. Current built-ins put `text.open` on Monaco and `content.view` on the view editors, but one editor could declare both. The nested map avoids changing the public `handlerKey` shape and remains harmless when each editor declares one capability.
- **Helper imports:** keep `openImageForEdit` next to `getMissingEditCapabilityMessage()` as requested, and use dynamic imports of `app` and `getImageDimensions` so the feedback module does not create a static import cycle through app services or editor modules.
- **Title compatibility:** `addDrawPage` callers may already provide `.excalidraw`; normalize in the helper so it never produces a doubled extension. Preserve all listed caller title formulas and accept the visible scripting change that a supplied title `foo` becomes `foo.excalidraw`.
- **Board manifest compatibility:** a board that currently declares `content.view` without a representation must add one declaration per supported representation. No checked-in board currently uses `content.view`; the updated authoring docs will state the field requirement and `minBridgeVersion: "1.21.0"` gate.
- **Notifications:** some editors notify in their view and others rethrow into a wrapper that notifies. The shared failure helper must avoid showing the missing-handler warning twice and retain useful contextual errors for actual failures.
- **Board bridge change:** the additive `CapabilityInfo.representation` and manifest diagnostic are board-visible. Bump the bridge to `1.21.0`; board capability outcomes remain unchanged.

## Implementation Checklist

- [x] Make selected registration identity and representation authoritative.
- [x] Seed platform candidates at the explicit startup boundary.
- [x] Add the shared image-edit handoff and failure notification helpers.
- [x] Route all listed image-edit callers through the shared helper.
- [x] Update renderer-facing types, bridge version, and board prose documentation.

## Acceptance Criteria

- Each `content.view` representation (`svg`, `html`, `markdown`, `mermaid`, `grid`, `log`) opens the matching built-in editor.
- A board declaring `content.view` at priority greater than 50 does not win for representations it does not declare, and wins only for representations it declares.
- Platform invocation executes the handler belonging to the resolved registration's `handlerKey`.
- `image.edit` from the Image viewer, SVG, Mermaid, HTML editor, `addDrawPage`/snip path, and `builtin-schemes` data-image path lands in Excalidraw.
- Each caller preserves its current final title formula: ImageEditor base name; SVG title without `.svg`; Mermaid title without its final `\.\w+`; HTML `suggestedImageName()`; builtin scheme `(data.title || "drawing")`; and addDrawPage default `untitled`. The helper appends one `.excalidraw` suffix unless already present case-insensitively.
- The `addDrawPage` API comment explains that supplied titles gain `.excalidraw` when missing. A script passing `foo` and receiving `foo.excalidraw` is an accepted visible change.
- With the bundled Excalidraw board disabled and no replacement installed, image edit shows: “No image editor is registered. Enable the board in Tools & Editors or install a replacement.”
- `CapabilityInfo` exposes optional string `representation`; renderer `CapabilityHandlerFilter` exposes optional string `representation`; board `persephone.capabilities.list()` info exposes the optional field. The board-facing API has no `handlers()` method or filter type, so no filter type is added to `src/board-shim.ts`.
- `BOARD_BRIDGE_VERSION` is bumped from `1.20.0` to `1.21.0`; board authors using representation-scoped `content.view` declarations gate with `minBridgeVersion: "1.21.0"`. Invocation result shapes and the `persephone.*` member set remain unchanged.
- No unit tests are added or run (project rule for this task).

### Live verification

- Invoke `content.view` for each representation (`svg`, `html`, `markdown`, `mermaid`, `grid`, `log`) and confirm the matching built-in editor opens.
- Use a board declaring `content.view` at priority greater than 50 for only a subset of representations; confirm it wins for declared representations and does not win for undeclared ones.
- Invoke `image.edit` from the Image viewer, SVG, Mermaid, HTML editor, `PagesLifecycleModel.addDrawPage()` (including the snip flow that opens in the Image viewer), and the `builtin-schemes.ts` data-image route; confirm each opens Excalidraw.
- Disable the bundled Excalidraw board without installing a replacement and confirm image edit shows: “No image editor is registered. Enable the board in Tools & Editors or install a replacement.”
- Invoke each changed message path twice where applicable to verify existing-page behavior.

### Live verification results (2026-09-28, dev build, cold start)

- `content.view` for `svg`, `html`, `markdown`, `mermaid`, `grid`, `log`, invoked twice each: opened `svg-view`, `html-view`, `md-view`, `mermaid-view`, `grid-json`, `log-view` every time. An undeclared representation (`pdf`) returns `no-handler`.
- US1534Demo temporarily declared `content.view` at priority 60 with `representation: "svg"`, plus a second `content.view` entry with no representation. The entry with no representation was refused and did not appear in `handlers()`. The board won `svg` twice and lost `markdown` to `md-view` twice. The manifest was reverted afterwards.
- `image.edit` opened Excalidraw twice from each path: Image viewer (`pic.excalidraw`), SVG (`shape.excalidraw`), Mermaid (`flow.excalidraw`), HTML Edit Image (`page.excalidraw`), `addDrawPage` (`fromScript.excalidraw`; `already.excalidraw` was not double-suffixed; the default title is `untitled.excalidraw`) and the `builtin-schemes` data-image route (`schemeimg.excalidraw`).
- With `disabled-bundled-boards: ["excalidraw"]`, the missing-editor warning appeared for the Image, SVG and Mermaid buttons and the scheme route, twice each. `addDrawPage` rejects with `no-handler`. The board was re-enabled afterwards.

### Not verified

- The HTML Edit Image path with Excalidraw disabled. It uses the same `notifyEditCapabilityFailure` helper.
- The screen-snip capture itself. It opens the capture in the Image viewer, and the Image viewer path was verified.
- The Board Info diagnostic text for a refused `content.view` declaration. Only the refusal itself was observed.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/api/capabilities.ts` | Explicit platform seed, handler lookup, representation-aware candidate resolution and board declaration validation. |
| `src/ipc/capability-bus-channels.ts` | Internal registration representation field. |
| `src/renderer/editors/board/board-manifest.ts` | Board capability representation declaration, normalization, and missing/blank/non-string validation. |
| `src/renderer/api/types/board-editor.d.ts` | Script-facing board manifest representation typing. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Preserve representation in copied manifest data. |
| `src/renderer/editors/board/custom-editor-registry.ts` | **No change planned**; it already registers normalized capability declarations and the internal registration keeps the added representation. |
| `src/renderer/editors/register-editors.ts` | Call explicit platform seed after built-in editor registration. |
| `src/renderer/api/types/capabilities.d.ts` | Add optional open-string representation to `CapabilityInfo` and `CapabilityHandlerFilter`; retain closed `ContentRepresentation` invoke overload. |
| `assets/editor-types/capabilities.d.ts` | Ship the updated capability discovery and representation-filter types to script/editor consumers. |
| `assets/editor-types/board-editor.d.ts` | Ship the optional representation field for board manifest capability declarations. |
| `assets/editor-types/pages.d.ts` | Ship the updated `addDrawPage()` title behavior comment. |
| `src/renderer/editors/board/board-api.d.ts` | **No change by user override**; this file is unwired and deliberately not maintained. The prose guides are the board reference and document the additive `representation` discovery field. |
| `src/shared/board-bridge-version.ts` | Bump `BOARD_BRIDGE_VERSION` from `1.20.0` to `1.21.0`. |
| `assets/guides/agents/boards.md` | Document `content.view` representation declarations and the `minBridgeVersion: "1.21.0"` gate. |
| `assets/guides/boards.md` | Document `content.view` representation declarations and the `minBridgeVersion: "1.21.0"` gate. |
| `assets/board-template/CLAUDE.md` | Document `content.view` representation declarations and the `minBridgeVersion: "1.21.0"` gate. |
| `doc/architecture/capability-bus.md` | Document representation-scoped board declarations, discovery filtering, and resolution. |
| `src/renderer/api/capability-feedback.ts` | Shared image edit and failure-notification helpers, using dynamic imports if needed to avoid a dependency cycle. |
| `src/renderer/editors/image/ImageEditor.ts` | Delegate image edit handoff. |
| `src/renderer/editors/image/ImageToolbarView.ts` | Use shared image-edit failure notification. |
| `src/renderer/editors/svg/SvgEditor.ts` | Delegate SVG image edit handoff. |
| `src/renderer/editors/svg/index.ts` | Use shared SVG image-edit failure notification. |
| `src/renderer/editors/mermaid/MermaidEditor.ts` | Delegate Mermaid image edit handoff. |
| `src/renderer/editors/mermaid/index.ts` | Use shared Mermaid image-edit failure notification. |
| `src/renderer/editors/html/HtmlEditor.ts` | Delegate captured image edit handoff. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Route `addDrawPage()` through shared handoff. |
| `src/renderer/content/builtin-schemes.ts` | Route `image.edit` data-image target through shared handoff. |
| `src/renderer/api/types/pages.d.ts` | Document `.excalidraw` suffix behavior for supplied titles and unchanged `untitled.excalidraw` default; note the accepted title change for `"foo"`. |
| `src/renderer/editors/board/BoardWebview.ts` | **No change planned**; its existing list response forwards `CapabilityInfo` records additively. |
| `src/board-shim.ts` | **No change planned**; it forwards list results as unknown and exposes no `handlers()` or filter type. |
| `src/renderer/api/board-capability-transport.ts` | **No change planned**; this story concerns candidate resolution and platform image handoff, not board request lifecycle. |
| `src/renderer/api/capability-bus.ts` | **No change planned**; lifecycle ownership was reworked in US-1540, and it consumes the extended registration type without needing behavior changes. |
