# US-2011: Upgrade Monaco to 0.57.0

## Goal

Upgrade `monaco-editor` from 0.55.1 to 0.57.0 as part of [EPIC-179](../../epics/EPIC-179.md), preserving editor, worker, clipboard and translated UI behavior.

## Background

Investigation on 2026-11-15 used an offline, isolated npm install of `monaco-editor@0.57.0` under the system temporary directory; the repository install and manifests were not changed. The npm cache had to be copied to a writable temporary cache (see [US-2010](../US-2010-dependency-refresh-in-range/README.md)).

- The `platform.js` and `process.js` Node-detection conditions are unchanged in 0.57.0. Electron exposes Node in the renderer, so preserve both web-environment workarounds. The exact replacement patch below contains only these two hunks; `git apply --check` passed against the isolated 0.57.0 files with LF patch line endings. In 0.57.0 `clipboard.js` PasteAction no longer requests `IProductService` or telemetry at all; the third hunk is obsolete, regardless of standalone service registration. Paste still needs a runtime check.
- `vite-plugin-monaco-editor-esm` 2.0.3 resolves literal paths relative to `node_modules` and the existing patch adds `.js`. The package ships these nine worker files (all paths relative to `monaco-editor/esm/vs/`):

  ```text
  editor/editor.worker.js
  language/css/css.worker.js
  language/html/html.worker.js
  language/json/json.worker.js
  language/typescript/ts.worker.js
  languages/features/css/css.worker.js
  languages/features/html/html.worker.js
  languages/features/json/json.worker.js
  languages/features/typescript/ts.worker.js
  ```

  The four `language/...` files are compatibility wrappers importing their respective `languages/features/...` workers. The plugin's five entries match the first five files with the `.js` fallback. `vite.renderer.config.ts` selects TypeScript, editor, JSON and HTML; CSS is shipped and resolvable but is not selected. JavaScript shares TypeScript; HTML also serves handlebars and razor. Keep the plugin patch and selection. Its `node_modules/.monaco/` cache can contain old output; clear that disposable cache before building.
- None of the 12 distinct `esm/nls.messages.*.js` imports in `src/renderer/i18n/monaco-nls.ts` exist in 0.57.0. The corresponding `esm/vs/nls/lang/{cs,de,es,fr,it,ja,ko,pl,pt-br,tr,zh-cn,zh-tw}.js` files all exist, each with a declaration and the same global message-table side effect. Use the exported `monaco-editor/nls/lang/<locale>.js` subpath, which maps to those files via the package exports. Preserve the current fallback mapping and load-before-Monaco ordering. Remove the now-unnecessary `@ts-expect-error` comments.
- The packaged 0.56 changelog records ESM entry reorganization, `IOverlayWidgetPosition.stackOridinal` ? `stackOrdinal`, and removal of `IMirrorModel` and `IWorkerContext`; 0.57 lists additions, not further removals. `src/` uses none of those removed/renamed symbols. The package root still registers all features/languages and exposes `typescript`, `css`, `languages`, `editor`, and core types. Inspection of the new declarations and a `tsc --noEmit` probe of the full `src/` tree with `monaco-editor` mapped to the isolated 0.57 declarations passed. Old NLS imports are suppressed by existing `@ts-expect-error`, so this probe does not verify their runtime resolution. It also does not run the strict-folder gate or validate runtime behavior.
- The source audit includes `api/setup/configure-monaco.ts`, `library-intellisense.ts` and `monaco-languages/` (defaults, extra libs, tokenizer registration, themes, keybindings, compiler options), `editors/shared/MonacoEditorHostView.ts`, `MonacoDiffEditorHostView.ts`, `monaco-project-intellisense.ts`, `monaco-project-diagnostics.ts` (worker diagnostics and markers), `ColorizedCodeView.ts` (Monarch and `editor.colorize`), `editors/monaco/MonacoBodyView.ts`, script panel, compare/file-diff, log view, MCP inspector and Monaco-typed controllers. No API change is indicated by the declarations or changelog. The only source imports under `monaco-editor/esm/` are the NLS imports; the colorization safety comment refers to an internal file, not an import. In 0.57 its renderer still escapes `<` and `>` at lines 905?910; update the stale line reference. Monaco's bundled TypeScript is 5.9.3 in both 0.55.1 and 0.57.0 (independent of the root TypeScript dependency); project completions and diagnostics still require runtime verification.

## Implementation Plan

