# US-2205: Linux path semantics

## Goal

Preserve legal POSIX backslashes and case differences throughout local-file identity and navigation, while retaining Windows behavior. This is [EPIC-213](../../epics/EPIC-213.md), WIN-16 (path identity), WIN-24 and R-8; the roadmap identifies mistaken file operations as a data-loss risk.

## Background

`src/shared/platform.ts` exports `isWindows` and `pathsAreCaseInsensitive` (currently Windows only). `src/renderer/core/utils/file-path.ts` owns renderer Node path access and archive syntax; `src/main/utils.ts` owns `comparePathKey`, used by board grants and trust. Both resolve, rewrite backslashes, strip trailing `/`, and fold case on Windows. `src/shared/path-containment.ts`'s `isKeyInside` consumes keys and requires a `/` boundary. The two normalizers duplicate a rule, and R-8 reports a POSIX literal backslash being equated with a directory separator.

The inventory's working examples are `src/main/board-file-access.ts`, `src/main/board-host/rpc/files.ts`, `src/main/path-watch-service.ts`, `src/renderer/api/ts-project-files.ts`, `src/test-host/test-identity.ts`, and the shape-aware `src/shared/board/board-root.ts`. Preserve their distinct contracts: realpath authorization, native watcher paths, glob paths, and board digest inputs are not interchangeable. `BoardRoot` accepts Windows-shaped roots even off Windows; its persisted digest inputs must not be silently migrated.

`FileTreeProvider.list()` builds the parent row, `getCategorySegments()` builds breadcrumbs, and `classifyWatchBatch()` groups changes by comparison keys. `href-utils.ts` and `plural-actions.ts` also handle archive and virtual providers, not only local files: their unresolved-string key follows the platform rule without resolving the href. Linux archive entries already use `/` and are case-sensitive; case-sensitive virtual/category hrefs on Linux are acceptable. `fpDirname` already uses `/` for archive inner paths; `fpJoin` joins inner segments with `/`. `fpBasename` currently uses native `path.basename` for inner paths, and `isAsarPath` rewrites all backslashes. The outer archive path is a native filesystem path; the `!` entry uses archive `/` separators.

The impact is concrete: `tree-drop-actions.ts` and `os-clipboard.ts` detect move/copy overwrite collisions; `plural-actions.ts` prunes descendants before batch delete; `TreeProviderViewModel.ts` and `provider-tree-store.ts` select, reveal and refresh nodes; `FileTreeProvider.rename()`/`deleteItem()` perform the resulting operations. `src/renderer/api/fs.ts` routes rename and save operations, and page identity uses `fileIdentity` (hence save-as/open-page deduplication). Explorer and Folder View share the tree-provider actions. A false match can suppress, misdirect, or misidentify an operation; verify the actual operation and surviving contents, not merely labels.

### Separator audit

Whole `src/` search covered backslash replacement, both separator character-class orders, separator splits and related regex tests. Locations below group multiple hits in one file; line numbers are navigation aids. Decisions apply to filesystem input; protocol-specific parsing and validation retain their own contracts. **Platform-aware** means use the appropriate owner below, preserving the Windows branch; **intentionally both** means the input grammar or validation deliberately recognizes both.

