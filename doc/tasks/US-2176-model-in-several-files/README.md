# US-2176: Page model in several files

Epic: [EPIC-209: Guides and scaffolding for web-app tests](../../epics/EPIC-209.md), proposal G5.

## Goal

Allow a temporary site extension's `scriptPath` to be one absolute JavaScript file, an ordered list of files, or a folder whose direct `*.js` files load in name order. Preserve one shared source scope so split files behave as one script, and expose the same option through the existing browser and board call surfaces with useful per-file error locations.

## Background

`TemporarySiteExtensions.attach()` in `src/renderer/editors/browser/TemporarySiteExtensions.ts` currently stores one optional string path. It requires exactly one of `source` and `scriptPath`, checks that the path is absolute, and calls `fs.read()` once before registering or replacing the host rule. Its list projection retains that one path. `BrowserSiteExtensionController.injectSelectedExtension()` in `src/renderer/editors/browser/BrowserSiteExtensionController.ts` reads that file again on each injection and passes one source string to `SiteExtensionInjection.createExpression()`.

The browser script contract is declared by `ITemporarySiteExtensionOptions` and `ITemporarySiteExtensionListItem` in `src/renderer/api/types/browser-editor.d.ts`. `BrowserEditorFacade.attachTestExtension()` forwards the options to `BrowserEditor.siteExtensions.attachTemporary()`; its `BROWSER_EDITOR_MEMBERS` entry, `$help` summary and `BROWSER_EDITOR_HELP` text also describe the path. The browser editor's `call` path reaches this same facade method through the registered editor facade, so its argument type and runtime validation must remain aligned.

The board shim's `persephone.call(path, options)` in `src/board-shim/bridge-actions-api.ts` and `MainPortChannel.call()` in `src/board-shim/main-port-channel.ts` forward arbitrary call arguments through the existing call request. A board can therefore call the same `pages[id].editor.attachTestExtension` method; there is no board-specific temporary-extension wrapper or argument schema to extend. Changing the browser facade's accepted options changes the `window.persephone` call-tree surface, so update `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.62.0` to `1.63.0` and add its history entry in `assets/guides/agents/boards/bridge-versions.md`, following EPIC-209's decision to bump once for the epic.

The current guide is `assets/guides/agents/temporary-site-extensions.md`. The browser facade's `$help` output is authored in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`; update its member summary and the temporary-extension paragraph in `BROWSER_EDITOR_HELP` in this task. Keep those guide changes brief; US-2179 owns the full guide rewrite.

The project filesystem API in `src/renderer/api/fs.ts` already exposes `fs.stat()`, `fs.listDirWithTypes()` and `fs.read()`, with declarations in `src/renderer/api/types/fs.d.ts`. The path utilities in `src/renderer/core/utils/file-path.ts` provide the existing path helpers. Use these rather than introducing filesystem or path implementations. `SiteExtensionInjection.createExpression()` currently embeds one source into a single injected expression; `BrowserSiteExtensionController` already creates and clears a `SiteActionDocument` around injection and reports read/evaluation failures per tab.

## Implementation Plan

1. **Resolve and map sources in one collaborator.** Add `src/renderer/editors/browser/temporary-extension-sources.ts` to own path resolution, ordered-source assembly, source-line offsets, and the pure error-location mapper. It uses existing `fs.stat()`, `fs.listDirWithTypes()` and `fs.read()` plus `fpIsAbsolute`/`fpJoin` from `src/renderer/core/utils/file-path.ts`; `TemporarySiteExtensions.attach()` uses it for validation and `BrowserSiteExtensionController.injectSelectedExtension()` uses it for reload-time reads. `fs.listDirWithTypes()` distinguishes files from child directories; `fs.stat()` distinguishes an empty directory from a missing path. A string file remains one file; a non-empty string array preserves caller order; a directory selects only direct files whose extension equals `.js` case-insensitively, so `.JS` counts too. Directory names use localeCompare-free ordinal ordering: plain code-unit comparison (`a < b`), with no `localeCompare("en", { numeric: true })`. For a single resolved file, return its text unchanged; for multiple files, concatenate in order and precede each file with exactly one marker line, `// --- <file name> ---`. Return each file's starting line in that concatenated source. Keep the supplied string/list/folder form in entry metadata so `testExtensions` reports the attached input, and copy path arrays on attach and list projection.

