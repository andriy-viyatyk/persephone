# US-1509: Close the De-React programme — dependencies, tsconfig, eslint

Status: Planned investigation for [EPIC-110](../../epics/EPIC-110.md). US-1507 and US-1508 are
present as uncommitted worktree changes. This document plans the cleanup only; it does not
implement it.

## Goal

Remove the dependency, TypeScript, ESLint, and runtime-support machinery that existed only for the
deleted `src/renderer/editors/draw/**` React island. Keep the React packages available as development
inputs for the committed Excalidraw board-library generator, while ensuring they are absent from the
Persephone renderer bundle and production dependency graph.

This is the final configuration task for EPIC-110 D4. The dashboard entry already exists under
EPIC-110 and is intentionally not changed.

## Background

### Verified starting state and ordering

The current worktree has no `src/**/*.tsx` files and no source import of `react`, `react-dom`, or
`@excalidraw/*`. The deleted draw folder is the eight-file `HEAD` tree listed by `git ls-tree`; the
uncommitted US-1508 changes remove it and its registry, matcher, capability, facade, and public-type
seams. US-1509 must remain after those changes: before that deletion, removing the JSX compiler mode
or the React-specific ESLint handling would break the remaining editor.

The remaining literal React references in `src/` are not imports. They are ordinary words or
historical/explanatory comments, Monaco's user-code JSX setting, and one live janitor whose purpose
is still React-specific. The direct source search for Excalidraw type imports also returns no file;
the only remaining `@excalidraw/excalidraw/dist/types/*` reference is `tsconfig.json`.

### D4: package placement and installer boundary

EPIC-110 D4 is already decided and is not reopened here. Move these four direct packages from
`dependencies` to `devDependencies`, without deleting them:

```json
// Before: package.json
"dependencies": {
  "@excalidraw/excalidraw": "^0.18.1",
  "@excalidraw/mermaid-to-excalidraw": "^2.2.2",
  // ...
  "react": "^19.2.7",
  "react-dom": "^19.2.7"
}

// After
"devDependencies": {
  "@excalidraw/excalidraw": "^0.18.1",
  "@excalidraw/mermaid-to-excalidraw": "^2.2.2",
  // ...
  "react": "^19.2.7",
  "react-dom": "^19.2.7"
},
"dependencies": {
  // no @excalidraw/*, react, or react-dom entries
}
```

The placement is supported by the actual build split:

- `scripts/build-board-lib.mjs:23-25` reads the installed
  `node_modules/@excalidraw/excalidraw/dist/prod` tree. It is a manually run generator, not a
  product-build input.
- Its dependency scan adds the board bootstrap's `react` and `react-dom/client` requirements at
  `:225-228`; `:314-335` bundles dependency entries with esbuild and a production
  `process.env.NODE_ENV` define; `:417-420` marks `react`, `react-dom`, `react-dom/client`, and
  `react/jsx-runtime` for bundling into `assets/boards/excalidraw/lib/deps/`.
- The script therefore needs these packages installed when `npm run build-board-lib` is run, but it
  does not make the app renderer import them. Moving them to `devDependencies` preserves their
  availability in a normal development install and leaves the committed board library untouched.
  Do not run this script during this task: it removes and rewrites the committed board `lib/` at
  `scripts/build-board-lib.mjs:73-75`.
- `scripts/build-prod.mjs:179-189` builds only the renderer source into `.vite/renderer/main_window`.
  After US-1508 there is no source import that can pull the four packages into that build.
- `electron-builder.yml:8-13` packages `package.json`, `.vite/**`, and the production application
  dependency set; it does not add development dependencies to the application dependency graph.
  `electron-builder.yml:15-18` separately copies the whole `assets/` tree as `extraResources`, so
  the board's committed `assets/boards/excalidraw/lib/` remains shipped outside the app bundle.
  The implementation must inspect the unpacked installer artifact to verify that the four packages
  are absent from `resources/app.asar/node_modules/`, while the expected board copy remains under
  `resources/assets/boards/excalidraw/lib/`.

`@types/react`, `@types/react-dom`, and `eslint-plugin-react-hooks` are currently direct
`devDependencies`; the source has no remaining use of the type packages or hook rules. They should
be removed as part of the same package cleanup. Optional peer-dependency declarations mentioning
`@types/react` in transitive packages are lockfile metadata, not application usage, and must not be
mistaken for a remaining source dependency.