| Location | Decision and reason |
| --- | --- |
| `renderer/core/utils/file-path.ts:158,262` | Platform-aware: `.asar` segment and native comparison key; archive inner paths use `/`. |
| `main/utils.ts:12` | Platform-aware: `comparePathKey`; delegate to shared key owner after native resolve. |
| `renderer/content/tree-providers/FileTreeProvider.ts:140-141,197-198` | Platform-aware: parent comparison and breadcrumbs; retain original path spelling. |
| `renderer/components/tree-provider/plural-actions.ts:35-37`, `href-utils.ts:19` | Platform-aware unresolved-string key for all providers; no provider threading. |
| `renderer/components/roots-tree-build.ts:83,88` | Platform-aware local root segment splitting; retain native segment spelling. |
| `main/search-worker.ts:267` | Platform-aware: native relative filesystem path to slash-delimited search path. |
| `main/app-asset-protocol.ts:37` | Platform-aware: native joined path used for CORS allowlist; keep allowlist exact. |
| `main/path-watch-service.ts:127,133,646` | Platform-aware: native `.asar` boundary, trailing separator and requested-folder detection; keep watcher key and root behavior. |
| `shared/mime-types.ts:62` | Platform-aware for local path input; retain URL parsing behavior for URL input. |
| `renderer/editors/shared/monaco-project-intellisense.ts:67` | Platform-aware filesystem input to `monaco.Uri.file`; preserve POSIX literal backslash. |
| `renderer/editors/category/FolderViewModeService.ts:66` | Platform-aware local folder preference identity; preserve stored Windows keys. |
| `renderer/editors/mneme-root/MnemeRootEditorModel.ts:72,77`, `renderer/api/mneme-client.ts:158` | No change: Mneme is gated off on Linux until Phase 3. |
| `renderer/editors/board/BoardsPanelEditorModel.ts:77-91` | No change: board identity and compatibility are outside this task. |
| `renderer/editors/file-diff/FileDiffEditor.ts:95`, `renderer/editors/git-tree/GitTreeEditorModel.ts:71,510` | Platform-aware native paths; preserve Git's slash-based relative path format and verify consumers. |
| `renderer/api/library-service.ts:188`, `renderer/api/ts-project-registry.ts:63`, `renderer/api/ts-project-files.ts:50,138` | Platform-aware native relative/resolved paths before module/project keys; keep `/` protocol delimiters. |
| `renderer/api/ts-project-files.ts:27` | Deferred: user-provided glob grammar and escaping require more than a native-path guard. |
| `renderer/api/boards/board-file-masks.ts:10`, `renderer/components/icons/language-icon-resolver.ts:199` | Platform-aware when detecting a local path rather than a plain filename. |
| `shared/board/board-root.ts:10-11,67,75,101-102`, `shared/board/board-data-id.ts:13` | No change: deliberate shape-aware board parsing and stable identities/digests. |
| `shared/board/board-masks.ts:41,76` | No change: board mask and path contracts remain unchanged. |
| `shared/guides/mounted-source.ts:43,79` | No change: mounted guide and board-root conventions remain unchanged. |
| `main/board-window-identity.ts:66,129` | Intentionally both: Windows shortcut command-line quoting and Windows shortcut identity; check its Windows-only callers before changing. |
| `main/file-system-access-policy.ts:20,25` | Intentionally Windows policy today; POSIX policy belongs to US-2206. Do not weaken its validation here. |
| `main/board-host/rpc/files.ts:56` | Intentionally both: rejects separators in untrusted masks; security validation, not path splitting. |
| `main/module-service/process.ts:69` | Intentionally both: validates module path segments against traversal in untrusted input; retain conservative rejection. |
| `main/mcp/ai-vision/guide-source.ts:70`, `test-host/captured-downloads.ts:66,70` | Intentionally both: traversal/filename sanitization for untrusted input. |
| `test-host/failure-bundle.ts:141` | Intentionally both: artifact filename sanitization. |
| `main/windows-sso.ts:46`, `main/test-mode/board-process-sandbox.ts:47` | Intentionally Windows-specific SSO/sandbox conventions; sandbox portability is US-2207. |
| `main/terminal-launcher.ts:23` | Intentionally both for recognizing configured Windows command names; terminal implementation is Windows-specific. |
| `main/tor-service.ts:408` | Platform-aware filesystem data directory before writing Tor configuration; retain Tor configuration escaping and Windows output. |
| `main/site-permission-store.ts:22,34`, `main/browser-service.ts:216` | Intentionally both for session/profile validation; reject either slash in identifiers. |
| `renderer/scripting/script-utils.ts:34` | Intentionally both for stack-frame text matching across source formats, not filesystem identity. |
| `renderer/core/utils/html-resources.ts:184` | Intentionally both for URL/resource parsing; do not reinterpret as local path identity. |
| `renderer/scripting/ai-vision/namespaces/clipboard.ts:76`, `renderer/api/boards/board-page-router.ts:235`, `renderer/editors/browser/BrowserEditor.ts:456`, `renderer/api/site-extensions.ts:72` | Intentionally both: recognize/validate Windows-shaped user input, not normalize native paths; retain existing routing. |

