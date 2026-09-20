# US-1486 — The board's prebuilt `lib/`, generated once and committed

**Status:** Planned · **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) · **Depends on:** [US-1483: Bundled board registry and discovery](../US-1483-bundled-board-registry/README.md)

## Goal

Generate and commit a self-contained browser ESM library for the bundled Excalidraw board, plus a
minimal smoke board proving the library, local fonts, lazy chunks, and worker load inside a
Persephone board frame. The generator is manual and version-driven; no Persephone build rebuilds it.

## Background

### Binding decisions and tracking

Bundled boards live under `assets/boards/<id>/`; existing asset packaging and `getAssetPath()` cover
development and packaged installations. [`EPIC-109.md:48-54`](../../epics/EPIC-109.md#L48-L54)
The board is app-shipped, not copied at runtime, and never written to the trust file.
[`EPIC-109.md:56-69`](../../epics/EPIC-109.md#L56-L69)

D9 is binding: `scripts/build-board-lib.mjs` runs by hand only when Excalidraw is bumped, and
`assets/boards/excalidraw/lib/` is committed. It must not be on the `npm run dist` path. Xiaolai and
all non-English locales are deliberately excluded. [`EPIC-109.md:173-196`](../../epics/EPIC-109.md#L173-L196)

The dashboard already links this exact task at [`active-work.md:36-45`](../../active-work.md#L36-L45),
and the epic table already lists US-1486 at [`EPIC-109.md:198-207`](../../epics/EPIC-109.md#L198-L207);
neither tracking file needs another edit.

### A — Board serving and browser loading risks

The custom-editor registry consumes trusted and bundled manifests. The editor view selects a
permitted root and constructs `BoardHostView`, whose `BoardWebview` registers the root and loads
`board://<host>/index.html`. [`custom-editor-registry.ts:1-15`](../../../src/renderer/editors/board/custom-editor-registry.ts#L1-L15)
[`BoardEditorView.ts:183-246`](../../../src/renderer/editors/board/BoardEditorView.ts#L183-L246)
[`BoardWebview.ts:190-225`](../../../src/renderer/editors/board/BoardWebview.ts#L190-L225)

The `board` scheme is `standard`, `secure`, and `supportFetchAPI`, but deliberately not
`bypassCSP`; it is registered on the app partition at startup. [`main-setup.ts:35-70`](../../../src/main/main-setup.ts#L35-L70)
[`main-setup.ts:103-121`](../../../src/main/main-setup.ts#L103-L121)
The handler resolves the URL pathname below the registered board root, defaults an empty path to
`index.html`, and serves JavaScript/CSS/fonts with explicit MIME types. [`board-protocol-service.ts:176-213`](../../../src/main/board-protocol-service.ts#L176-L213)
[`board-protocol-service.ts:386-444`](../../../src/main/board-protocol-service.ts#L386-L444)

The existing templates use relative files (`./board-base.css`, `./app.js`), and the board guide
explicitly requires local libraries to be loaded with relative paths. [`assets/board-template/index.html:1-50`](../../../assets/board-template/index.html#L1-L50)
[`assets/demo-board/index.html:1-11`](../../../assets/demo-board/index.html#L1-L11)
[`assets/board-template/CLAUDE.md:969-989`](../../../assets/board-template/CLAUDE.md#L969-L989)

| Question | Finding |
|---|---|
| Module script and relative ESM imports | **Allowed by the serving contract.** The scheme is a standard/secure fetch-capable origin, relative paths stay under the board root, and `.js` is `text/javascript`. [`main-setup.ts:62-69`](../../../src/main/main-setup.ts#L62-L69) [`board-protocol-service.ts:176-185`](../../../src/main/board-protocol-service.ts#L176-L185) |
| Dynamic `import()` | **Allowed for same-origin files.** Excalidraw's prebuilt entry contains relative locale imports, and its font code contains relative imports for the subset worker and shared chunk. [`dist/prod/index.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/index.js#L1) [`dist/prod/chunk-K2UTITRG.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js#L1) |
| Web Worker | **Allowed for a same-origin worker URL.** CSP declares `worker-src 'self'`; the shipped worker derives its URL from `import.meta.url` and imports sibling chunks relatively. [`board-protocol-service.ts:73-94`](../../../src/main/board-protocol-service.ts#L73-L94) [`subset-worker.chunk.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js#L1) |
| CSP | **No source-level blocker found.** HTML gets same-origin `script-src`, `style-src`, `font-src`, `connect-src`, and `worker-src`; inline bootstrapping is allowed by `'unsafe-inline'`, while CDN access is forbidden. [`board-protocol-service.ts:73-94`](../../../src/main/board-protocol-service.ts#L73-L94) |

The host window has `nodeIntegrationInSubFrames: false`, so the board must use browser ESM and not
Node. [`open-window.ts:49-58`](../../../src/main/open-window.ts#L49-L58) A development and packaged
smoke run must still inspect the board-frame console for module, dynamic-import, worker, and CSP
errors. No A-D item is blocked by the inspected source. If Electron exposes a custom-scheme worker
limitation at runtime, the fix belongs in the board scheme/serving path and must keep the worker
same-origin; it must not use `app-asset://` or a CDN.

### B — Font resolution

The current React island sets `window.EXCALIDRAW_ASSET_PATH` to `app-asset://excalidraw/` before
mounting. [`ExcalidrawIsland.tsx:31-44`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L31-L44)
The prebuilt vendor code reads that global, resolves font URIs against it, and otherwise has an
`esm.sh` fallback; its font constants are relative `./fonts/...` paths.
[`dist/prod/chunk-K2UTITRG.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js#L1)

The board must set the global before importing the copied vendor entry:

```html
<script type="module">
    window.EXCALIDRAW_ASSET_PATH = "./lib/";
    const { Excalidraw } = await import("./lib/index.js");
</script>
```

C5 is verified in `normalizeBaseUrl()`: a value beginning with `./` has that prefix removed and is
resolved with `new URL(..., window.location.origin)`, then normalized with a trailing slash. Thus
`"./lib/"` becomes `board://<host>/lib/`; it is origin-relative, not relative to the HTML file's
directory. An explicit `new URL("./lib/", location.href).href` would also be valid, but is not needed
for this board-root layout. [`dist/prod/chunk-K2UTITRG.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js#L1)

`index.css` is copied to `lib/index.css`, and its `url("./fonts/...")` references therefore resolve
to `lib/fonts/...`. [`dist/prod/index.css:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/index.css#L1)
The board must not use `app-asset://` or leave the global unset: the board CSP permits local fonts
but forbids remote connections. [`board-protocol-service.ts:80-85`](../../../src/main/board-protocol-service.ts#L80-L85)

### C — Generator, output, and D9 isolation

The lockfile resolves `@excalidraw/excalidraw` to `0.18.1`, whose package entry is
`dist/prod/index.js`. [`package-lock.json:1350-1353`](../../../package-lock.json#L1350-L1353)
[`node_modules/@excalidraw/excalidraw/package.json:1-20`](../../../node_modules/@excalidraw/excalidraw/package.json#L1-L20)
The epic records that this prebuilt bundle needs one bundler pass only for its bare externals and
CJS-only React. [`EPIC-109.md:228-241`](../../epics/EPIC-109.md#L228-L241)

Create `scripts/build-board-lib.mjs` with two phases. The first copies the entire
`@excalidraw/excalidraw/dist/prod/` graph verbatim into `assets/boards/excalidraw/lib/`, excluding
only `fonts/Xiaolai/` and the 54 non-English locale files. The measured result is approximately
3.4 MB across 36 files. This preserves every vendor-relative contract: the original chunk names,
`import.meta.url`, the dedicated separate worker module, the CSS-to-font relationship, and
`locales/en-B4ZKOASM.js`'s `../chunk-6U3AYISY.js` import.
[`dist/prod/index.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/index.js#L1)
[`dist/prod/subset-worker.chunk.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js#L1)
[`dist/prod/locales/en-B4ZKOASM.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/locales/en-B4ZKOASM.js#L1)

The second phase runs one esbuild pass only for the 15 bare externals listed by the epic, plus the
required `react-dom/client` subpath used by the smoke page. Emit one browser ESM file per dependency
under `assets/boards/excalidraw/lib/deps/`, with `bundle: true`, `format: "esm"`, and
`platform: "browser"`. Mark the full external-specifier set external while building each dependency
so the import map remains the single resolver for shared packages. Build React exactly once; build
`react-dom` and `react-dom/client` with `react` external. The package itself is never re-bundled.

The board `index.html` supplies the bare-specifier mapping:

```html
<script type="importmap">
{"imports": {
  "react": "./lib/deps/react.js",
  "react-dom": "./lib/deps/react-dom.js",
  "react-dom/client": "./lib/deps/react-dom-client.js",
  "react/jsx-runtime": "./lib/deps/jsx-runtime.js",
  "jotai": "./lib/deps/jotai.js",
  "jotai-scope": "./lib/deps/jotai-scope.js",
  "clsx": "./lib/deps/clsx.js",
  "nanoid": "./lib/deps/nanoid.js",
  "roughjs/bin/rough": "./lib/deps/rough.js",
  "@radix-ui/react-popover": "./lib/deps/radix-react-popover.js",
  "@radix-ui/react-tabs": "./lib/deps/radix-react-tabs.js",
  "fuzzy": "./lib/deps/fuzzy.js",
  "lodash.debounce": "./lib/deps/lodash-debounce.js",
  "lodash.throttle": "./lib/deps/lodash-throttle.js",
  "open-color": "./lib/deps/open-color.js",
  "tunnel-rat": "./lib/deps/tunnel-rat.js"
}}
</script>
```

The actual map must contain all 15 epic-listed names, with the exact `react-dom/client` key as a
sixteenth subpath mapping. This is safe under the board CSP because import maps are inline script
data and `script-src 'self' 'unsafe-inline'` is already the board policy.
[`board-protocol-service.ts:73-94`](../../../src/main/board-protocol-service.ts#L73-L94)
The smoke run must prove import-map support in the installed Electron 43 runtime by successfully
resolving `import("react")`, `import("react-dom/client")`, and the copied vendor `index.js`; the
installed runtime is Electron 43.0.0. [`node_modules/electron/package.json:27-30`](../../../node_modules/electron/package.json#L27-L30)

The output is:

```text
assets/boards/excalidraw/
├─ board-manifest.json
├─ index.html
└─ lib/
   ├─ index.js, chunk-*.js, data/, locales/en-*.js, subset-*.js  # verbatim vendor files
   ├─ index.css                                                    # verbatim
   ├─ fonts/                                                       # eight families; no Xiaolai/
   └─ deps/                                                        # esbuild output for externals
```

This layout guarantees one React URL rather than merely one bundle: Excalidraw's `react` imports,
the dependency bundles, and the smoke page all resolve `react` through the same import-map URL.
The existing renderer precedent confirms that `react-dom/client` is the required `createRoot()`
subpath. [`react-island.ts:1-23`](../../../src/renderer/editors/draw/react-island.ts#L1-L23)

The copied worker contract is intentionally not passed through esbuild. `chunk-K2UTITRG.js` performs
`import("./subset-worker.chunk.js")`, and the vendor worker exports `WorkerUrl` from its own
`import.meta.url`; the same code throws `WORKER_IN_THE_MAIN_CHUNK` if that URL equals the importing
module. [`dist/prod/chunk-K2UTITRG.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js#L1)
[`dist/prod/subset-worker.chunk.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js#L1)
Keeping `subset-worker.chunk.js`, `subset-shared.chunk.js`, and their self-relative dependencies at
their original URLs is what satisfies that contract; `splitting: true` is deliberately not used.

The copied `index.js` contains 55 literal locale specifiers, but its loader calls the locale map only
for the currently active language: `$s` requests `./locales/${bi.code}.json`, catches a missing file,
and falls back to the built-in English table. [`dist/prod/index.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/index.js#L1)
The 54 non-English specifiers therefore remain deliberately dangling references in the copied
vendor file; the default English path requests only `en-B4ZKOASM.js`. Switching the UI to an omitted
language may produce one active-locale 404 and English fallback, which is the explicit D9 limitation,
not an accidental CDN fallback. The smoke acceptance must verify no non-English locale is requested
on the default English path.

Add only this independent manual command:

```json
// Before: no board-lib script.
"build-prod": "node scripts/build-prod.mjs",

// After: opt-in only; dist does not call it.
"build-board-lib": "node scripts/build-board-lib.mjs",
"build-prod": "node scripts/build-prod.mjs",
```

`dist`, `dist:zip`, and `dist:publish` reach `build-prod` and electron-builder only.
[`package.json:7-17`](../../../package.json#L7-L17) `build-prod` has its own main/preload/shim/
search-worker/renderer build calls and no board-lib call. [`scripts/build-prod.mjs:16-189`](../../../scripts/build-prod.mjs#L16-L189)
The dev script likewise has only renderer/main/preload/shim/search-worker watch targets.
[`scripts/dev.mjs:19-29`](../../../scripts/dev.mjs#L19-L29) [`scripts/dev.mjs:264-275`](../../../scripts/dev.mjs#L264-L275)

### Packaging and ignore rules

`electron-builder.yml` copies the whole `assets` tree to `resources/assets` outside asar.
[`electron-builder.yml:8-18`](../../../electron-builder.yml#L8-L18)
`getAssetPath()` maps to that same location when packaged and to the repository `assets` folder in
development. [`src/main/utils.ts:16-36`](../../../src/main/utils.ts#L16-L36)
No packaging change is expected for D9's approximately 3.8 MB subtree; verify it in a packaged
no-network run.

The root ignore file excludes `.vite/`, a directory named `dist/`, and `lib-cov`, but not
`assets/boards/`, `lib/`, or `*.woff2`; the only nested ignore is unrelated tool-template data.
[`.gitignore:85-100`](../../../.gitignore#L85-L100) [`assets/tool-template/.gitignore:1-2`](../../../assets/tool-template/.gitignore#L1-L2)
Using `lib/` avoids the `dist/` rule. `git check-ignore` must confirm the generated files are
trackable; no ignore-file exception is planned.

### E — Smoke board and manifest shape

The manifest parser identifies a board by `schemaVersion` and supports descriptive metadata,
`standalone`, custom-editor fields, and capabilities. [`board-manifest.ts:11-27`](../../../src/renderer/editors/board/board-manifest.ts#L11-L27)
[`board-manifest.ts:58-107`](../../../src/renderer/editors/board/board-manifest.ts#L58-L107)
The template manifest demonstrates the minimal descriptive shape, while the demo manifest shows
optional editor/capability fields. [`assets/board-template/board-manifest.json:1-6`](../../../assets/board-template/board-manifest.json#L1-L6)
[`assets/demo-board/board-manifest.json:1-25`](../../../assets/demo-board/board-manifest.json#L1-L25)

Create `assets/boards/excalidraw/board-manifest.json` with `schemaVersion: 1`, a smoke-board name,
description, and author. Set `standalone: true`; do not add the real `.excalidraw` file mask,
`editorKind: "content-host"`, priority, or capability declarations. Those are US-1487's board
contract. [`EPIC-109.md:243-248`](../../epics/EPIC-109.md#L243-L248)

Create `assets/boards/excalidraw/index.html` with:

1. a link to `./lib/index.css`;
2. a full-size `#root` element;
3. the import map from section C;
4. `window.EXCALIDRAW_ASSET_PATH = "./lib/"` before the vendor import;
5. dynamic imports of `react`, `react-dom/client`, and `./lib/index.js`;
6. `createRoot()` rendering `React.createElement(Excalidraw, { viewModeEnabled: true })` with empty
   `initialData`; this is plain browser JavaScript and must not use JSX; and
7. no bridge calls, file persistence, capabilities, or real-board UI.

`viewModeEnabled`, `initialData`, and `UIOptions` are component-contract fields.
[`node_modules/.../types.d.ts:398-444`](../../../node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts#L398-L444)
The inline module is permitted by the board CSP, while imported code, CSS, fonts, locales, and
workers remain same-origin files. [`board-protocol-service.ts:73-94`](../../../src/main/board-protocol-service.ts#L73-L94)

### F — Version bump procedure

When Excalidraw changes, update `package.json` and `package-lock.json`, install, then run
`npm run build-board-lib` manually. Review the copied vendor tree and diff: the English locale's
relative chunk target exists, the worker remains a standalone module, the import map covers every
bare external and `react-dom/client`, only English locale and eight non-Xiaolai font families are
present, and the 54 non-English files remain absent. Re-check the asset-path join code and CSS font
URLs. Finally run the smoke board in a packaged, no-network app and inspect its board-frame console
for failed module, locale, font, worker, or CSP requests before committing `lib/`.

## Implementation Plan

### 1. Add the manual generator without entering the product build

- Create `scripts/build-board-lib.mjs`.
- Copy the complete `@excalidraw/excalidraw/dist/prod/` graph verbatim, filtering only
  `fonts/Xiaolai/` and the 54 non-English locale files. Do not ask esbuild to process the vendor
  entry, chunks, locale, data, or worker files.
- Run one esbuild browser-ESM pass for the 15 bare external entry points into `lib/deps/`; include
  `react-dom/client` for the smoke page, mark the other import-map names external, build React once,
  and keep `react` external in both `react-dom` outputs.
- Add the import map and plain JavaScript smoke bootstrap described above. The copied vendor graph,
  not an esbuild-generated Excalidraw entry, owns all relative chunk and worker paths.
- Make locale/font predicates explicit and fail on forbidden files or missing relative targets.
- Add only the independent `build-board-lib` command to `package.json`; do not modify any command
  reached by `npm run dist`.

### 2. Add the smoke board

- Create `assets/boards/excalidraw/board-manifest.json` using only the smoke manifest fields above.
- Create `assets/boards/excalidraw/index.html` using relative CSS and dynamic ESM imports, setting
  the asset path first and mounting an empty, read-only Excalidraw scene.
- Do not add the real association, content host, capabilities, persistence, or `aiVision` surface;
  those belong to US-1487.

### 3. Generate and inspect the committed tree

- Run `npm run build-board-lib` from the repository root.
- Verify `assets/boards/excalidraw/lib/` contains the verbatim vendor entry/chunks, `locales/en-*.js`,
  eight font-family directories only, and `deps/` outputs; no re-emitted Excalidraw graph exists.
- Verify the import map covers every bare vendor external and `react-dom/client`, the 54 non-English
  locale files are absent while their deliberate references remain in copied `index.js`, and
  `git check-ignore` reports no ignore rule for generated files.
- Confirm the measured subtree is in D9's approximately 3.8 MB range.

### 4. Verify serving, lazy loading, and packaging

- Open the smoke board through the bundled-board path in development and packaged/no-network apps.
- Inspect the board-frame console and requests: copied `lib/index.js`, original core/data/worker
  chunks, CSS, and local fonts must load from `board://<host>/lib/...`; the English locale must load
  from its exact relative path.
- Confirm the canvas renders read-only with no ESM, dynamic-import, font, worker, or CSP errors.
- Confirm `npm run dist` does not invoke the manual generator and that existing `extraResources`
  carries the committed subtree to `resources/assets/boards/excalidraw/`.

## Concerns (resolved design)

1. **`react-dom/client` and duplicate React.** The board needs `react-dom/client` for `createRoot`,
   matching the existing island. React is built once as `lib/deps/react.js`; both `react-dom` and
   `react-dom/client` leave `react` external, and every copied Excalidraw import resolves the same
   URL through the import map. This prevents the duplicate-React risk introduced by mixing copied
   vendor files with separately bundled React.
   [`react-island.ts:1-23`](../../../src/renderer/editors/draw/react-island.ts#L1-L23)

2. **C1/C3: copied locales and D9.** The package contains 55 literal locale specifiers, and the
   English file retains its `../chunk-6U3AYISY.js` path because the entire vendor graph is copied
   without re-bundling. The loader requests only the active language, so the 54 omitted files remain
   deliberate dangling references; an omitted-language switch can 404 once and fall back to English.
   That is the accepted D9 limitation, not a CDN fallback. [`EPIC-109.md:183-196`](../../epics/EPIC-109.md#L183-L196)

3. **C2: worker and custom-scheme behavior.** CSP and the package worker URL are same-origin, and
   the scheme is secure/fetch-capable. The worker remains a standalone copied module because the
   vendor throws `WORKER_IN_THE_MAIN_CHUNK` when a bundler inlines it; the smoke run is the required
   Electron runtime proof. [`main-setup.ts:62-69`](../../../src/main/main-setup.ts#L62-L69)
   [`board-protocol-service.ts:73-94`](../../../src/main/board-protocol-service.ts#L73-L94)
   [`dist/prod/chunk-K2UTITRG.js:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js#L1)

4. **CSS/font relationship.** CSS stays at `lib/index.css`, where `./fonts/...` resolves to
   `lib/fonts/...`; the runtime global is independently set to `./lib/`.
   [`dist/prod/index.css:1`](../../../node_modules/@excalidraw/excalidraw/dist/prod/index.css#L1)

5. **Smoke scope.** US-1486 proves only the vendored runtime. The real `.excalidraw` association,
   content host, capabilities, and editing behavior remain US-1487.
   [`EPIC-109.md:228-246`](../../epics/EPIC-109.md#L228-L246)

6. **Installer size/build reliability.** The product build copies `assets/`; it does not run esbuild,
   so a failed manual regeneration cannot make a normal Persephone build fail. The existing rule is
   sufficient for the approximately 3.8 MB subtree. [`electron-builder.yml:15-18`](../../../electron-builder.yml#L15-L18)
   [`EPIC-109.md:173-192`](../../epics/EPIC-109.md#L173-L192)

## Acceptance Criteria

- `scripts/build-board-lib.mjs` produces the committed layout under
  `assets/boards/excalidraw/lib/` with the vendor `dist/prod` graph copied verbatim, the specified
  filters, and separate esbuild ESM outputs under `lib/deps/`.
- The copied vendor entry retains its original relative chunk/locale/worker paths; the import map
  resolves all 15 bare externals plus `react-dom/client`, and React is one URL shared by Excalidraw
  and both React DOM outputs.
- `index.css` and all emitted fonts are board-local; CSS resolves from `lib/index.css` to
  `lib/fonts/...`, and the runtime asset path is set before Excalidraw import.
- Only eight non-Xiaolai font families and the English locale are committed; the generator enforces
  the exclusion.
- The smoke manifest is schema-valid and `index.html` imports the library, mounts
  `React.createElement(Excalidraw, { viewModeEnabled: true })` with empty `initialData`, and uses no
  JSX.
- Development and packaged/no-network runs render the smoke board with no failed ESM, dynamic
  import, font, worker, or CSP error.
- English locale, font-subsetting requests, and the standalone worker resolve from
  `board://<host>/lib/...`, not CDN or `app-asset://`; the 54 omitted locale references remain
  intentionally dangling and are not requested on the default English path.
- `npm run dist` and every script it reaches do not invoke `scripts/build-board-lib.mjs`; only the
  explicit manual `npm run build-board-lib` command does.
- Existing `electron-builder.yml` packages the approximately 3.8 MB subtree without a packaging or
  path-resolver change.
- `git check-ignore` confirms generated files are trackable; no ignore exception is added.
- US-1487 remains responsible for the real `.excalidraw` association and board behavior.

## Files that need no changes

- `src/main/board-protocol-service.ts`, `src/main/main-setup.ts`, `src/main/open-window.ts`,
  `BoardWebview.ts`, `BoardEditorView.ts`, `BoardEditorModel.ts`, and
  `custom-editor-registry.ts` — serving, CSP, subframe, discovery, and iframe paths already exist.
- `src/renderer/editors/draw/**` — its `app-asset://` assignment is precedent only; the board uses
  `./lib/`.
- `scripts/build-prod.mjs`, `scripts/dev.mjs`, `electron-builder.yml`, and `src/main/utils.ts` —
  D9 requires build isolation, and existing asset packaging/resolution is sufficient.
- `.gitignore` and `assets/tool-template/.gitignore` — neither excludes the planned output.
- `doc/active-work.md` and `doc/epics/EPIC-109.md` — required links and D1/D2/D9 are already present.
- `package-lock.json` — no generator dependency is added; esbuild is already a dev dependency.
- All real-board behavior (`fileMasks`, `editorKind`, priority, capabilities, persistence, facade,
  and `aiVision`) — US-1487 scope.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `scripts/build-board-lib.mjs` | New manual verbatim-copy plus deps-only esbuild generator with explicit filters | No |
| `package.json` | Add independent `build-board-lib` command | No |
| `assets/boards/excalidraw/board-manifest.json` | New smoke manifest | No |
| `assets/boards/excalidraw/index.html` | New read-only smoke page | No |
| `assets/boards/excalidraw/lib/**` | Committed verbatim vendor graph, deps outputs, CSS, English locale, and fonts | No |
| `doc/tasks/US-1486-board-prebuilt-lib/README.md` | Investigation, plan, concerns, and acceptance criteria | Yes |

---

## Implementation notes — deviations found while building

Four things in the reviewed plan did not survive contact with the package. All four were found by
running the generator, not by the build gates, which stayed green throughout.

### 1. The generator could not run as written (`spawn EPERM`, then a real failure)

The implementation session reported the script failing under its sandbox and hand-produced the
output with the esbuild CLI instead. Re-run outside the sandbox, the script failed for a genuine
reason: it resolved entry points with `createRequire().resolve()`, which picks the `require`
condition and hands esbuild a concrete file path. That defeats the package's `browser` condition —
`nanoid` resolved to `index.cjs` and failed on `crypto`, where its browser build reads
`crypto.getRandomValues` off the global.

Fixed by routing every entry through a virtual module whose `resolveDir` is the Excalidraw package,
so esbuild resolves each specifier exactly as the vendor graph would, nested dependencies included.

Because each virtual entry re-exports the specifier it is named after, esbuild's config-level
`external` list matched that self-import too and emitted 97-byte stubs instead of bundled packages.
Externality is therefore decided in the plugin, per importer.

### 2. The generated `deps/` shipped React's development build

No `process.env.NODE_ENV` define was set, so esbuild resolved it to `"development"`:

| File | Generated | dev build | prod build |
|---|---|---|---|
| `react.js` | 46,023 | **47,219** | 17,217 |
| `react-dom-client.js` | 1,006,364 | **1,065,698** | 536,016 |
| `jsx-runtime.js` | 13,494 | **12,452** | 976 |

Fixed with `define: { "process.env.NODE_ENV": '"production"' }` plus `minify: true`;
`react-dom-client.js` is now 177 KB. A guard asserts `deps/react.js` contains no `%s`, the format
specifier React uses only in development warnings — a string literal, so it survives minification
and catches a lost define that the emitted file list alone would not.

### 3. The specifier list was wrong — 15 listed, 33 required

The count of 15 came from grepping `index.js` alone. Thirteen more live in the chunks
(`@braintree/sanitize-url`, `@excalidraw/laser-pointer`, `browser-fs-access`, `es6-promise-pool`,
`fractional-indexing`, `pako`, `perfect-freehand`, `png-chunk-text`, `png-chunks-encode`,
`png-chunks-extract`, `points-on-curve`, `roughjs/bin/generator`, `roughjs/bin/math`), and four more
(`@excalidraw/mermaid-to-excalidraw`, `pica`, `image-blob-reduce`, `canvas-roundrect-polyfill`) are
reached only through lazy `import()`. Each would have failed at its first use — several of them only
once a user tried a specific feature, which is the worst way to find out.

The generator now derives the set by scanning the copied vendor files, and derives per-specifier
whether a `default` re-export is needed from the actual import form. The import map is generated
into `index.html` between `<!-- import-map:start -->` / `<!-- import-map:end -->` markers rather
than hand-maintained, so it cannot drift from what was emitted. US-1487 must keep those markers.

### 4. Size: 7.3 MB, not ~3.8 MB

Driven entirely by `@excalidraw/mermaid-to-excalidraw` at 3.4 MB. Kept deliberately — see the
amended D9 in EPIC-109. Excluding it returns the board to ~3.9 MB.

## Verification status

Gates run and passing: `npm run typecheck`, `npm run lint`, `npm run build-prod`.

Generator run from a clean state: 37 of 300 vendor files copied verbatim and byte-verified, 8 font
families, one English locale, 33 dependencies bundled, 33 import-map entries written.

D9 isolation confirmed statically: no reference to the generator in `scripts/build-prod.mjs`,
`scripts/dev.mjs`, `electron-builder.yml`, or any script `npm run dist` reaches.

### 5. The dependency modules had to stop being `export *` — found only by running the board

Live verification found the board opening, permitted as bundled (`renderState: "bundled"`,
`frameReady: true`), and mounting nothing: `rootChildren: 0`, `excalidrawNodes: 0`, `canvases: 0`.
Four probes in the board frame located it:

| import | result |
|---|---|
| `react` | resolved but exported ONLY `default` |
| `react/jsx-runtime` | resolved with ZERO exports |
| `react-dom/client` | `Dynamic require of "react" is not supported` |
| `./lib/index.js` | `does not provide an export named 'jsxs'` |

Two separate CommonJS interop failures. `export * from "<cjs module>"` cannot re-export CJS named
bindings, because ESM star-exports must be statically resolvable and React 19 here is CJS. And
marking `react` external inside the react-dom builds left react-dom's internal `require("react")` in
ESM output, which esbuild cannot execute.

The vendor graph needs both forms — `import D2,{useCallback as P2,useMemo as R2}from"react"` — so
named exports are not optional.

**The names cannot be discovered by executing the packages.** An attempt to do so failed on
`browser-fs-access`, which declares `"type": "module"` while its dist file is CommonJS
(`exports.default=`), so Node refuses it either way; it also required a `Path2D` global placeholder
to get other browser-only packages through inspection.

The set that actually has to exist is the set the consumer imports, and that is readable from the
copied vendor source without running anything. The generator now collects the named bindings per
specifier from the vendor graph's own `import{a as X}from"spec"` statements (taking the source name,
discarding the local alias), adds the two the board's own bootstrap needs (`react.createElement`,
`react-dom/client.createRoot`), and emits explicit re-exports. React is bundled rather than external
across the react family so `require("react")` resolves at build time into a shared chunk.

## Verification status

Gates: `npm run typecheck`, `npm run lint`, `npm run build-prod` all pass.

Generator, run from a clean state: 37 of 300 vendor files copied verbatim and byte-verified, 8 font
families, one English locale, 33 dependencies emitted with 33 import-map entries.

D9 isolation confirmed statically: no reference to the generator in `scripts/build-prod.mjs`,
`scripts/dev.mjs`, `electron-builder.yml`, or any script `npm run dist` reaches.

**Live, in the running app** — the board reloaded against the generated lib:

| Check | Result |
|---|---|
| Permission | opens with no trust dialog; `renderState: "bundled"` |
| Absent from Boards tab | `boards.list()` excludes it, per D2 |
| Excalidraw mounts | `rootChildren: 1`, `excalidrawNodes: 1`, `canvases: 2`, canvas 1498x945 |
| Single React instance | Excalidraw is hook-heavy; rendering at all rules out a duplicate |
| Named exports | `react.js` exports `useState`/`useMemo`/`useCallback`/`useEffect`/`createElement`/…; jsx-runtime exports `jsx`, `jsxs`, `Fragment` |
| Fonts | 234 font faces, all `loaded` |
| **Worker** | spawns from `board://<host>/lib/subset-worker.chunk.js`; no `WORKER_IN_THE_MAIN_CHUNK`, no CSP block |
| Local assets | subset-worker, en locale, `index.css`, an Excalifont woff2 — all HTTP 200 |
| Render | view-mode UI: hamburger menu, zoom controls, help button |

The worker result closes the risk that drove the verbatim-copy architecture: its contract is a
standalone module whose own `import.meta.url` becomes the Worker URL, and it is now proven rather
than argued.

## Known residue for US-1487

- One `Dynamic require of` remains in a shared chunk. It is esbuild's generic helper for a
  *computed* specifier (`"'+a+'"`) inside an image library, not a named package, and browser code
  does not take that path.
- `lib/deps/` holds 149 files: 33 entries plus 116 shared chunks from code splitting. Functional
  but noisier than needed; worth consolidating alongside the real board.
- A dev-only trap, fixed in `vite.renderer.config.ts`: regenerating `lib/` while `npm start` is
  running made chokidar fail with `EBUSY` on a file being replaced, and that error is emitted on the
  FSWatcher rather than swallowed — taking the dev server and Persephone down. `assets/boards/*/lib/**`
  is now ignored by the watcher, alongside the Cargo trees that hit the identical failure.