- [x] From the repository root, install with lifecycle scripts suppressed until the patch is replaced:

  ```powershell
  npm install --save --ignore-scripts monaco-editor@0.57.0
  ```

  Verify `package.json` changes `"monaco-editor": "^0.55.1"` ? `"monaco-editor": "^0.57.0"` and the lockfile resolves 0.57.0. Review for unrelated dependency changes. Offline npm may need a writable copy of its cache, as described in US-2010.
- [x] Replace `patches/monaco-editor+0.55.1.patch` with `patches/monaco-editor+0.57.0.patch` containing exactly the following (the clipboard hunk is removed):

  ```diff
  diff --git a/node_modules/monaco-editor/esm/vs/base/common/platform.js b/node_modules/monaco-editor/esm/vs/base/common/platform.js
  index 04704b1..b2f85f3 100644
  --- a/node_modules/monaco-editor/esm/vs/base/common/platform.js
  +++ b/node_modules/monaco-editor/esm/vs/base/common/platform.js
  @@ -24,7 +24,7 @@ if (typeof $globalThis.vscode !== 'undefined' && typeof $globalThis.vscode.proce
       // Native environment (sandboxed)
       nodeProcess = $globalThis.vscode.process;
   }
  -else if (typeof process !== 'undefined' && typeof process?.versions?.node === 'string') {
  +else if (typeof process !== 'undefined' && typeof process?.versions?.node === 'string' && false) {
       // Native environment (non-sandboxed)
       nodeProcess = process;
   }
  diff --git a/node_modules/monaco-editor/esm/vs/base/common/process.js b/node_modules/monaco-editor/esm/vs/base/common/process.js
  index 38e1a14..1e31720 100644
  --- a/node_modules/monaco-editor/esm/vs/base/common/process.js
  +++ b/node_modules/monaco-editor/esm/vs/base/common/process.js
  @@ -17,7 +17,7 @@ if (typeof vscodeGlobal !== 'undefined' && typeof vscodeGlobal.process !== 'unde
       };
   }
   // Native node.js environment
  -else if (typeof process !== 'undefined' && typeof process?.versions?.node === 'string') {
  +else if (typeof process !== 'undefined' && typeof process?.versions?.node === 'string' && false) {
       safeProcess = {
           get platform() { return process.platform; },
           get arch() { return process.arch; },
  ```

  Run `npx patch-package --error-on-fail`; verify both Monaco process conditions contain `&& false`, the plugin patch applies, and no old Monaco patch remains. The pre-existing `vscode.process` branch is unchanged. Verify context-menu paste in the smoke check.
- [x] In `src/renderer/i18n/monaco-nls.ts`, replace every locale import using this pattern, including both repeated fallback cases, and remove all adjacent `@ts-expect-error` comments:

  ```typescript
  // Before
  // @ts-expect-error Monaco ships this side-effect module without a declaration.
  messages = import("monaco-editor/esm/nls.messages.de.js");
  // After
  messages = import("monaco-editor/nls/lang/de.js");
  ```

  Apply the same transformation to cs, es, fr, it, ja, ko, pl, pt-br, tr, zh-cn and zh-tw. Keep the switch, `messages.then`, locale mappings and `_VSCODE_NLS_LANGUAGE` unchanged.
- [x] In `src/renderer/editors/shared/ColorizedCodeView.ts`, update the safety comment's `viewLineRenderer.js:856-860` ? `viewLineRenderer.js:905-910`, after checking the installed file. Do not alter colorization behavior.
- [x] Remove the disposable `node_modules/.monaco/` worker cache so production output is rebuilt from 0.57. Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; resolve regressions and record results. The sandbox may return `spawn EPERM` for esbuild as in US-2010; if so record the failure and run the affected check in an environment that permits its service process. Inspect generated worker output and confirm the plugin and Monaco patches are applied after reinstall.
- [x] No changes are expected in `vite.renderer.config.ts`, `patches/vite-plugin-monaco-editor-esm+2.0.3.patch`, `src/renderer/api/setup/configure-monaco.ts`, `src/renderer/api/setup/library-intellisense.ts`, `src/renderer/api/setup/monaco-languages/`, `src/renderer/editors/shared/monaco-project-intellisense.ts`, `src/renderer/editors/shared/monaco-project-diagnostics.ts`, editor/diff hosts, script panel or compare views. Change them only if verification establishes a regression.

## Smoke check (Claude, after implementation)

Fully exit Persephone, cold-start with `npm start`, and check:

