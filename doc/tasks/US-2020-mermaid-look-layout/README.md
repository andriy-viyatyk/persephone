# US-2020: Mermaid view look and layout switches

## Goal

Let users quickly compare Mermaid 12 looks and layouts in the Mermaid view, with immediate rerendering and per-page persistence. This task follows [EPIC-179](../../epics/EPIC-179.md) and [US-2012](../US-2012-mermaid-12/README.md).

## Background

- `src/renderer/editors/mermaid/MermaidEditorView.ts` builds the right toolbar through `mermaidItems()` and `ImageActionsToolbarView`: theme is an `IconButtonView`; draw, save and copy use shared image actions. The latter view already supports `kind: "menu"` entries through UIKit `openMenu`, with focus restoration and updated menu state. The diagram background is chosen by `renderMermaid`: white in light mode, transparent in dark mode; it is not a separate toolbar setting.
- `MermaidEditor.ts` owns `lightMode` and rendering. `adoptHost()` uses `TextHostEditorModel.mirrorHostSettings()` to persist the `mermaid-view` slot in `TextFileModel`'s `editorSettings` per page, across editor switches and restart; this is not an app setting. A fresh page follows the app theme until an explicit theme toggle writes `lightMode`. Content and theme changes currently use a 400 ms debounce. `renderForAction()` can render on demand and otherwise reuses `svgUrl`.
- `render-mermaid.ts` exposes `renderMermaidSvg(content, lightMode)` and `renderMermaid(content, lightMode)`. It dynamically imports Mermaid and calls global `initialize` with theme, strict security, `look: "classic"` and `layout: "dagre"`, then calls `mermaid.render`. Markdown's `src/renderer/editors/markdown/CodeBlock.ts` and log output's `src/renderer/editors/log-view/items/MermaidOutputView.ts` also call it. Recommend their existing classic/dagre defaults remain independent of a Mermaid page's choice.
- Installed `node_modules/mermaid/package.json` is 12.3.0 and maps the root import to `dist/mermaid.core.mjs`. Its `dist/chunks/mermaid.core/chunk-CFHHFPVC.mjs` calls `registerDefaultLayoutLoaders()` at module load and registers `elk`, lazily importing `elk-XV6XMXQE.mjs`, as well as dagre. No `registerLayoutLoaders` call or `@mermaid-js/layout-elk` dependency is needed. Layout and look support varies by diagram type; choices are requests, not guarantees of visible differences.
- Mermaid's installed `mermaid.core.mjs` preprocesses front matter and `%%{init}%%` directives as diagram configuration; `chunk-BG4553SI.mjs` applies those layers before initialized site settings when resolving appearance. Keep this precedence: explicit diagram configuration wins over the toolbar defaults. If both occur, Mermaid merges them; let Mermaid determine their precedence. The control shows the page choice, which may differ from the effective diagram configuration.
- Mermaid's public `render` queues renders, but `initialize` happens outside that queue and mutates global site config. Concurrent pages/surfaces can therefore overwrite each other's settings before a queued render starts. Serialize each initialize **and awaited render** together in the shared renderer, not just the render call.
- `svgToDataUrl` parses HTML, serializes XML, fixes dimensions and, when requested, applies contrast based on explicit hex fills in `g.node` and `g.cluster`. In installed `node_modules/mermaid/dist/chunks/mermaid.core/chunk-AXFCVDMN.mjs`, `getNodeClasses` uses `rough-node` for handDrawn and `node` for classic and neo; `drawRect` puts a RoughJS group under that node for handDrawn, while classic/neo use a styled `rect`. `chunk-X4PVCEUW.mjs`'s `userNodeOverrides` passes the custom fill (or theme `mainBkg`) to RoughJS and defaults to hachure. `node_modules/roughjs/bin/svg.js` puts solid fill on a `fillPath`'s `fill`, but puts hachure fill color on a `fillSketch` path's `stroke` with `fill="none"`; the outline is a separate path. The current `g.node` selector misses handDrawn. Neo uses the classic node class and rectangle structure, so no neo-specific change is indicated by this source; Claude checks both looks at runtime.
- `src/renderer/scripting/api-wrapper/MermaidEditorFacade.ts` lists toolbar controls in `MERMAID_ELEMENTS` and its help. `doc/architecture/ui-element-contract.md` treats names as element kinds scoped to the page; transient menus are accessed through menus. `assets/guides/editors/mermaid.md` lists the toolbar and elements and will need a `/userdoc` update at epic review, not in this planning task.

## Implementation Plan

