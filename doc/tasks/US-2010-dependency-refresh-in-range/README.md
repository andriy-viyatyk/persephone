# US-2010: Remove d3 and refresh in-range dependencies

## Goal

Complete the non-major dependency refresh in [EPIC-179](../../epics/EPIC-179.md), align Node types with Electron 44, and regenerate both bundled board libraries without changing intended behavior.

## Background

- `package.json` directly declares six unused graph-editor packages: `d3`, `d3-drag`, `d3-zoom` and their three `@types` packages. No imports or requires of these packages were found in `src/` or `scripts/`. Mermaid still needs transitive d3; do not require its disappearance from the lockfile.
- The epic's in-range table is the target list. The three changing CodeMirror packages are exactly pinned; other `@codemirror/*` pins are not identified as updates in that table. `react` and `react-dom` are declared `^19.2.7`, while the current lockfile resolves both to 19.3.0; they are dev-only inputs for the Excalidraw bundle. Node types are declared `^20.0.0`, currently resolved to 20.19.32.
- `scripts/build-board-lib.mjs` copies the installed `@excalidraw/excalidraw/dist/prod` graph to `assets/boards/excalidraw/lib/`, excluding Xiaolai fonts and unselected locales; it checks copied bytes and relative targets, discovers bare imports, bundles dependencies with esbuild into `lib/deps/`, validates React exports, and rewrites the marked import map in `assets/boards/excalidraw/index.html`. It deletes and recreates the library directory. It resolves dependencies relative to the installed Excalidraw package, so inspect actual resolution as well as root versions. Embedded React versions occur in generated `lib/deps/` files (currently 19.2.7 in several files); these are not a separate source-of-truth manifest and can reflect nested resolution.
- `scripts/build-rest-client-lib.mjs` bundles `assets/boards/rest-client/src/codemirror-entry.js` and installed imports with esbuild into `assets/boards/rest-client/lib/codemirror.js`. `src/request-builder.js` and `src/views/response-viewer.js` consume that output. Neither build script records input versions in a generated manifest; the board manifests record schema, bridge, app and capability versions, not npm dependency versions. The lockfile and installed resolution are the reproducible input record.
- `patches/vite-plugin-monaco-editor-esm+2.0.2.patch` adds a `.js` fallback to `resolveMonacoPath()` for Monaco worker entry paths. An isolated npm install of 2.0.3 showed the fallback is still absent and `git apply --check` against that package passed. Retain the patch under the 2.0.3 filename and verify via `patch-package`; do not alter `patches/monaco-editor+0.55.1.patch`.
- Investigation on 2026-11-15: baseline `npm run typecheck` passed. An isolated install of `@types/node` 24.19.2, selected ahead of the original types through TypeScript `typeRoots`, passed `tsc --noEmit` and the same strict-folder gate with its compiler options temporarily adjusted to those type roots (18 folders, zero errors). `package.json` and `package-lock.json` were never modified; this probes types alone, not the combined upgrade.
- The target packages were installed in an isolated directory for local release-note inspection. Only the three targeted CodeMirror packages shipped root changelogs among the listed targets. The intervening entries record view cursor/scroll fixes and `visualLineSide` deprecation, language's stream-parser type split with re-exports, and a bidi-aware command fix; no documented breaking change was found relevant to the board's use. Absence of packaged changelogs for the others is not evidence of compatibility. Check behavior during verification.
- `doc/agents-common.md` Tech Stack already says Electron 44 and Vite 8; no matching dependency version statements requiring updates were found in `doc/architecture/`. Recheck when implementing if the resolved versions or docs have changed.

## Implementation Plan