Because dependency sections are recorded in the lockfile root and package metadata, update both
manifests. After editing `package.json`, regenerate only the lock metadata with:

```powershell
npm install --package-lock-only --ignore-scripts
```

Then verify the lockfile root places the four retained packages only under `devDependencies`, the
three removed direct tools are absent as direct packages, and `npm ls @types/react @types/react-dom
eslint-plugin-react-hooks --depth=0` no longer reports direct installations. Do not hand-edit
integrity or transitive metadata.

### ESLint: retain the React guard, delete the obsolete island override and hook plugin

`eslint.config.mjs:555-575` is the source-wide `src/**/*.ts`/`src/**/*.tsx` restriction. Its
`av-grid` restriction deliberately applies everywhere except the owning
`src/renderer/uikit/DataGrid/**` implementation. The deleted draw exemption at `:577-590` exists
only because flat-config rule replacement would otherwise erase that `av-grid` restriction inside
the old React island. Once the folder is gone, the exemption must be deleted; the main restriction
must remain unchanged so the av-grid policy cannot be weakened.

The React entries in that main rule should remain as a regression guard. They match no current
source, but they prevent a future renderer import from silently recreating the island, and keeping
the check costs nothing once there is no legitimate `src/` React code. Update their messages so they
describe the post-EPIC-110 invariant rather than claiming an existing `editors/draw/**` exception.

```js
// Before: eslint.config.mjs
import reactHooks from "eslint-plugin-react-hooks";

plugins: {
    "react-hooks": reactHooks,
    "vanilla-view": vanillaViewPlugin,
},
rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    // ...
},

// Main no-restricted-imports rule: av-grid + React entries; draw exemption follows.
// Draw exemption repeats only the av-grid restriction for editors/draw/**.

// After
// no reactHooks import
plugins: {
    "vanilla-view": vanillaViewPlugin,
},
rules: {
    // no react-hooks rules
    // ...
},

// Main no-restricted-imports rule still contains:
//   av-grid, react, react-dom paths and av-grid/*, react-dom/* patterns.
// The draw-specific override is deleted, so the same av-grid policy is not replaced anywhere.
```

The final ESLint shape is therefore not a blanket removal of `no-restricted-imports`: keep the
source-wide av-grid restriction and the React/react-dom import ban, remove only the draw override,
and remove the unused `eslint-plugin-react-hooks` import, registration, and two rules.

### TypeScript: remove only app-level JSX and the dead Excalidraw type path

`tsconfig.json:12-24` has one Excalidraw-specific `paths` mapping and the compiler option
`"jsx": "react-jsx"`. The mapping was needed by the deleted draw island because Excalidraw's
`exports` map does not expose its declaration files. The repository-wide search found no remaining
file importing an Excalidraw declaration, so remove the explanatory comment, the `paths` object, and
the `jsx` option:

```jsonc
// Before: tsconfig.json
// Excalidraw's exports map ...
"paths": {
    "@excalidraw/excalidraw/dist/types/*": ["node_modules/@excalidraw/excalidraw/dist/types/*"]
},
"resolveJsonModule": true,
"jsx": "react-jsx"

// After
"resolveJsonModule": true
```

Keep `baseUrl`, module resolution, and the other compiler options. The config includes only
`src/**/*`; `scripts/*.mjs` are JavaScript build tools outside this tsconfig and resolve the board
package directly through `node_modules`. Keep `src/renderer/api/setup/configure-monaco.ts:157-169`
unchanged: its `monaco.typescript.JsxEmit.React` setting controls diagnostics for user-authored
JSX in Monaco, not compilation of the Persephone source.

### Remove the remaining live React-only runtime guard

The source audit found one machinery seam not listed in EPIC-110's US-1508 deletion table:
`src/renderer.ts:6-8` imports and starts
`src/renderer/core/utils/performance-janitor.ts`. The janitor's complete module comment says it
exists to clear React 19 development `performance.measure()` entries emitted by the old live
Excalidraw island, and `rg` shows no caller other than `src/renderer.ts`.