- [x] **Page settings and render lifecycle — owner `src/renderer/editors/mermaid/MermaidEditor.ts`.** Add bounded `MermaidLook = "classic" | "neo" | "handDrawn"` and `MermaidLayout = "dagre" | "elk"` types in an editor-local options module shared with the renderer, defaults classic/dagre, and optional fields in `MermaidViewSettings`. Restore validated values, falling back independently for missing/invalid saved values. Reuse `mirrorHostSettings` and `TextFileModel`'s existing slot; merge the fields without losing other slot data. Preserve the absence of `lightMode` when only look/layout is changed, so an untouched theme still follows app theme; explicitly toggling theme persists it. Ensure theme updates do not overwrite other choices. Do not store derived SVG/loading/error in the slot.

  ```typescript
  // Before: mirrorHostSettings snapshot and selector
  (s) => ({ lightMode: s.lightMode }), (s) => s.lightMode
  // After: persist explicit theme only, plus validated look and layout;
  // select all relevant fields and preserve the existing slot's other fields.
  // Defaults for an absent slot: look = "classic", layout = "dagre".
  ```

  Add setters that update state and start a render immediately (no 400 ms timer for toolbar changes); retain debounce for source typing. Clear pending timers and invalidate old in-flight results when content, theme, look or layout changes, on host replacement and dispose. Only the latest request may update SVG/error/loading. Clear stale SVG or otherwise prevent export/draw/copy from using an earlier selection while rendering; `renderForAction()` must render the current content and options on demand. Use existing state subscriptions and lifecycle cleanup.
- [x] **Shared rendering — owner `src/renderer/editors/mermaid/render-mermaid.ts`.** Reuse `renderMermaidSvg`, `renderMermaid`, and `svgToDataUrl`; add an optional typed options argument to both render functions, defaulting each field to classic/dagre. Pass the selected options from both editor preview and `renderForAction`. Enclose dynamic import, `initialize` and the awaited public `mermaid.render` in a module-local promise queue that recovers after rejection; all existing callers go through it. Keep unique IDs, theme, strict security, background and native front-matter/directive handling. No per-page choice leaks to Markdown or log output, even under concurrent renders.

  ```typescript
  // Before
  renderMermaid(content, lightMode);
  mermaid.initialize({ /* theme and security */ look: "classic", layout: "dagre" });
  // After (inside the shared serialized initialize + render operation)
  renderMermaid(content, lightMode, { look, layout });
  mermaid.initialize({ /* same theme and security */ look, layout });
  ```

- [x] **Contrast — owner `src/renderer/editors/mermaid/render-mermaid.ts`.** Extend `fixTextContrast` to cover `g.rough-node` and the nested RoughJS group described above. Find an explicit hex custom fill from the group's style or solid fill path using `getFillColor`, or its hachure fillSketch path's stroke when identifiable; do not mistake an outline's stroke or `fill="none"` for a filled background. Reuse `parseHexColor`, `relativeLuminance` and `applyTextColor`, skip absent or ambiguous colors, and retain existing classic and cluster behavior. Restrict the change to the installed source's hand-drawn structure; make no neo-specific code change. The implementer cannot run the app; Claude checks classic, neo and handDrawn at runtime and reports defects.
- [x] **Controls — owner `src/renderer/editors/mermaid/MermaidEditorView.ts`.** Add two keyboard-operable `ImageActionsToolbarView` `kind: "menu"` entries. Use registered `edit` (Look) and `graph-group` (Layout) icons from `src/renderer/theme/icons.ts`, registered in `src/renderer/theme/icon-registry.ts`. Set localized trigger tooltip and accessible label to include the current value, for example `Look: Neo` and `Layout: ELK`. Provide classic / neo / handDrawn and dagre / elk choices, setting each `MenuItem.selected` to whether it matches the state; `src/renderer/uikit/Menu/MenuView.ts` displays the selected check. Use `mermaid-look` and `mermaid-layout` as trigger `data-name`s, `mermaid-look-menu` and `mermaid-layout-menu` for menus, with stable distinct item IDs. Selection calls model setters immediately. Reuse existing lifecycle and focus handling.

  `ImageActionsToolbarView.onUpdate()` already updates each `IconButtonView` with fresh `title`, and `IconButtonView.onUpdate()` updates its tooltip; no tooltip-update change is needed. The menu branch's `buttonProps()` does not pass an accessible name, so minimally add `"aria-label": item.title` there in `src/renderer/editors/shared/ImageActionsToolbarView.ts`. This file is not listed among the roadmap §2.3 god files. Reuse its existing menu and button update paths.

  ```typescript
  // Before
  { kind: "control", key: "theme", props: themeButtonProps },
  // After: adjacent Look and Layout menus before image actions
  { kind: "control", key: "theme", props: themeButtonProps },
  { kind: "menu", buttonName: "mermaid-look", icon: "edit", /* localized title and entries */ },
  { kind: "menu", buttonName: "mermaid-layout", icon: "graph-group", /* localized title and entries */ },
  ```