- [x] Run `git status` and verify the only pre-existing changes are the expected `doc/active-work.md`, `doc/epics/EPIC-179.md`, and this task folder; capture the lockfile's resolved versions. Keep the epic's major upgrades out of this task: Monaco, Mermaid 12, `@excalidraw/mermaid-to-excalidraw` 3, and all other majors remain for later tasks. Do not run unrestricted `npm update`.
- [x] Remove the six direct declarations and install the exact epic targets below. These commands intentionally suppress lifecycle scripts until the plugin patch has been renamed; they update `package.json`, `package-lock.json`, and `node_modules`. Run from the repository root in PowerShell (one command per line):

  ```powershell
  npm uninstall --ignore-scripts d3 d3-drag d3-zoom @types/d3 @types/d3-drag @types/d3-zoom
  npm install --ignore-scripts --save @modelcontextprotocol/sdk@1.32.2 hls.js@1.7.4 immer@11.2.10 mermaid@11.17.2 jszip@3.10.2 picomatch@4.0.7 turndown@7.2.5 csv-parse@7.0.3 csv-stringify@6.9.0 property-information@7.2.0 video.js@8.24.2
  npm install --ignore-scripts --save-dev vite@8.3.8 esbuild@0.28.2 electron-builder@26.18.0 typescript-eslint@8.72.2 @typescript-eslint/parser@8.72.2 globals@17.14.0 vite-plugin-monaco-editor-esm@2.0.3 react@19.3.1 react-dom@19.3.1 '@types/node@^24'
  npm install --ignore-scripts --save-dev --save-exact @codemirror/view@6.43.15 @codemirror/language@6.13.1 @codemirror/commands@6.11.1
  ```

  Review the diff and run `npm ls --depth=0`: it must report no errors (no missing, invalid, or extraneous packages), validating the lockfile and installed dependency tree. Ensure each listed target resolved and no unrelated major was promoted; retain exact pins for the remaining CodeMirror packages. For example:

  ```json
  // Before → after, representative package.json declarations (JSON excerpts)
  "@codemirror/view": "6.43.11"  →  "@codemirror/view": "6.43.15"
  "@types/node": "^20.0.0"      →  "@types/node": "^24.0.0"
  "react": "^19.2.7"            →  "react": "^19.3.1"
  ```

  npm may save a later 24.x lower bound for `@types/node`; ensure its range remains `^24`, not `^26`. The example is illustrative, not literal JSON.
- [x] Rename `patches/vite-plugin-monaco-editor-esm+2.0.2.patch` to `patches/vite-plugin-monaco-editor-esm+2.0.3.patch`. After the installs, run `npx patch-package --error-on-fail` and confirm both patches report applied and the `.js` fallback is present in `node_modules/vite-plugin-monaco-editor-esm/dist/index.js`. If upstream has since incorporated the same fix, prove it and remove the obsolete patch instead. Never silently discard a failed patch.
- [x] Run `npm run build-board-lib` and `npm run build-rest-client-lib`. Review all added, removed, and changed files under `assets/boards/excalidraw/lib/`, the import map in `assets/boards/excalidraw/index.html`, and `assets/boards/rest-client/lib/codemirror.js`; verify React and CodeMirror resolution using `npm ls react react-dom @codemirror/view @codemirror/language @codemirror/commands`. Inspect embedded version strings where present, accounting for nested dependencies rather than editing generated files by hand. Re-run the rebuilds and verify the second run produces no further diff from the first output.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Investigate and fix regressions caused by these upgrades within scope. The implementer stops after these checks and the board rebuilds; Claude performs the separate smoke check after implementation.
- [x] Review `doc/agents-common.md` Tech Stack and `doc/architecture/` for version claims affected by the actual result; update only if inaccurate. Record verification results and any package-specific compatibility finding in this task document.

## Smoke check (Claude, after implementation)

Fully exit Persephone, run `npm start`, and verify:

- [x] Open a TypeScript page in Monaco and trigger completions to verify workers load. (`items.` listed `at`, `concat`, `copyWithin`, … Diagnostics are switched off in `configure-monaco.ts`, so squiggles are not a usable signal.)
- [x] Open the Excalidraw board and convert a Mermaid diagram to editable Excalidraw shapes. (The board rendered its canvas and toolbar; `parseMermaidToExcalidraw` from the vendored module returned 5 elements: rectangle, diamond, arrow.)
- [x] Open the REST Client board and verify syntax highlighting in the body editor. (The CodeMirror body editor showed the JSON with highlighted tokens.)
- [x] Render a diagram in the Mermaid editor. (An SVG image rendered with no error.)
- [x] Play an HLS stream or a local video. (A local MP4 played: readyState 4, time advancing, no media error.)

Claude ran both board builds outside the Codex sandbox on 2026-11-15. Excalidraw: 33 dependencies bundled, 33 import-map entries. A second run of both builds produced no diff. The bundled React reports 19.3.1. The smoke check ran on a cold start of the dev app against the final install.

## Implementation findings