Other `split(/...)` hits found were whitespace, line, URL query, or UI identifier parsing, not separator operations. Search extensions, schemes, shortcuts, display searches and MIME labels are intentionally case-insensitive; they are not path equality.

## Implementation Plan

- [x] Make `src/shared/path-containment.ts` the owner of the **single separator-and-case rule**, with two pure string entry points: an unresolved href key and a resolved native path key. Both convert `\` to `/` only if `isWindows` and lowercase only if `pathsAreCaseInsensitive`; each preserves its existing trailing-slash contract. Reuse existing `isKeyInside` for containment. `src/main/utils.ts` `comparePathKey` and `src/renderer/core/utils/file-path.ts` `fpNormalizeForCompare` retain their APIs and resolve with their existing Node path access, then call the resolved entry point. Main `isPathInside`, renderer `fpIsInside`, board grants, watchers and page identity keep their call sites. Preserve existing root/trailing-slash representation exactly on Windows, including drive/UNC roots; preserve `/` containment semantics on POSIX. The shared owner contains the algorithm, has no Node import, and is not an import-zone wrapper.

  Before → after (schematic, keep the existing trailing-root behavior):

  ```ts
  const resolved = path.resolve(filePath).replace(/\\/g, "/").replace(/\/+$/, "");
  return pathsAreCaseInsensitive ? resolved.toLowerCase() : resolved;
  // →
  return resolvedPathCompareKey(path.resolve(filePath));
  ```

- [x] In `file-path.ts`, use native separator logic for `isAsarPath`. Audit `fpBasename`, `fpExtname`, `fpDirname`, `fpJoin`, `parseArchivePath`, `buildArchivePath`, and `fpNormalizeForCompare`: split at the recognized `!` before normalizing; apply native rules to the outer path and `/` rules to the entry. **Every `fp*` function must retain identical Windows inputs and outputs**, including inner paths containing `\`. POSIX inner literal backslashes remain literal; `.asar` native paths follow native rules. Keep archive extension recognition case-insensitive. Verify `src/renderer/api/archive-service.ts` and `src/renderer/content/tree-providers/ArchiveTreeProvider.ts` entry naming and lookup end-to-end; do not resolve an entry alone. Existing archive UI coverage: `integration-test/tests/editors/folder/folder-view.test.mjs`, `Archive Folder View lists a nested category and exposes no write actions`.
- [x] In `FileTreeProvider.ts:140-141,197-198`, guard each existing backslash conversion with `isWindows`, retaining the existing parent comparison, breadcrumb algorithm, case and returned path spelling on Windows. Preserve literal POSIX backslashes. In `roots-tree-build.ts:83,88` split native paths with `fpSep`; retain its existing case-aware segment key.
- [x] In `src/renderer/components/tree-provider/href-utils.ts`, use the unresolved shared key for `hrefKey` and `normalizeHref`, retaining the latter's trailing-slash removal. In `plural-actions.ts:35-37`, use the same key and preserve its existing trailing-slash and self-exclusion behavior. Do not thread provider capabilities through callers. On Windows these operations are byte-identical to today; on Linux archive and virtual hrefs compare case-sensitively. Before → after:

  ```ts
  return href.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  // → shared href key applies Windows-only separator conversion and case folding
  return hrefCompareKey(href).replace(/\/+$/, "");
  ```

- [x] Correct the independent hard-coded case comparisons in `src/renderer/components/tree-provider/TreeProviderViewModel.ts:595,599` (ancestor/root) with the shared href key, and `tree-drop-actions.ts:152,155,253,256` and `os-clipboard.ts:53,57` (overwrite-name comparisons) with the shared case rule. Keep changes local and ensure `TreeProviderViewModel.ts`, a roadmap §2.3 god file, does not grow. No provider-capability threading or extraction is needed.
- [x] In `src/main/clipboard-service.ts` `isSamePath`, use the shared resolved-key rule while retaining its existing `path.resolve` behavior; in `src/test-host/launcher.ts` `verifyAttachedProfile`, use `src/test-host/test-identity.ts`'s existing `normalizeTestFile` after the existing realpath calls. Preserve Windows path equality behavior; do not change clipboard history format or native clipboard implementation.
- [x] Replace local-path case comparisons in `src/renderer/editors/explorer/ExplorerEditorModel.ts:212,244`, `ExplorerSecondaryView.ts:366`, and `src/renderer/editors/link-editor/link-importer.ts:87-88` using `fpNormalizeForCompare` or `fpIsInside` for ancestry with a component boundary. Keep URL and virtual-link equality in its own existing domain. `src/renderer/api/fs.ts:505` compares cache IDs, not filesystem identity; preserve that rule unless a separate local path comparison is found, in which case use the same helpers.
- [x] For the remaining platform-aware native-path audit rows, make only local guards: `isWindows ? p.replace(/\\/g, "/") : p`; for existing separator splits or tests use `fpSep` or the native path API. Apply to `src/main/search-worker.ts:267`, `app-asset-protocol.ts:37`, `path-watch-service.ts:127,133,646`, `tor-service.ts:408`; `src/shared/mime-types.ts:62`; and `src/renderer/editors/shared/monaco-project-intellisense.ts:67`, `editors/category/FolderViewModeService.ts:66` (also guard case folding with `pathsAreCaseInsensitive`), `editors/file-diff/FileDiffEditor.ts:95`, `editors/git-tree/GitTreeEditorModel.ts:71,510`, `api/library-service.ts:188`, `api/ts-project-registry.ts:63`, `api/ts-project-files.ts:50,138`, `api/boards/board-file-masks.ts:10`, `components/icons/language-icon-resolver.ts:199`, and `components/roots-tree-build.ts:83,88`. Preserve all Windows branches exactly, including trailing-root handling and security checks. If a particular input needs grammar redesign or more than a local guard, leave that site unchanged and record it under Deferred; do not restructure it. Use `isWindows`/`pathsAreCaseInsensitive`, never new `process.platform` checks.
- [x] Preserve import direction and lint zones; use direct imports, never `await import()` or an import-zone wrapper. Roadmap §2.3 god files do not grow; the local comparison substitution above requires no extraction. Run `npm run typecheck` including strict folders and `npm run lint`. No unit tests or new harnesses.
- [ ] Claude runs affected existing UI areas on Windows and Linux: `integration-test/tests/sidebar/explorer/explorer.test.mjs` (navigation, create/rename/delete/move), `integration-test/tests/editors/folder/folder-view.test.mjs` (Folder View and archives), `integration-test/tests/core/files/files.test.mjs` and `core/smoke/file.test.mjs` (file/open/save), `sidebar/search/search.test.mjs`, `tools/clipboard/clipboard.test.mjs`, `tools/git/git-tree.test.mjs`, and `boards/permissions/permissions.test.mjs` (grant containment). Consult `doc/standards/integration-tests.md` for runner selection; Windows suite and typecheck/lint remain green. Linux runs are Claude's per epic decision 5; no app startup during planning.
- [x] Add at most two UI integration cases, using existing fixture lifecycle, UI interactions and `finally` cleanup. Import shared `isWindows` from `src/shared/platform.ts` as existing `integration-test/tests/helpers/path-comparison.mjs` does. (1) Extend Explorer test: on non-Windows create a literal `a\\b.txt` and nested `a/b.txt` with different contents, verify distinct rows/opened contents, rename the literal via Explorer, and verify the nested file remains unchanged; on Windows exercise an ordinary rename with portable names instead. (2) Extend Folder View test: on Linux create `Case.txt` and `case.txt` with different contents, verify both entries and open each, rename one through the UI and check both contents and paths; on Windows use two distinct non-case-only names and check normal behavior. Use `node:fs` with native `path.join` for literal fixture names, avoiding helpers that reinterpret separators. Restrict case-only setup to Linux because case-sensitive filesystems are not guaranteed on other platforms. These are two integration cases, not unit tests.

## Concerns

- `pathsAreCaseInsensitive` reflects the project's OS policy, not a per-volume filesystem probe. This task follows that policy; no volume detection or macOS policy change.
- Keys are for identity only. Preserve original paths for display, writes, notifications and persisted settings; check existing Windows persisted Folder View keys for compatibility. Unresolved hrefs must not be resolved as native paths.
- A POSIX board root containing a literal backslash is unsupported for now; board parsing, masks and persisted digests remain unchanged in this task.
- `!` recognition depends on an archive extension and can coexist with ordinary `!` in filenames. Test archive root, nested entry, native outer path, `.asar` and Windows separator behavior in the existing archive UI area. Do not change archive format rules merely to make POSIX code pass.
- Path containment is also a security boundary for board grants: keep canonicalization and realpath checks in their current owners; verify `/` and drive roots, sibling prefixes, literal backslashes, and symlinks. The existing key representation strips trailing separators, including root; preserve compatibility while ensuring root descendants remain recognized.
- The board grant, Windows clipboard, Tor, and provider integration surfaces have separate OS or security constraints. This plan changes only native path interpretation, not their platform implementations.

## Deferred

- `src/renderer/api/ts-project-files.ts:27` glob pattern parsing: user-typed pattern grammar and escaping need a separate design; local guards on filesystem-derived paths remain in scope.
- Any audit location that cannot retain its existing contract with a local OS guard or native separator operation stays unchanged and is recorded here during implementation. In particular, redesign of URL/resource parsing, security validation, and board-root or guide grammars is out of scope.

## No changes

- `src/shared/board/board-root.ts`, `src/shared/board/board-data-id.ts`, `src/shared/board/board-masks.ts`, `src/shared/guides/mounted-source.ts`, `src/renderer/editors/board/BoardsPanelEditorModel.ts`: deliberate shape-aware parsing, board identity, masks and digest compatibility are outside this task.
- `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts`, `src/renderer/api/mneme-client.ts`: Mneme is gated off on Linux until Phase 3.
- `src/shared/platform.ts`: reuse existing flags; `src/main/file-system-access-policy.ts`: US-2206 owns the policy; `src/shared/path-containment.ts` `isKeyInside` and clipboard wire formats remain unchanged.

## Acceptance Criteria

- [ ] On Linux, literal backslashes and case-only differences remain distinct across Explorer, Folder View, page identity, watch refresh, rename, move/copy collision checks, batch delete and save-as; unaffected sibling contents survive operations.
- [ ] Main and renderer use one shared separator-and-case rule with resolved-path and unresolved-href entry points; board roots and untrusted input retain their existing grammars. Existing case-preserving helpers and `pathsAreCaseInsensitive` are reused.
- [ ] Windows separator, case, archive, persisted-key and file-operation behavior is unchanged. No new `process.platform` checks; no import-zone bypass or growth of roadmap §2.3 god files; strict typecheck and lint pass.
- [ ] Claude runs the named affected UI areas on Windows and Linux, including the two portable cases above, and records results. No unit tests or harnesses are added.

## Files Changed Summary

| Path | Planned change |
| --- | --- |
| `src/shared/path-containment.ts`, `src/main/utils.ts`, `src/renderer/core/utils/file-path.ts` | Shared comparison owner, native separators, archive-aware renderer operations. |
| `src/renderer/content/tree-providers/FileTreeProvider.ts`, `src/renderer/components/roots-tree-build.ts`, `src/renderer/components/tree-provider/href-utils.ts`, `plural-actions.ts`, `tree-drop-actions.ts`, `os-clipboard.ts`, `TreeProviderViewModel.ts` | Local guards and shared unresolved-href identity; collision and batch actions. |
| `src/main/clipboard-service.ts`, `src/test-host/launcher.ts`, Explorer and link importer files named above | Platform-correct identity at local path call sites. |
| Other files marked platform-aware in separator audit | Local guards only; defer sites requiring restructuring. |
| `integration-test/tests/sidebar/explorer/explorer.test.mjs`, `integration-test/tests/editors/folder/folder-view.test.mjs` | Two portable UI integration cases. |
| Files listed under No changes | Preserve board and Mneme behavior, platform flags, policy, containment protocol and clipboard formats. |
