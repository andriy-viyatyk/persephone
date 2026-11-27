# US-2243: Tree provider factory

## Goal

Provide one registry that maps a tree type to its provider so data-driven types resolve in one place. Support built-in providers now and enable board trees to use the same factory in [US-2245](../../epics/EPIC-217.md) of EPIC-217, without changing existing behavior.

## Background

The provider implementations found so far are `FileTreeProvider`, `ArchiveTreeProvider`, `MnemeTreeProvider`, and editor-owned `LinkTreeProvider`. `tree-category` is registered as a virtual scheme in `src/renderer/content/builtin-schemes.ts`.

`CategoryEditorModel.providerHost` matches an already-attached panel provider by exact `type` and `sourceUrl`; it does not create one. `initFromLink` only stores the encoded link and title. The link helper's fallback-creation comment does not describe that model's current behavior. `LinkTreeProvider` needs the live `ILinkSource`; content cannot import it from `editors/` under the error-level content import zone. `git-tree` has no `ITreeProvider` match in its editor or component directories.

## Implementation Plan

- [x] Add `src/renderer/content/tree-providers/tree-provider-factory.ts` as the single owner of type-to-constructor lookup. Provide synchronous `registerTreeProvider(typeOrMatcher: string | ((type: string) => boolean), creator)` and `createTreeProvider(descriptor)`. Store exact-type creators separately from an ordered list of matcher creators: check exact matches first, then matchers in registration order, passing the complete descriptor to the selected creator. Reject duplicate exact types and throw a clear error for an unknown type; validate required constructor inputs at the creator boundary. Register file, archive and mneme by exact type once in this module. US-2245 will register one matcher for all namespaced board tree types and consult the existing provider ownership registry as board availability changes; do not register that matcher or add board policy in this task. `src/renderer/content/registry.ts` already owns `boardProviderTypeRefusal`, which requires `/` in registered board provider types; `normalizeContentProviders` in `src/shared/board/board-manifest-schema.ts` itself only trims and accepts non-empty types. Reuse the existing board ownership and refusal rules in US-2245 rather than duplicating them here.
- [x] Define the descriptor in the factory: `{ type: string; rootPath: string; url?: string; config?: unknown }`. `url` is source identity, `rootPath` is provider root, and `config` is opaque. Register file with `new FileTreeProvider(descriptor.rootPath)`, archive with `new ArchiveTreeProvider(descriptor.url)` (require `url`), mneme with `new MnemeTreeProvider(descriptor.rootPath)`; do not infer the archive source from its empty root or pass `mneme://name` as the Mneme root name. Preserve exact input strings; do not normalize. `ITreeProviderLink` is link metadata, not a complete constructor descriptor: `url` and `category` are not interchangeable with root path. Reuse `encodeCategoryLink`/`decodeCategoryLink` for existing link encoding and `TreeProviderHost` for lifecycle; do not invent a second link codec. Provide typed built-in overloads returning the concrete provider types used by current hosts and a generic registry return of `ITreeProvider`.
- [x] In `src/renderer/editors/explorer/ExplorerEditorModel.ts`, replace `new FileTreeProvider(rootPath)` with `createTreeProvider({ type: "file", rootPath })`; retain the empty-path null case, source comparison, disposal, typed host, state subscription, and existing persistence. In `src/renderer/editors/archive/ArchiveEditor.ts`, replace both constructor calls in `initFromArchive` and `restore` with `{ type: "archive", url: archiveUrl, rootPath: "" }`, preserving conditions, title, host and restore ordering. Replace the two existing `await import()` calls with a static factory import: `src/renderer/scripting/api-wrapper/IoNamespace.ts` already statically imports `ArchiveTreeProvider`, so its static factory import adds no new eager archive code. Compare production renderer build output before and after, including `index.html` entry imports and the chunk containing `ArchiveTreeProvider` in `.vite/renderer/main_window/`; confirm that no new archive chunk is pulled into the main entry, accounting for changed chunk hashes. In `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts`, replace construction after root matching with `{ type: "mneme", rootPath: match.name }`, preserving connection, error and disposal behavior.
- [x] Use these before and after replacements for the provider hosts:

  ```ts
  // Explorer, before → after
  new FileTreeProvider(rootPath)
  createTreeProvider({ type: "file", rootPath })
  // Archive, before → after
  new ArchiveTreeProvider(archiveUrl)
  createTreeProvider({ type: "archive", url: archiveUrl, rootPath: "" })
  // Mneme, before → after
  new MnemeTreeProvider(match.name)
  createTreeProvider({ type: "mneme", rootPath: match.name })
  ```

