# US-2012: Mermaid 12 and Mermaid-to-Excalidraw 3

## Goal

Upgrade Mermaid and assess the converter and board rebuild for [EPIC-179](../../epics/EPIC-179.md), preserving existing rendering surfaces.

## Background

Investigation on 2026-11-15 identified Mermaid 12.3.0 from cached metadata and converter 3.6.0 from npm. An isolated offline install with a writable copy of the npm cache failed: `@excalidraw/markdown-to-text` and `chevrotain` metadata and the Mermaid 12.3.0 tarball were absent. An online pack attempt failed under restricted network access. Repository packages and manifests remain untouched. The following uses upstream sources and the installed 11.x/2.x graph; published declarations and a real 12.x/3.x dependency tree still need inspection before implementation.

- The [Mermaid 12.3.0 changelog](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.3.0/packages/mermaid/CHANGELOG.md) requires ES2024 and Node >=22.12. Electron 44 supplies Node 24. ELK is bundled and becomes the default layout for flowchart, state, class, ER, requirement, use-case and agentflow. Set `layout: "dagre"` to retain the previous layout. `neo` is the new look and `redux-color` the default theme for several diagram types. The application explicitly chooses its theme; set `look: "classic"` as well. Front matter can override configuration and default node sizing changed, so identical SVG is not guaranteed.
- The internal legacy `flowchart`, `class`, and `state` diagram IDs and section `defaultRenderer` config keys were removed; syntax uses unified renderers, `flowchart-elk` still works, and `layout` replaces `defaultRenderer`. Existing diagrams setting that removed key may silently change. Removed internal layout exports are not called here. New types include `agentflow-beta` and UML use case.
- The [12.3.0 package manifest](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.3.0/packages/mermaid/package.json) specifies ESM, root import/default `dist/mermaid.core.mjs`, types `dist/mermaid.d.ts`, and no CJS condition. [Source](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.3.0/packages/mermaid/src/mermaid.ts) retains the default object, `initialize(config)`, and queued `render(id, text, container?)` returning a promise. Confirm these in the published declarations, including `securityLevel: "strict"`, theme, and icon pack and layout loader APIs. This app registers no icon packs or layout loaders; full Mermaid 12 automatically registers ELK.
- `src/renderer/editors/mermaid/render-mermaid.ts` dynamically imports the default, initializes with `startOnLoad: false`, `theme: lightMode ? "default" : "dark"` and strict security, then awaits `render(id, content)`. `svgToDataUrl` parses HTML and serializes XML, derives dimensions from `viewBox`, optionally inserts a background, and fixes contrast using `g.node`, `g.cluster`, shape fills and foreignObject labels. `MermaidEditor.ts` uses this for preview and export; SVG structural changes require runtime checks.
- `src/renderer/editors/markdown/CodeBlock.ts` uses the same renderer and data URL conversion, always requesting contrast correction. `MarkdownBlockView.ts` normalizes `::: mermaid` containers and rerenders on theme change. `src/renderer/editors/log-view/items/MermaidOutputView.ts` uses the shared renderer and opens via `content.view`; `src/renderer/scripting/api-wrapper/LogEntryHandle.ts` and `src/shared/platform-capabilities.ts` preserve the `mermaid` representation. The Monaco tokenizer is independent highlighting. `vite.renderer.config.ts` has general `optimizeDeps.entries`, no Mermaid exception; scripts and ESLint have no direct Mermaid configuration.
- Excalidraw 0.18.1 declares converter **exactly 2.2.2**. Its `dist/prod/index.js` dynamically imports the converter namespace, calls `parseMermaidToExcalidraw(text)`, retries with quote substitution, destructures `{ elements, files = {} }`, and passes the skeletons to its own `convertToExcalidrawElements(..., { regenerateIds: true })`. `scripts/build-board-lib.mjs` copies the graph and gives virtual dependency entries an Excalidraw-package `resolveDir`, so nested dependencies resolve first. The current lock hoists converter 2.2.2. A root 3.x bump should cause npm to nest the exact 2.2.2 dependency, so the board's `assets/boards/excalidraw/lib/deps/excalidraw-mermaid-to-excalidraw.js` would still bundle 2.2.2. Confirm with an actual isolated install and esbuild resolution. A root bump alone is therefore not useful; do not force an untested override.
- [Converter 3.6.0 documentation](https://www.npmjs.com/package/%40excalidraw/mermaid-to-excalidraw) says v3 uses Pele rather than Mermaid, removes `engine` and `startOnLoad`, retains the parse function and can reject previously supported syntax. Its listed runtime dependencies are Pele, nanoid and markdown-to-text, not Mermaid. Inspect its published manifest, peer range and declarations and test skeleton compatibility with Excalidraw 0.18.1. Recommend retaining direct 2.2.2 until Excalidraw changes its exact pin or a deliberate override is validated; Mermaid 11 may remain nested for converter 2.2.2.
- Upstream reports ELK is a separate lazy ESM chunk, and its single-file IIFE grows about 500 kB gzipped. That is not a measurement of this Vite build. The root package import avoids the specific minified ESM entry upstream says can fail Vite's lexer. Compare actual production output after package access is restored.

## Implementation Plan

- [x] **Package investigation (done by Claude, 2026-11-15, isolated install with registry access).** Results:
  - `npm ls` in a probe with `mermaid@12`, `@excalidraw/excalidraw@0.18.1` and `@excalidraw/mermaid-to-excalidraw@3` resolves to `mermaid@12.3.0` and converter `3.6.0` at the root. Excalidraw nests its own `@excalidraw/mermaid-to-excalidraw@2.2.2`, which nests its own `mermaid@11.17.2`.
  - Mermaid 12.3.0 is `"type": "module"`, with `module: ./dist/mermaid.core.mjs` and `types: ./dist/mermaid.d.ts`.
  - `config.type.d.ts` declares `look?: 'classic' | 'handDrawn' | 'neo'`, `layout?: string` and `securityLevel?: 'strict' | …`.
  - The `dagre` layout loader is still registered in the core build (`dist/chunks/mermaid.core/chunk-*.mjs`, `name: "dagre"`).
  - **Converter decision: remove the root `@excalidraw/mermaid-to-excalidraw` devDependency; do not bump it.** Nothing in `src/` or `scripts/` imports it, and the board bundle always comes from Excalidraw's exact 2.2.2 pin, resolved from the Excalidraw package directory by `scripts/build-board-lib.mjs`. A 3.x root entry would be dead weight, and the current 2.x entry only duplicates what Excalidraw already installs. Converter 3 arrives when a future Excalidraw release changes its pin.
- [ ] From the repository root:

  ```powershell
  npm uninstall --ignore-scripts @excalidraw/mermaid-to-excalidraw
  npm install --ignore-scripts --save mermaid@12.3.0
  npx patch-package --error-on-fail
  npm ls mermaid @excalidraw/mermaid-to-excalidraw --all
  ```

  Confirm `package.json` changes `"mermaid": "^11.17.2"` → `"mermaid": "^12.3.0"` and has no `@excalidraw/mermaid-to-excalidraw` entry. `npm ls` must show `@excalidraw/excalidraw` → converter `2.2.2` → `mermaid@11.x`, plus root `mermaid@12.3.0`. A nested Mermaid 11 under the converter is expected and correct.
- [ ] In `src/renderer/editors/mermaid/render-mermaid.ts`, keep dynamic import, strict security and theme while preserving the old look and layout:

  ```typescript
  // Before
  mermaid.initialize({
      startOnLoad: false,
      theme: lightMode ? "default" : "dark",
      securityLevel: "strict",
  });
  // After
  mermaid.initialize({
      startOnLoad: false,
      theme: lightMode ? "default" : "dark",
      look: "classic",
      layout: "dagre",
      securityLevel: "strict",
  });
  ```

  Retain `await mermaid.render(id, content)` and `svgToDataUrl` unless verification establishes a regression. Check custom fill contrast, dimensions and serialization.
- [ ] **Claude: rebuild board library**, in an environment allowing esbuild child processes:

  ```powershell
  npm run build-board-lib
  ```

  The script removes `assets/boards/excalidraw/lib` before building; do not run it in the known `spawn EPERM` sandbox. Inspect regenerated `lib/deps/`, import map in `assets/boards/excalidraw/index.html`, resolved converter and Mermaid copies, and diff. Record results.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build-prod`; record results. Compare Mermaid and ELK chunk names and compressed sizes against an 11.x baseline, and verify cold dev startup and lazy loading. Claude runs affected builds if esbuild spawn is blocked.
- [ ] No expected changes in `src/renderer/editors/markdown/CodeBlock.ts`, `MarkdownBlockView.ts`, `src/renderer/editors/log-view/items/MermaidOutputView.ts`, `src/renderer/scripting/api-wrapper/LogEntryHandle.ts`, `src/shared/platform-capabilities.ts`, `src/renderer/api/setup/monaco-languages/mermaid.ts`, `vite.renderer.config.ts`, `eslint.config.mjs`, or `scripts/build-board-lib.mjs`, unless testing reveals a regression.

## Implementation result (Claude, 2026-11-15)

Claude implemented this task directly because the Codex sandbox could not install Mermaid 12 offline.

- **Packages:** `npm ls` shows root `mermaid@12.3.0` and `@excalidraw/excalidraw@0.18.1` → converter `2.2.2` → `mermaid@11.17.2`. The root converter entry was removed.
- **`render-mermaid.ts`:** sets `look: "classic"` and `layout: "dagre"`.
- **Checks:** typecheck passes (18 strict folders, 0 errors) and lint passes.
- **`build-board-lib`:** 33 dependencies bundled. 98 shared chunks were renamed (their hashes changed with the nested Mermaid path) and one file changed. Library size: HEAD 7,777,776 bytes → 7,777,628 bytes.
- **Cold-start render:** `renderMermaidSvg` produced SVG for a flowchart, a sequence diagram and a state diagram.
- The full smoke list below continues under US-2020, the look/layout toolbar switches, which exercises the Mermaid view directly.

## Smoke check (Claude, after implementation)

Cold-start with `npm start`:

- [ ] Mermaid editor: flowchart, sequence and `agentflow-beta`; inspect labels and image export.
- [ ] Toggle dark/light; inspect contrast with custom node and subgraph fills.
- [ ] Markdown Mermaid block, theme update and open-in-editor action.
- [ ] Log-view Mermaid output and open-in-editor action.
- [ ] Excalidraw board Mermaid conversion produces editable shapes.

## Concerns

Package resolution and declarations were verified by Claude (plan step 1). If the implementer's offline cache lacks Mermaid 12.3.0 or its dependencies, stop and report; do not substitute versions. A root converter bump does not change Excalidraw's exact nested pin, which is why the root entry is removed. Global `initialize` is shared across concurrent callers; exercise mixed surfaces and theme switching. Mermaid 12 may change SVG structure and geometry even with compatibility settings.

## Acceptance Criteria

- [ ] Published declarations and dependency resolution verified; converter decision recorded.
- [ ] Mermaid 12 installed and locked; converter and nested Mermaid copies explained.
- [ ] Claude rebuilds and verifies board library and conversion.
- [ ] Typecheck, lint, production build, chunk comparison and smoke checks pass and are recorded.
- [ ] Capability contracts and unrelated dependencies remain intact.

## Files Changed

| File | Planned change |
|---|---|
| `package.json`, `package-lock.json` | Upgrade Mermaid to 12.3.0; remove the redundant root `@excalidraw/mermaid-to-excalidraw` entry |
| `src/renderer/editors/mermaid/render-mermaid.ts` | Explicit classic look and dagre layout |
| `assets/boards/excalidraw/lib/`, `assets/boards/excalidraw/index.html` | Claude regenerates vendor files and import map |
| `doc/tasks/US-2012-mermaid-12/README.md` | Record investigation and validation |