- The initial working tree contained only the three expected pre-existing paths. The baseline versions and final target versions were captured in the implementation session; all requested direct targets resolved as specified, with `@types/node` saved as `^24.19.2` and resolved to 24.19.2. All six unused d3 direct declarations were removed; Mermaid still carries d3 transitively.
- npm was configured offline and its global cache was outside the writable workspace. Copying that cache into a temporary workspace cache allowed installation. The first dev-dependency resolution needed `--legacy-peer-deps` because the cached registry metadata for `electron-builder-squirrel-windows` was unavailable; a subsequent normal offline-preferred install completed and reified the final tree. `npm ls --depth=0` passes with no missing, invalid, or extraneous top-level packages.
- `npx patch-package --error-on-fail` reports both `monaco-editor@0.55.1` and `vite-plugin-monaco-editor-esm@2.0.3` applied. The installed plugin contains the `.js` fallback.
- Both npm board-build scripts hit `spawn EPERM` when esbuild attempted to launch its hidden service process. The Excalidraw script removes `lib/` before that failure; its original tracked library files were restored byte-for-byte, and no Excalidraw import map change was made. The REST Client bundle was regenerated directly with the installed esbuild 0.28.2 CLI using the script's exact entry, bundle, format, minify, platform and target options; a second run produced the same SHA-256 (`F9A4D6F918518FD74925B32C8ACF1CBA462FBA4C3AAA40E6EC0E17A4F26DF7B2`).
- `npm ls react react-dom @codemirror/view @codemirror/language @codemirror/commands` resolves root React/React DOM 19.3.1 and deduped CodeMirror 6.43.15/6.13.1/6.11.1, but exits nonzero for the existing `@excalidraw/excalidraw@0.18.1` nested Radix 1.0.2 peer ranges, which declare React/React DOM through 18. This task keeps the Excalidraw major unchanged as scoped.
- Against the final install, `npm run typecheck` passed (strictNullChecks: 18 folders, 0 errors), `npm run lint` passed, and `npm run build-prod` passed. Vite emitted its config-loader, deprecated inlineDynamicImports, ineffective dynamic-import, and large-chunk warnings.
- `doc/agents-common.md` and `doc/architecture/` contain no dependency version claims affected by the resolved targets. The separate Claude smoke check was skipped as requested.

## Concerns

- An isolated type-only probe cannot predict errors from all upgrades together; the full typecheck and strict gate must pass against the final install.
- Rename the plugin patch after the installs, then run `npx patch-package --error-on-fail` and confirm both patches report applied; Monaco itself is unchanged.
- Excalidraw may resolve a nested React instead of the root package. Regeneration alone does not prove every embedded React string changed; examine `npm ls`, output and behavior before deciding whether a resolution issue requires a scoped fix.
- Mermaid and its board conversion dependencies have separate dependency trees; preserve their existing major versions even if d3 remains transitive.

## Acceptance Criteria

- [x] All six unused direct d3 declarations are gone; every non-removal target in the epic's in-range table is installed at the specified version or compatible `^24` Node type range, with CodeMirror pins exact and no out-of-scope major upgrade.
- [x] The plugin patch is correctly named and both patches report applied with `npx patch-package --error-on-fail`, and the installed plugin contains the `.js` fallback; if upstream fixes it, demonstrate that and remove the obsolete patch.
- [ ] Both board libraries and any changed import map are regenerated from the final lockfile and reproducible on a second build.
- [ ] Typecheck, lint and production build pass; Claude completes the separate cold-start smoke check after implementation. Results and any relevant changes are recorded.
- [x] Dependency-version documentation remains accurate and `npm ls --depth=0` reports no missing, invalid, or extraneous packages.

## Files Changed

| Path | Planned change |
|---|---|
| `package.json`, `package-lock.json` | Remove direct d3 packages and record the scoped upgrades. |
| `patches/vite-plugin-monaco-editor-esm+2.0.2.patch`, `patches/vite-plugin-monaco-editor-esm+2.0.3.patch` | Rename and retain the verified worker-path fix, or remove it if upstream fixes it. |
| `assets/boards/excalidraw/lib/`, `assets/boards/excalidraw/index.html` | Regenerated vendor graph/dependencies and potentially import map. |
| `assets/boards/rest-client/lib/codemirror.js` | Regenerated CodeMirror bundle. |
| `doc/tasks/US-2010-dependency-refresh-in-range/README.md` | Record implementation and verification findings. |
| `doc/agents-common.md`, `doc/architecture/` | Update only if a version claim becomes inaccurate; none identified in this investigation. |

No changes expected to `scripts/build-board-lib.mjs`, `scripts/build-rest-client-lib.mjs`, either `board-manifest.json`, `assets/boards/rest-client/src/codemirror-entry.js`, or `patches/monaco-editor+0.55.1.patch`; they are inputs or already correct unless verification exposes a concrete defect.