The performance timeline is per document. The board renders in a cross-origin `board://` frame, so
React's development `performance.measure()` entries land in that frame's own timeline and can never
reach the host renderer's buffer, which is the only buffer this janitor sweeps. The janitor is also
self-gating: its own comment records that production React builds emit no component-track measures,
so the 10,000-measure threshold is never reached in a release build. Deleting it changes nothing a
user ships, and changes the development experience only for a producer that no longer exists.
Delete the janitor module and its import/call, and remove its row from
`doc/architecture/key-files.md:76`. This is a real cleanup, not a vocabulary sweep: the whole
module's documented producer and reachable host buffer are gone. Historical EPIC-082 decided to
keep it while the island still existed; that premise is now false after US-1508.

```ts
// Before: src/renderer.ts
import { startPerformanceJanitor } from "./renderer/core/utils/performance-janitor";

startPerformanceJanitor();

// After: no janitor import or startup call
```

### Production renderer measurement

EPIC-110 exit criterion 3 requires evidence, not a source assertion. The comparison must use the
same output scope and dependency state for both builds:

1. Capture the pre-US-1507/US-1508 baseline from the `HEAD` checkout in an isolated worktree.
   `HEAD` predates both tasks and still contains the eight draw files; it is not merely a
   pre-US-1508 checkout. That is intentional: US-1507 adds no React-affecting code, so the recorded
   comparison is pre-both (`HEAD`) versus post-US-1509, and the renderer delta is attributable to
   US-1508 plus this cleanup, not to the persisted-state migration. Run `npm ci --ignore-scripts` if
   that checkout does not already have its dependencies, then run `npm run build-prod`. Save the byte
   total and marker search output before returning to the task worktree.
2. After this task's package/config/runtime changes, run `npm run build-prod` in the task worktree.
   The renderer output is `.vite/renderer/main_window/`, as stated in
   `scripts/build-prod.mjs:7-14,179-188`.
3. For each build, record total bytes for every file under `.vite/renderer/main_window/` and the
   JavaScript chunk count. Use the same PowerShell measurement:

   ```powershell
   $renderer = Resolve-Path ".vite/renderer/main_window"
   $files = Get-ChildItem $renderer -Recurse -File
   [pscustomobject]@{
       Files = $files.Count
       Bytes = ($files | Measure-Object Length -Sum).Sum
       JavaScriptBytes = (($files | Where-Object Extension -eq ".js" | Measure-Object Length -Sum).Sum)
       JavaScriptFiles = ($files | Where-Object Extension -eq ".js").Count
   }
   ```

4. Search only those emitted renderer chunks for specific React runtime markers, not for the ordinary
   word `react` (which produces false positives in Monaco, comments, and user-facing strings). The
   package/entry markers (`react-dom/client`, `react/jsx-runtime`, `jsx-runtime`) identify retained
   React entry modules; `createRoot` and `jsxDEV` identify the root/JSX runtime APIs; the internal
   symbols (`ReactCurrentDispatcher`, `ReactCurrentOwner`, `REACT_ELEMENT_TYPE`,
   `react.element`, `react.transitional.element`, and `__REACT_DEVTOOLS_GLOBAL_HOOK__`) identify
   React runtime code even when the package name has been minified away. Exclude both the vendored
   board library and source maps inline:

   ```powershell
   rg -n -i --glob "*.js" --glob "*.mjs" --glob "!**/*.map" `
       --glob "!assets/boards/excalidraw/lib/**" `
       "react-dom/client|react/jsx-runtime|jsx-runtime|createRoot|jsxDEV|ReactCurrentDispatcher|ReactCurrentOwner|REACT_ELEMENT_TYPE|react\.element|react\.transitional\.element|__REACT_DEVTOOLS_GLOBAL_HOOK__" `
       .vite/renderer/main_window
   ```

   A true negative is zero matches for this marker set in every emitted renderer `.js`/`.mjs` chunk,
   after any incidental non-runtime match is opened and classified.
   A hit must be opened and classified; a literal in Monaco's embedded language service or an app
   comment or a sourcemap path is not evidence that React's renderer shipped. The final recorded result must
   state the marker count, any classified false positives, and the before→after byte delta.

`assets/boards/excalidraw/lib/` must be excluded from this search and from the renderer byte total.
It legitimately contains the board's vendored React runtime, is served over `board://`, and is not
part of `.vite/renderer/main_window` or the app renderer bundle. Do not run an unscoped repository
search and call those board files a failure. The installer check likewise distinguishes the board's
`extraResources` copy from `app.asar/node_modules`.