2. **Update the public option and attach validation.** Change `ITemporarySiteExtensionOptions.scriptPath` in `src/renderer/api/types/browser-editor.d.ts`, `TemporarySiteExtensionOptions.scriptPath` and `TemporarySiteExtensionEntry.scriptPath` in `src/renderer/editors/browser/TemporarySiteExtensions.ts`, and `TemporarySiteExtensionListItem.scriptPath` to `string | string[]`. Keep the existing exactly-one rule in `TemporarySiteExtensions.attach()`: `source` with any defined `scriptPath` is an error, as are neither being provided or an invalid path value. Accept only an absolute non-empty string or a non-empty array of absolute non-empty strings (retain the existing per-path 4096-character bound). Resolve and read every selected file before changing `entries`, so a missing/unreadable listed file cannot replace an existing extension. A folder with no direct `.js` files fails with a clear empty-folder error. A nonexistent path or unreadable file fails with a clear missing/unreadable-path error; a non-directory path must resolve to a readable file. Update `BrowserSiteExtensionController.injectSelectedExtension()`'s current fallback display name, which presently assumes `scriptPath` is a string, to use the supplied string/folder path or a concise first-file-plus-count label for an explicit list.

   Before:

   ```typescript
   scriptPath?: string;
   // attach validates one file with fs.read(scriptPath)
   ```

   After:

   ```typescript
   scriptPath?: string | string[];
   // attach and injection both resolve the full ordered source set
   ```

3. **Inject one source in one scope.** In `src/renderer/editors/browser/BrowserSiteExtensionController.ts`, resolve the current source and pass the single concatenated string into the existing `SiteExtensionInjection.createExpression()` source slot. The controller currently reads the injection result at `BrowserSiteExtensionController.ts:584`, `result = await evaluateInTarget(this.model.target, expression, tabId);`; its catch begins at line 585. Keep the existing single expression, one IIFE scope, one try/catch, and all-or-nothing result behavior so top-level helpers declared in an earlier file remain callable by later files. In `src/renderer/editors/browser/SiteExtensionInjection.ts`, preserve `runtime`, `host`, and `params` in that same scope and include the concatenated text there. Have expression construction provide the source slot's starting line along with the expression, then pass that offset to the mapper. For a multi-file source, the resolver's per-file start lines map source locations; for a single-file path or inline `source`, leave the exact input text unchanged and use no marker.

   Runtime exceptions are caught inside the expression today and returned as `extension-error:` plus a message. Preserve the caught stack in that result so the controller can call the pure mapper in `temporary-extension-sources.ts` and prefix the per-tab error with `<file>:<line>`. The mapper uses the first `<anonymous>`/eval stack location, adjusts for the source slot's starting line in the expression, then maps the concatenated-source line to the file start offset. For syntax errors that reject the entire evaluation, retain CDP `exceptionDetails.lineNumber` through the existing evaluation error path, normalize its zero-based line number, and pass it to the same mapper. Today the controller does not read `exceptionDetails`: line 584 reads the fulfilled evaluation result, while `src/renderer/automation/queries.ts:51` converts syntax-error details to a message with `cdpExceptionMessage()`. Extend that local error path to preserve the detail needed for mapping, without adding protocol code. Do not add a per-file injection loop, separate scopes, or a new partial-failure teardown path.

4. **Keep file resolution consistent across reloads.** Attach validates the current file set but does not freeze file contents. Each injection resolves the path again and reads every file again. Editing a listed file or any selected folder file takes effect after reloading the matching tab. For a folder path, additions and removals of direct `.js`/ `.JS` files are picked up on the next injection, sorted by plain code-unit comparison; an empty folder then reports the same clear resolution error. For an explicit list, order and membership stay as supplied, while each file's contents are reread. Do not add a file watcher or automatically reinject into a live document.

5. **Propagate the option through the browser and board call surfaces.** Update `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` member metadata and `BROWSER_EDITOR_HELP` to document a file, ordered list, or folder. Keep `attachTestExtension()` itself as a forwarder to `model.siteExtensions.attachTemporary()`. Browser facade call members and board `persephone.call()` already route to this method; they should pass the list unchanged through existing call arguments. Do not add a board-specific extension API, new RPC/protocol types, or a wrapper to route around an import zone. Because this changes a `window.persephone` call-tree argument, update `src/shared/board-bridge-version.ts` to `1.63.0` and append a matching line to `assets/guides/agents/boards/bridge-versions.md`.

6. **Update the existing guide surfaces briefly.** In `assets/guides/agents/temporary-site-extensions.md`, update the attach example/instructions to describe file, ordered-list, and folder forms; state the empty-folder/missing-file/mixed-input errors and that changes are read on the next tab reload. Recommend `00-` and `10-` filename prefixes for readable ordering. Update `BrowserEditorFacade.ts` `$help` text consistently. Leave the broader test-model tutorial and guide restructuring to US-2179.

7. **Preserve architectural guardrails.** `temporary-extension-sources.ts` owns file selection, concatenation and offset mapping; `TemporarySiteExtensions.ts` owns registration/replacement; and `BrowserSiteExtensionController.ts` owns the existing injection lifecycle and calls the resolver/mapper. Reuse the filesystem and path helpers listed above. Keep protocol code unchanged and do not grow the god files named in `doc/reviews/refactoring-roadmap.md` section 2.3. Respect existing import zones with direct imports and no `await import()` or wrapper added to evade a zone. If a strict-folder null-check needs repair, change only the declared type/null safety and do not alter its runtime condition.