- [x] **Labels and scripting inventory.** Add catalog messages for both controls, their accessible names, choices and any new user-visible text in `src/shared/i18n/en/editors.ts`; use `t()` throughout. In `src/renderer/scripting/api-wrapper/MermaidEditorFacade.ts`, add the two triggers to `MERMAID_ELEMENTS` and `MERMAID_EDITOR_HELP` with correct placement, and update the render timing description. Menus remain transient; do not introduce facade methods or a public script API unless separately requested. At epic completion translate new catalog messages into all language packs and run `npm run i18n:check`.
- [x] **Verification.** The implementer runs `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Claude performs the runtime smoke check below. At epic review, `/userdoc` updates `assets/guides/editors/mermaid.md`: toolbar diagram, elements inventory, choices/defaults, persistence, immediate updates, diagram overrides and diagram-type limits; run `npm run guides:check` if the guide changes.

## Implementation findings

- The existing `mirrorHostSettings` writer replaces the complete slot value. The snapshot therefore spreads the current slot before updating look/layout and only writes `lightMode` after an explicit theme toggle. Effective theme mode remains state-only while it follows the app theme.
- Mermaid rendering now serializes dynamic import, `initialize`, and awaited `render` together in a rejection-recovering module queue. Markdown and log callers retain default classic/dagre options.
- Render generations and timer cancellation prevent stale preview results from applying. Toolbar changes render immediately, source edits remain debounced, and pending SVG data is cleared so image actions cannot reuse an earlier choice.
- Mermaid 12's RoughJS paths do not carry a `fillSketch` class. Contrast handling uses group/solid fills first; the hachure stroke is considered only when multiple paths identify a distinct first fill stroke and last outline. Ambiguous shapes are skipped.
- The `ImageActionsToolbarView` menu trigger now forwards its localized title as `aria-label`. New English catalog messages remain untranslated until epic close, as planned. Runtime smoke check is intentionally left to Claude per the task instruction.

### Implementer verification results

- npm run typecheck — passed (strictNullChecks: 18 folders, 0 errors).
- npm run lint — passed.
- npm run build-prod — passed; production build completed with Vite config and chunk-size warnings, and no spawn EPERM.

## Smoke check (Claude, after implementation)

- [ ] Flowchart: flip all looks and both layouts; each re-renders immediately and tooltips show the current value.
- [ ] Dark theme with custom node fills in classic / neo / handDrawn: labels are readable.
- [ ] Non-default choices survive restart on that page while a new Mermaid page starts classic + dagre, and the theme still follows the app theme until toggled.
- [ ] A Markdown Mermaid block still renders classic + dagre while a Mermaid page uses neo + elk.

## Concerns

- A diagram's own config may make a toolbar change appear ineffective; document that the toolbar displays the requested page defaults. Some diagram types ignore a look or layout.
- Hand-drawn hachure is a stroked pattern over the background, so its color does not necessarily represent a solid fill. Skip ambiguous structures; Claude verifies readability and reports defects. Neo uses the classic node class and rectangle structure in the installed source.
- Global Mermaid configuration requires serialization across all surfaces, including rejection handling; queued stale requests must not replace a newer preview or its export.

## Acceptance Criteria

- [ ] The Mermaid view exposes both accessible, localized controls, shows the choices, and immediately renders the latest selection; classic/dagre remain defaults.
- [ ] Choices persist per page across editor switches and restart; theme behavior and other host settings remain intact. Markdown and log retain classic/dagre defaults, independent of page choices.
- [ ] Diagram front matter and init directives retain Mermaid's precedence; supported ELK renders without an extra package or registration.
- [ ] Custom-fill contrast, SVG dimensions and exports are correct for verified structures; rapid changes, failures, and mixed concurrent surfaces do not show stale or cross-contaminated output.
- [ ] Toolbar names and facade inventory match, typecheck, lint and production build pass, and the guide update is queued for `/userdoc` at epic review.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/mermaid/MermaidEditor.ts` | Per-page settings, immediate rendering, stale-result protection and export options |
| `src/renderer/editors/mermaid/mermaid-options.ts` | Shared bounded options and defaults |
| `src/renderer/editors/mermaid/MermaidEditorView.ts` | Localized named controls using existing toolbar/UIKit patterns |
| `src/renderer/editors/shared/ImageActionsToolbarView.ts` | Pass menu title as trigger accessible label |
| `src/renderer/editors/mermaid/render-mermaid.ts` | Options, serialized initialization/render and verified contrast correction |
| `src/shared/i18n/en/editors.ts` | New labels and accessible text |
| `src/renderer/scripting/api-wrapper/MermaidEditorFacade.ts` | Elements inventory and help |
| `assets/guides/editors/mermaid.md` | Deferred `/userdoc` update at epic review |
| `doc/active-work.md`, `doc/epics/EPIC-179.md` | Link this task |

No planned changes: `package.json` / lockfile, `src/renderer/editors/markdown/CodeBlock.ts`, `src/renderer/editors/log-view/items/MermaidOutputView.ts`, script API type declarations, or app settings. No guide changes during task planning.