### Vite configuration remains board infrastructure

`vite.renderer.config.ts:86-112` explicitly says that `**/assets/boards/*/lib/**` is not an import
source, is served by the main process over `board://`, and must not be watched; `optimizeDeps.entries`
is scoped to `index.html` for the same reason. These settings concern the committed board library,
not the deleted `editors/draw` editor. Leave the file untouched.

## Implementation Plan

1. Confirm the worktree still contains the completed US-1507/US-1508 changes and do not alter
   `doc/active-work.md` or `doc/epics/EPIC-110.md`; the task already appears under EPIC-110.
2. Edit `package.json` to move the four D4 packages to `devDependencies` and remove direct
   `@types/react`, `@types/react-dom`, and `eslint-plugin-react-hooks` entries. Do not remove
   `@excalidraw/*`, `react`, or `react-dom` entirely.
3. Regenerate `package-lock.json` with
   `npm install --package-lock-only --ignore-scripts`. Verify the root sections and direct package
   graph; do not run `npm run build-board-lib` because it rewrites the committed board library.
4. In `eslint.config.mjs`, remove the hook-plugin import, registration, and two hook rules; retain
   the main `no-restricted-imports` av-grid and React/react-dom entries; update the React messages to
   describe the no-React-in-`src/` invariant; delete the obsolete draw exemption block.
5. In `tsconfig.json`, remove the Excalidraw type-path comment/mapping and `"jsx": "react-jsx"`.
   Keep the source include, `baseUrl`, bundler resolution, and unrelated options. Do not change
   Monaco's `JsxEmit.React` setting.
6. Delete `src/renderer/core/utils/performance-janitor.ts`, remove its import and startup call from
   `src/renderer.ts`, and remove the stale key-files index row from `doc/architecture/key-files.md`.
7. Leave `vite.renderer.config.ts` and `assets/boards/excalidraw/lib/**` unchanged. Run the
   pre-US-1508 and final production builds according to the measurement procedure above, recording
   both byte totals, JavaScript counts, marker results, and the byte delta in this document before
   marking the acceptance criterion complete.
8. Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Inspect the produced installer
   (when the normal installer gate is run) to confirm the four D4 packages are not in
   `app.asar/node_modules`, while the board's vendored React remains only under `resources/assets`.

## Measured result (2026-09-25)

Baseline is `HEAD` (commit `3c1a4765`) in an isolated worktree — that is **pre-US-1507 and
pre-US-1508**, so the whole delta is attributable to US-1508's deletion plus this task. US-1507 adds
no React-affecting code.

Renderer output measured over `.vite/renderer/main_window/`, which excludes
`assets/boards/excalidraw/lib/` by construction — the board's vendored React is served over
`board://` and is not part of the app bundle.

| | Files | Bytes | JS files | JS bytes |
|---|---|---|---|---|
| Baseline (`HEAD`) | 630 | 44,601,739 | 565 | 43,947,833 |
| After US-1508 + US-1509 | 546 | 39,948,771 | 486 | 39,517,580 |
| **Delta** | **−84** | **−4,652,968 (−10.4%)** | **−79** | **−4,430,253 (−10.1%)** |

**Marker search — the actual criterion.** Baseline: 17 lines / 35 occurrences, of which 14 were
React runtime. After: **13 lines, zero React runtime**. Every remaining hit is `jsx-runtime` or
`jsxDEV` inside Monaco's TypeScript language service (`esm-*.js`, `monaco.contribution-*.js`,
`ts.worker-*.js`, `ts.worker.bundle.js`) — Monaco knows how to *emit* JSX for user code, which is
why those literals are there and why they are not evidence of a shipped React runtime. None of the
app's own chunks matches any marker.

The decisive markers are all absent: `createRoot`, `react-dom/client`, `REACT_ELEMENT_TYPE`,
`react.element`, `react.transitional.element`, `ReactCurrentDispatcher`, `ReactCurrentOwner`,
`__REACT_DEVTOOLS_GLOBAL_HOOK__`. That is the true negative the plan defined.

`npm run typecheck`, `npm run lint` and `npm run build-prod` (✓ 8.14s) all pass.