- [x] Keep direct file constructors in `src/renderer/ui/sidebar/MenuBarView.ts` (`getProvider` caches local configured folders), `src/renderer/ui/sidebar/ScriptLibraryPanelView.ts` (local script library), and `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` (`openFolder` validates a local directory using `fpDirname` and `stat`). These receive local filesystem paths, not a provider type from data. Keep `new LinkTreeProvider(this, this._host.state.get().filePath || "")` in `src/renderer/editors/link-editor/LinkEditor.ts`: it requires the live editor and cannot be built from persisted data. These direct constructions are intentional; no duplicate data-driven dispatch exists there. The epic's broader “no host constructs” goal is narrowed here to preserve these local-only helpers, as allowed by the task.
- [x] Keep `CategoryEditorModel`'s link routing and host lookup unchanged: the type from the link selects an existing host, it is not passed into a constructor. Do not create a fallback provider, transient host or selection state. Any future path that actually constructs from persisted or link-supplied `type` must call the registry; US-2246 owns new persisted tree restoration. Correct the misleading fallback-creation comment in `src/renderer/content/tree-providers/tree-provider-link.ts` without changing its wire format. `src/renderer/content/parsers.ts`, `resolvers.ts`, and `builtin-schemes.ts` require no change: they route virtual links, not provider construction.
- [x] The implementer runs `npm run typecheck`, `npm run lint`, and `npm run build-prod`; compare renderer entry imports and archive-containing chunks against a pre-change production build as described above. Results: all three commands passed. The `index.html` modulepreload list stayed unchanged (only the entry bundle hash changed); the archive provider moved from `ArchiveEditor-vphYqdb3.js` in the baseline bundle graph into `storybook-page-id-CzRAMVWj.js` after the factory import, which is not preloaded by the main entry. No archive provider chunk was pulled into the main entry.
- [ ] Codex cannot launch Persephone or run its Electron UI suite in this environment. Claude runs the existing UI tests live afterwards: `integration-test/tests/sidebar/explorer/explorer.test.mjs`, `integration-test/tests/editors/folder/folder-view.test.mjs` (includes `Archive Folder View lists a nested category and exposes no write actions`), and `integration-test/tests/editors/links/links.test.mjs`, plus relevant sidebar, scripting and menu tests. Claude checks archive open, nested folder navigation, switching away/back and restore, and runs `integration-test/tests/tools/mneme/mneme.test.mjs` with `--with mneme` when its environment is available. Record skips and causes; no unit tests.

## Concerns / Open questions

- The virtual routing chain is `registerRawLinkParsers` → `dispatchRegisteredSchemeParse` → `builtin-schemes.ts` `parseVirtual` (sets URL and default Category editor target), then `registerResolvers` → `dispatchRegisteredSchemeResolve` → `resolveVirtual` (virtual pipe and content handoff). Neither decodes `type` or creates a tree. `CategoryEditorModel.initFromLink` encodes the metadata; `decodedLink` decodes it; `findTreeProviderHost` compares exact `type` and `sourceUrl` in `page.panelEditors`. With no match, `listItems` returns `undefined`, actions report no host, and no provider is created. `buildFolderCategoryLink` uses a containing panel provider if present, otherwise emits a `file` link anchored at the folder; it does not construct a provider.
- Archive's `getNavigationUrl` emits category links with the archive source and inner category, so a Category view can use a matching archive panel host. Mneme's `getNavigationUrl` returns an empty string for directories and they expand in place; `MnemeRootEditorModel` has a provider but does not register `TREE_PROVIDER_HOST_TRAIT`. A manually supplied Mneme category link can route to the editor but cannot find that Mneme host. Do not add such support here. `LinkTreeProvider` requires live mutable editor state and cannot be reconstructed from its URL alone. `git-tree` uses its own `git-tree` scheme and editor, not `ITreeProvider`.
- `eslint.config.mjs` forbids content importing editors except the listed catalog, registry and browser seams, and also forbids content importing components or scripting. The factory imports content-owned providers; the editor-owned Link provider stays direct. Do not add exceptions, wrappers or `await import()` to bypass the zone. Check static imports for cycles and compare production output as described above; do not eagerly load editor modules.
- Strict-null gate `scripts/typecheck-strict.mjs` includes `content/`, `ui/` and `scripting/`; `editors/` is not listed. New factory and link-helper edits are strict. Any incidental null fixes in strict folders must be type-only, with no changed runtime condition, unless a behavior change is explicitly recorded; fix declared types first and explain any `!` inline.
- No new protocol, board rules, `window.persephone` change, or bridge-version change is planned. If implementation changes `window.persephone`, bump `BOARD_BRIDGE_VERSION` and add its history line as required. `LinkEditor.ts` is untouched; no planned implementation file is listed in roadmap §2.3. No unresolved design decision is required before implementation.

## Acceptance Criteria

- [x] One synchronous registry-owned factory maps file, archive and mneme to their existing providers and preserves constructor values. Exact types take precedence over matchers, matchers run in registration order, and US-2245 can add one namespaced matcher for all board types; unknown types throw.
- [x] Explorer, archive and Mneme construction uses the factory; Link editor and local-only direct constructors and Category host-only matching remain as specified. No link, persistence, selection, disposal, navigation or user-visible behavior changes.
- [x] Implementer records passing typecheck, lint and production build plus the renderer chunk comparison; no unit tests added.
- [ ] Claude runs the listed UI tests live, recording results, manual checks and available Mneme coverage. Existing UI tests remain green.
- [x] Import zones and god-file rule pass; no board/protocol/bridge work or new fallback behavior is introduced.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/content/tree-providers/tree-provider-factory.ts` | New descriptor, typed factory and registry, built-in registrations. |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Route file construction through factory. |
| `src/renderer/editors/archive/ArchiveEditor.ts` | Route both archive construction paths through factory. |
| `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` | Route Mneme construction through factory. |
| `src/renderer/content/tree-providers/tree-provider-link.ts` | Correct stale fallback comment only. |
| `doc/tasks/US-2243-tree-provider-factory/README.md`, `doc/active-work.md`, `doc/epics/EPIC-217.md` | This plan and links. |

**No implementation changes:** `src/renderer/editors/link-editor/LinkEditor.ts`, `src/renderer/editors/category/CategoryEditorModel.ts`, `src/renderer/content/parsers.ts`, `src/renderer/content/resolvers.ts`, `src/renderer/content/builtin-schemes.ts`, `src/renderer/ui/sidebar/MenuBarView.ts`, `src/renderer/ui/sidebar/ScriptLibraryPanelView.ts`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, git-tree, board registries and bridge. Existing provider implementations and UI test files also need no changes.