## Concerns

- Multi-file order is deterministic: explicit arrays preserve given order; directory files are direct children whose extension matches `.js` case-insensitively, sorted by plain code-unit comparison (`a < b`) with no locale/numeric collation. Nested directories and non-JavaScript files are excluded. Recommend `00-` and `10-` filename prefixes in the guide.
- Multi-file text runs in the existing single IIFE scope. A top-level helper such as `function visible(el)` or `const byTestId = …` in the first file is directly callable from the second.
- Attachment validates before replacing an existing host rule, but a file may disappear between attach and a later reload. That reload should report the per-tab error using the existing `failedTabs` outcome and must not silently inject only part of the file set.
- The board change is an argument-shape extension to the existing `persephone.call()` route. The bridge version bump is required by the project rule even though no new transport or RPC protocol is introduced.
- The path contract should stay absolute, including every explicit list member. Folder selection should not recurse, matching the requested folder `*.js` behavior and keeping the selected set predictable.
- A runner `ctx.usePage({ model })` convenience option is not part of G5. The existing page handle and `ctx.call` can already invoke `attachTestExtension`; US-2179 will document this usage.

## Acceptance Criteria

- `scriptPath` accepts one existing absolute file, a non-empty ordered list of existing absolute files, or a directory containing at least one direct `.js` file; `.JS` is included.
- Directory files inject sorted by plain code-unit comparison (`a < b`); explicit file lists inject in caller order.
- Missing files, unreadable files, empty file lists, empty folders, invalid paths, and mixed `source` plus `scriptPath` inputs fail before a new rule replaces an existing rule, with actionable errors.
- Each file is reread on every injection. Editing files and changing a folder's `.js` membership takes effect after the matching tab reloads; no live watcher is installed.
- Runtime and syntax errors map back to the originating file and line in the per-tab error, using the resolver's file-start line offsets.
- A helper declared in the first file is callable from the second file in the shared scope.
- Browser facade `$help`, `assets/guides/agents/temporary-site-extensions.md`, `BOARD_BRIDGE_VERSION`, and `assets/guides/agents/boards/bridge-versions.md` describe the implemented contract.
- No new protocol code, growth in a god file named in `doc/reviews/refactoring-roadmap.md` section 2.3, `await import()`/import-zone wrapper, customer project name, or non-mock project data is introduced.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/browser/TemporarySiteExtensions.ts` | Broaden stored option types and use the source resolver to validate complete file sets before registration/replacement. |
| `src/renderer/editors/browser/temporary-extension-sources.ts` | Resolve files, concatenate multi-file source with markers, return per-file line offsets, and map an error location to file/line. |
| `src/renderer/editors/browser/BrowserSiteExtensionController.ts` | Resolve/reread the source and call the mapper; preserve the existing one-expression injection path. |
| `src/renderer/editors/browser/SiteExtensionInjection.ts` | Preserve one IIFE scope and try/catch; accept concatenated source, provide its source-slot line offset, and return the caught stack for mapping. |
| `src/renderer/api/types/browser-editor.d.ts` | Broaden `scriptPath` types exposed by temporary-extension options/list items. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Keep forwarding behavior and update member metadata / `$help` text. |
| `src/renderer/automation/queries.ts` | Preserve CDP `exceptionDetails.lineNumber` on evaluation errors so syntax errors can use the same mapper. |
| `src/shared/board-bridge-version.ts` | Bump `BOARD_BRIDGE_VERSION` from `1.62.0` to `1.63.0`. |
| `assets/guides/agents/boards/bridge-versions.md` | Add the bridge history entry for array/folder `scriptPath` arguments. |
| `assets/guides/agents/temporary-site-extensions.md` | Briefly update supported path forms, ordering prefixes and reload/error behavior. |
| `integration-test/tests/browser/site-extensions/temporary-site-extensions.test.mjs` | Cover explicit-list order, folder order and case-insensitive extension selection, a helper declared in the first file and called in the second, runtime/syntax filename-and-line errors, empty folders, missing files, and replacement validation. |
| `doc/tasks/US-2176-model-in-several-files/README.md` | This implementation plan. |

Files verified and requiring no changes: `src/board-shim/bridge-actions-api.ts`, `src/board-shim/main-port-channel.ts`, `src/renderer/editors/browser/BrowserEditor.ts`, `src/renderer/api/fs.ts`, `src/renderer/api/types/fs.d.ts`, `src/renderer/core/utils/file-path.ts`, `src/shared/temporary-site-extension.ts`, `src/test-host/client.ts`, and `assets/editor-types/browser-editor.d.ts`. The board call route is generic and already forwards method arguments; the filesystem/path helpers already provide the required operations; `assets/editor-types/` is generated from `src/renderer/api/types/` by the Vite plugin and should not be edited by hand; the browser model's attachment and controller injection remain the existing owner boundaries.