- [x] TypeScript project cross-file completions and enabled per-page diagnostics; verify worker loading, and try JSON and HTML language features. (`items.` listed `at`, `concat`, … from the TS worker. Diagnostics are off by design in `configure-monaco.ts`.)
- [x] Paste text using the editor context menu. (Monaco's own context menu → Paste inserted the clipboard text without the removed clipboard hunk.)
- [x] Open a compare or file-diff page and verify both sides and differences. (`pages.openDiff` on two text files showed both sides, with 5 insert and 3 delete decorations.)
- [x] Translated Monaco text: instead of switching the user's UI language, every import in the dev-served `monaco-nls.ts` was fetched. All 14 resolved (HTTP 200) through Vite's dependency pre-bundling, and each sets `_VSCODE_NLS_MESSAGES`.
- [x] Open the script panel and check that its Monaco editor mounts. (It mounted. Script running is not Monaco-specific and was not exercised.)
- [x] Open a colorized code view and verify syntax highlighting and literal `<`/`>` text. (A Markdown `ts` code block rendered 29 colored tokens; `<div>`, `<` and `>` stayed literal with no injected elements.)

Claude ran these on 2026-11-15 on a cold `npm start`, after clearing `node_modules/.vite`.

## Implementation findings

- The first install attempt could not use the configured cache because npm writes were restricted outside the workspace. Copying that cache into `.npm-cache-us2011/` allowed the requested install to resolve Monaco 0.57.0 offline.
- `package.json` now requests `^0.57.0` and the lock resolves 0.57.0. Monaco 0.57.0 pins `dompurify` to 3.4.15; npm deduplicated that required dependency to the root lock entry, replacing the prior 3.4.12 entry. No other dependency entries changed.
- `npx patch-package --error-on-fail` applied both `monaco-editor@0.57.0` and the existing `vite-plugin-monaco-editor-esm@2.0.3` patch. The old Monaco patch was removed; the new patch contains only the two planned `&& false` process checks. The patched plugin keeps its `.js` worker-path fallback.
- All twelve locale modules and declarations exist under `esm/vs/nls/lang/`; the package export wildcard maps `monaco-editor/nls/lang/<locale>.js` to those files. The source imports now use those exported paths, with fallback mappings and load order unchanged. Monaco 0.57.0's renderer escapes `<`, `>` and `&` at the referenced source lines.
- The disposable `node_modules/.monaco/` worker cache was removed before the production build.
- `npm run typecheck` passed (strictNullChecks: 18 folders, 0 errors), and `npm run lint` passed.
- `npm run build-prod` passed. The plugin output contains `editor.worker.bundle.js`, `json.worker.bundle.js`, `html.worker.bundle.js` and `ts.worker.bundle.js` from Monaco 0.57.0. The build reported config-loader/deprecation, ineffective dynamic-import, callback-timing and large-chunk warnings, with no errors.
- The Claude smoke check was skipped as requested; runtime behavior still requires that separate check.

## Concerns

- The declaration probe cannot establish that workers, clipboard, NLS load order or colorization work at runtime; the smoke check is required. Plugin worker entries use compatibility paths, not the new supported export paths, and could disappear in a future Monaco release.
- The TypeScript worker's diagnostics shape is interpreted by `monaco-project-diagnostics.ts`; compile-time compatibility does not guarantee identical diagnostic output. Monaco's bundled compiler can change independently of the root compiler in future upgrades.

## Acceptance Criteria

- [x] Monaco 0.57.0 is installed and locked, with only the two process-detection patch hunks retained; `patch-package` succeeds.
- [x] All current translated Monaco locales resolve and load; existing fallback behavior is preserved.
- [ ] Typecheck, lint and production build pass; the smoke checks pass and results are recorded.
- [x] No unrelated dependency or intended user-facing behavior changes.

## Files Changed

| File | Planned change |
|---|---|
| `package.json`, `package-lock.json` | Upgrade and lock Monaco 0.57.0 |
| `patches/monaco-editor+0.55.1.patch`, `patches/monaco-editor+0.57.0.patch` | Replace old patch with the two retained hunks |
| `src/renderer/i18n/monaco-nls.ts` | Move locale imports to exported subpaths and remove obsolete suppressions |
| `src/renderer/editors/shared/ColorizedCodeView.ts` | Refresh internal source line reference |
| `doc/tasks/US-2011-monaco-0-57/README.md` | Record implementation and verification results |