> **Measured by Claude, not by the implementing agent.** The implementation run damaged
> `node_modules` (`@rolldown/pluginutils` missing) while producing the baseline and could not
> complete the after-measurement; it correctly reported no estimate rather than guessing. The tree
> was repaired with `npm install` and the numbers above come from a clean build afterwards.

## Concerns

### Resolved decisions

- **Keep the React import ban.** There is no legitimate renderer React left to exempt, so the ban is
  now a cheap regression guard. Removing it would make future accidental reintroduction invisible to
  lint while providing no benefit.
- **Keep the av-grid restriction.** The draw exemption was only a flat-config replacement hazard;
  deleting it exposes no file and cannot weaken the main rule. The existing DataGrid owner exclusion
  remains the intentional place where `av-grid` is imported.
- **Remove hook linting.** The hook plugin and rules have no matching source after US-1508; retaining
  them only installs and configures dead React tooling.
- **Remove the app tsconfig JSX/type-path machinery.** No source file imports an Excalidraw type and
  no `.tsx` source remains. The board generator is JavaScript and outside the tsconfig include.
- **Move, do not delete, the D4 packages.** The board generator resolves and bundles them from
  `node_modules`; devDependencies is the correct lifecycle declaration. The committed board library
  is not regenerated by this task.
- **Delete the performance janitor.** Its only caller is the renderer bootstrap and its own comments
  identify the deleted React island as its producer. This is separate from keeping ordinary
  `reactive` vocabulary or Monaco's support for user JSX.

### Risks and boundaries

- The lockfile may retain optional peer-dependency text mentioning `@types/react` because Excalidraw's
  transitive Radix packages declare optional peers. Acceptance checks direct package placement and
  source usage, not a misleading zero-string grep of lock metadata.
- The production renderer output must not be compared with the board's `assets/boards/excalidraw/lib/`
  tree. That copy is intentionally React-bearing and is packaged as an extra resource.
- Moving a package from `dependencies` to `devDependencies` only removes it from the installer when
  the package is not reachable from a production dependency. The post-build asar inspection is the
  proof; the source audit establishes that the renderer no longer reaches any of the four packages.
- Do not use the current `.vite` directory as the pre-US-1508 baseline unless its provenance is
  recorded. The required baseline is a build from the pre-US-1508 `HEAD` source with the same output
  accounting procedure.

There are no unresolved implementation questions for this task after the source inspection above.

## Verification record

The required pre-change comparison was built from `HEAD` (`3c1a4765`) in the isolated
`.worktrees/us-1509-baseline-archive` checkout before this cleanup. Using the prescribed
`.vite/renderer/main_window` boundary and excluding source maps and the separately served board
library, the baseline measured:

| Build | Files | Total bytes | JavaScript files | JavaScript bytes |
|---|---:|---:|---:|---:|
| `HEAD` baseline | 630 | 44,601,739 | 565 | 43,947,833 |
| Post-US-1509 | not produced | not available | not available | not available |

The baseline marker search returned 17 matching lines containing 35 marker occurrences in seven
emitted files. Fourteen were classified as the actual React runtime in the draw/React chunks
(`chunk-K2UTITRG`, `draw-CUQQ-UHc`, and `prod-BPy0676V`); 21 were false positives from Monaco's
embedded TypeScript/JSX language-service code (`esm-DPNGXWSc`, `monaco.contribution`, and the two
TypeScript worker bundles). The post-change marker search and byte delta are not available because
the final build could not be produced after the live worktree's dependency tree was damaged by an
accidental `npm ci` invocation; no estimate is reported.

`npm run typecheck` passed before that dependency failure. `npm run lint` and the final `npm run
build-prod` could not be completed afterward: the live installation no longer contains the ESLint
executable, and `build-prod` fails before building on missing `@rolldown/pluginutils`. The isolated
reinstall was stopped after registry access stalled; the running worktree was not reinstalled or
pruned.

## Acceptance Criteria

- [ ] `package.json` places `react`, `react-dom`, `@excalidraw/excalidraw`, and
      `@excalidraw/mermaid-to-excalidraw` only under `devDependencies`; they are not deleted.
- [ ] Direct `@types/react`, `@types/react-dom`, and `eslint-plugin-react-hooks` entries are removed
      from `package.json` and the regenerated `package-lock.json`; no source file uses them.
- [ ] `package-lock.json` is regenerated with npm rather than hand-edited, and its root dependency
      sections match `package.json`.
- [ ] `electron-builder` packaging contains no D4 package under `resources/app.asar/node_modules/`;
      the expected vendored board library remains under `resources/assets/boards/excalidraw/lib/`.
- [ ] `eslint.config.mjs` has no React-hooks plugin/rules and no draw exemption; the main
      `no-restricted-imports` rule still enforces av-grid and retains the React/react-dom ban for all
      applicable `src/**/*.ts` and `src/**/*.tsx` files.
- [ ] `tsconfig.json` has no Excalidraw `paths` mapping/comment and no app-level `jsx` option; Monaco's
      user-code JSX setting remains unchanged.
- [ ] `src/renderer/core/utils/performance-janitor.ts` and its `src/renderer.ts` startup seam are
      removed, and the key-files index no longer advertises that React-only janitor.
- [ ] `vite.renderer.config.ts` and `assets/boards/excalidraw/lib/**` are unchanged.
- [ ] A pre-US-1508 `npm run build-prod` and the final build have recorded renderer file count,
      JavaScript count, total bytes, runtime-marker results, and the byte delta in this document.
- [ ] The final renderer chunk search has no unclassified React runtime markers; board-library files
      are excluded from the search and size total.
- [ ] `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass after implementation.
- [ ] Static inspection confirms `npm run build-board-lib` still resolves its inputs from installed
      devDependencies and bundles React into the committed board `lib/deps/`; the script is not run
      by this task.

## Files that need NO changes

- `vite.renderer.config.ts` — its `optimizeDeps.entries: ["index.html"]` and
  `**/assets/boards/*/lib/**` watch-ignore explicitly protect the separately served committed board.
- `assets/boards/excalidraw/lib/**` — committed vendor output; it legitimately contains React and is
  not regenerated here.
- `scripts/build-board-lib.mjs` — its node_modules resolution and React bundling are the reason D4
  packages remain installed as devDependencies; changing it would alter board generation.
- `scripts/build-prod.mjs` — it already builds the renderer from the current source and its output
  path is the measurement boundary; no React plugin or package special case exists there.
- `src/renderer/api/setup/configure-monaco.ts` — `JsxEmit.React` supports user-authored JSX
  diagnostics inside Monaco and is unrelated to the deleted app React island.
- `src/renderer/editors/board/**` and `assets/boards/excalidraw/board-manifest.json` — the board is
  the replacement editor and its committed runtime is consumed as-is.
- `src/renderer/api/pages/PagesPersistenceModel.ts`, `src/renderer/api/settings.ts`, and the other
  US-1507 migration files — their persisted-state migration must remain intact; this task only
  removes the machinery that migration made safe to delete.
- `doc/active-work.md` and `doc/epics/EPIC-110.md` — the task already exists under EPIC-110 and the
  request explicitly forbids adding a dashboard entry.
- `assets/guides/**` and other user-facing guide files — documentation changes for the deleted
  drawing API belong to the epic-level user-documentation pass, not this configuration cleanup.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `package.json` | Move four D4 packages to `devDependencies`; remove direct React types and hook plugin | No |
| `package-lock.json` | Regenerate npm lock metadata after the manifest lifecycle changes | No |
| `eslint.config.mjs` | Remove React-hooks tooling and the draw override; retain av-grid and React import guards | No |
| `tsconfig.json` | Remove the dead Excalidraw type path and app JSX compiler option | No |
| `src/renderer.ts` | Remove the React-only performance-janitor import and startup call | No |
| `src/renderer/core/utils/performance-janitor.ts` | Delete the janitor whose only producer was the removed React island | No |
| `doc/architecture/key-files.md` | Remove the `performance-janitor` key-file index row | No |
| `vite.renderer.config.ts` | No change; board-library watch and dependency-scan boundaries stay | No |
| `scripts/build-board-lib.mjs` | No change; it must continue to regenerate the board from installed devDependencies | No |
| `assets/boards/excalidraw/lib/**` | No change; committed board vendor output remains the separately served React copy | No |
| `doc/tasks/US-1509-close-de-react/README.md` | Record verified findings, decisions, implementation plan, measurements, and acceptance criteria | Yes |
