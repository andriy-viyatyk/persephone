# EPIC-123: Custom themes — derived from three colors, edited in a Theme Editor board

## Status

**Status:** Completed
**Created:** 2026-10-09
**Completed:** 2026-10-09

## Overview

Persephone ships eleven fixed themes. This epic lets a user make their own: pick a background, a
text color and an accent, let Persephone calculate the remaining ~77 theme colors from them, adjust
any calculated color individually, and save the result under a name. A saved theme is a first-class
theme — it appears on the Settings page, in the theme swatch and in Ctrl+Alt+[ / ] cycling, exactly
like a built-in one.

The work is split the same way the rest of the app is: **Persephone owns the capability** (the color
derivation, the saved-theme storage, a scripting API and a narrow board permission), and **the
editing UI is a board** — a Theme Editor in the `persephone-boards` catalog that a user installs
only when they want to edit themes. Because the capability is in the app, an agent can also create
a theme without the board ("make me a warm sepia theme") through MCP or a script.

## Goals

- A user can create, edit, rename, delete, export and import named custom themes.
- Three base colors produce a complete, coherent theme; every derived color can still be overridden.
- Custom themes behave like built-in ones everywhere a theme is chosen or applied — including the
  first paint at startup (no flash of another theme's background).
- Themes keep working as the app grows: a theme saved today gets sensible values for color
  variables added in later releases.
- Boards get theme access through one narrow permission, not through `appScripting`.

## Decisions

- **2026-10-09 (user): the editor is a separate board in `persephone-boards`,** installed on demand.
  Its UI borrows from the user's color-palette sample board
  (`C:\data\js-notepad-notes\temp\format-test\color-palette-board` — harmonies, shade ramps, WCAG
  contrast checks).
- **2026-10-09 (user): three main colors** — default background, default text, accent — with every
  other color calculated, all calculated colors shown, and each adjustable individually.
- **2026-10-09 (user): edited themes are saved under a name** and selectable on the Settings page.
- **Store base colors and overrides, never the full palette.** A saved theme file is:
  ```json
  {
    "schemaVersion": 1,
    "id": "custom-my-dark",
    "name": "My Dark",
    "base": { "background": "#1b2935", "text": "#dfe6e9", "accent": "#2ecc71" },
    "isDark": null,
    "overrides": { "--color-misc-link": "#5dade2" }
  }
  ```
  The full `ThemeDefinition` is computed on load. Storing all 77 values would freeze the theme at
  today's variable list — a variable added next release would be missing from every saved theme.
  Storing intent means it is derived, like every other color the user did not touch.
- **The derivation lives in Persephone, not in the board.** One function,
  `deriveTheme(base, isDark?) → ThemeDefinition`, is the single source of truth: the app uses it to
  load saved themes, the board uses it (through the bridge) to show calculated colors, and agents use
  it through `app.themes`. A board-side copy would drift the first time a variable is added.
- **Optional extra base colors.** `base` may also carry `link`, `error`, `warning` and `success`.
  Status colors derived from the accent come out wrong (a green accent cannot produce a red error),
  so these default to fixed, readable hues adjusted for the background's lightness, and are
  user-settable without being "overrides".
- **Dark/light is inferred, overridable.** `isDark: null` means "decide from the background's
  relative luminance"; `true`/`false` forces it. It still matters internally — it selects the Monaco
  base theme (`vs-dark`/`vs`, hence syntax colors), the CSS `color-scheme` and Chromium's native theme
  (`api.setNativeTheme`), and which Settings column the theme is listed in.
- **Built-in themes are read-only.** Editing one and pressing Save becomes Save As. A built-in can be
  used as a starting point: its base is read from `--color-bg-default`, `--color-text-default` and
  `--color-misc-blue` (the app-wide accent — see US-1634), and every color that differs from
  `deriveTheme(base)` becomes an override, so the fork starts pixel-identical.
- **Custom theme ids are generated once at creation and prefixed `custom-`** (slug of the initial
  name, de-duplicated), so a custom theme can never shadow a built-in id, today's or a future one.
  The id is stable identity: renaming a saved theme changes its name, not its id or filename.
- **Preview is not persistence.** `preview()` applies a definition to the app without touching
  `appSettings.json` or any theme file; closing the editor without saving restores the theme in use.
- **Monaco syntax token colors are out of scope.** A custom theme sets Monaco's base and the handful
  of `monaco.colors` the built-ins set (`editor.background`, `menu.*`); token colors stay with the
  base theme. Editing syntax highlighting is a separate, much larger feature.
- **New board permission flag `themes`** (boolean, off by default) gates the `persephone.themes.*`
  bridge methods. `appScripting` would also work, but granting a theme editor the whole app object
  model is far too broad. US-1639 bumps `BOARD_BRIDGE_VERSION` to the unreleased `1.35.0`
  (`src/shared/board-bridge-version.ts`); later EPIC-123 board APIs, including US-1641, ship under
  `1.35.0` without another bump.

## Current state (verified 2026-10-09)

- `ThemeDefinition` (`src/renderer/theme/themes/types.ts`) is `{ id, name, isDark, colors, monaco }`;
  the built-ins each define 77 `--color-*` keys (`persephone.ts`). Themes are a static array in
  `src/renderer/theme/themes/index.ts`, which exposes `getAvailableThemes`, `getThemeById`,
  `applyTheme`, `resolveColor` and `cycleTheme`.
- `readStartupThemeId()` (same file) reads `appSettings.json` synchronously before first paint and
  falls back to `persephone` when the stored id is not a known theme.
- `index.html`'s inline pre-paint script holds a hardcoded id → background map for the built-ins and
  writes `#startup-background`. Its CSP hash is recomputed by `inlineScriptHashesPlugin`
  (`vite.renderer.config.ts`), so editing the script is safe.
- `settings.ts` applies the theme on every settings load (`applyTheme(newSettings["theme"])`, ~line
  348); the `theme` setting description lists the eleven ids. `ThemeSection.ts` splits
  `getAvailableThemes()` into dark and light grids. `cycle-app-theme.ts` cycles and persists.
- Monaco's theme is defined from the active `ThemeDefinition` in
  `src/renderer/api/setup/configure-monaco.ts`; boards get the palette pushed through
  `src/renderer/editors/board/board-theme.ts` → `board-shim.ts` (`onThemeChange`). About a dozen
  modules subscribe to `themeState`.
- Board permission flags are `BoardPermissionFlags` in `src/shared/board-manifest-utils.ts`; bridge
  handlers are registered in `BoardWebview.ts` and gated with `boardTrust.allows(...)` /
  `boardPermissionError(...)`. The scaffold manifest in `assets/board-template/` lists every flag.
- The script API surface is typed in `src/renderer/api/types/*.d.ts` (copied to
  `assets/editor-types/` by the build); `app.settings.theme` is the only theme entry today.

## Linked Tasks

Task documents are written per task (investigation delegated to Codex, reviewed by Claude) when the
task starts.

| Task | Title | Status |
|------|-------|--------|
| [US-1636](../tasks/US-1636-theme-derivation/README.md) | Theme derivation and the custom theme model | Done |
| [US-1637](../tasks/US-1637-custom-theme-storage/README.md) | Saved custom themes — storage, startup, Settings, cycling | Done |
| [US-1638](../tasks/US-1638-app-themes-api/README.md) | `app.themes` scripting / MCP API | Done |
| [US-1639](../tasks/US-1639-board-themes-bridge/README.md) | `themes` board permission and `persephone.themes` bridge | Done |
| US-1640 | Theme Editor board (`persephone-boards`, tracked there as BT-034: `doc/tasks/BT-034-theme-editor/README.md`) | Done |
| [US-1641](../tasks/US-1641-board-unsaved-changes/README.md) | Unsaved-changes protocol for plain board pages | Done |
| US-1642 | Board toolbar text buttons: a labelled `button`/`menu` renders the label inside the button, icon optional; a `menu` with `placement: "board-menu"` adds its items to the top of the … menu (`BoardToolbarControls.ts`, `BoardToolbar.ts`); lets the Theme Editor move its actions to the page toolbar | Done |
| US-1643 | Settings theme picker: tiles left-aligned, Persephone and Persephone Light lead their rows, Abyss / Red / Tomorrow Night Blue dropped; a hover × on custom tiles deletes the theme after confirmation (`themes/index.ts`, `ThemeSection.ts`, `index.html` startup background map) | Done |
| [US-1644](../tasks/US-1644-theme-edit-capability/README.md) | `theme.edit` capability — Edit and + on Settings theme tiles open the board-provided Theme Editor | Done |

### US-1636 — Theme derivation and the custom theme model

- `CustomThemeFile` type and validator (schema above; unknown keys ignored, non-color values and
  unknown `--color-*` override keys dropped with a warning, never thrown).
- `deriveTheme(base, isDark?)`: lightness shifts in a perceptual space (OKLCH) for background and
  border shades, text tiers by contrast against the background, accent-tinted selections and grid
  states at fixed alphas, status hues adjusted for the background, Monaco base + colors. Every one
  of the 77 variables gets a rule — no variable falls back to a built-in theme's literal.
- `baseFromTheme(theme)` + `overridesFor(theme, base)` for forking a built-in.
- **Acceptance:** `deriveTheme` from Persephone's own three colors is visually close to the
  hand-tuned Persephone theme (and likewise for Persephone Light and Default Dark); text tiers meet
  WCAG AA (4.5:1) against their backgrounds.

### US-1637 — Saved custom themes: storage, startup, Settings, cycling

- Files in `%APPDATA%\persephone\data\themes\<id>.theme.json`, loaded synchronously with the
  built-ins at module load so `readStartupThemeId()` accepts a custom id.
- `index.html` pre-paint script: for a `custom-*` id, read that theme file and use its background
  (override first, then `base.background`). Keep the built-in map for everything else.
- Theme registry becomes built-ins + customs, with add / replace / remove that re-applies when the
  active theme changes and notifies `themeState` subscribers (including Monaco and boards).
- Multi-window: each renderer watches the shared themes folder and reloads definitions. Every
  reload re-applies the selected id if it exists, otherwise it falls back to `persephone` in memory;
  only the window performing an explicit delete persists the fallback when it deleted its selected
  theme. A file restored externally can therefore re-activate the still-selected id.
- Custom themes sort by name case-insensitively, then id, in the registry/cycling order and Settings.
- Settings page: a **Custom** group (or a marker) beside Dark / Light; `theme` setting description
  mentions custom ids. Cycling includes custom themes.

### US-1638 — `app.themes` scripting / MCP API

- `list()`, `get(id)`, `current`, `derive(base, isDark?)`, `preview(themeFile)`, `endPreview()`,
  `save(themeFile)`, `rename(id, name)`, `delete(id)`, `apply(id)`; export/import are just the file.
- Typed in a new `src/renderer/api/types/themes.d.ts`; MCP reaches it as the `themes` path.
- Agent guide section: how to create a theme from a description.

### US-1639 — `themes` board permission and `persephone.themes` bridge

- `themes` flag in `BoardPermissionFlags`, the normalizer, the trust dialog's permission labels, the
  board template manifest (`false`) and the board guides.
- `persephone.themes.*` bridge methods mirroring US-1638, gated by the flag. A preview started by a
  board ends when that board closes or reloads.
- Bump `BOARD_BRIDGE_VERSION`.

### US-1640 — Theme Editor board (`persephone-boards`)

- Base pickers (background, text, accent; optional link / error / warning / success), dark/light
  indicator with override, "start from" any theme.
- Every derived color grouped (backgrounds, text, icons, borders, grid, status, editor, graph), each
  with swatch, derived value, override field and reset; contrast badges for text/background pairs.
- Live preview while editing; Save, Save As, Rename, Delete, Revert; export / import of the theme file.
- Manifest: `themes: true`, everything else off; `minBridgeVersion` = the US-1639 version.
- Screenshot and catalog entry per the boards repo's publishing process.

### US-1641 — Unsaved-changes protocol for plain board pages

- A plain board can report page dirty state and register an async Save handler; Persephone uses the
  existing modified tab indicator and Save / Don't Save / Cancel release prompt.
- Apply the guard to tab close, `navigatePageTo` and editor switch, and board reload (toolbar and
  `pages[i].editor.reload()`). A failed/rejected/false/timed-out save or Cancel keeps the page open;
  Don't Save tears down the frame and retains US-1639 preview cleanup. MCP reload calls return a
  pending attention result while a confirmation remains open; an agent can answer with
  `dialogs[0].click("Save")`, `dialogs[0].click("Don't Save")`, or
  `dialogs[0].click("Cancel")`. Cancel returns
  `{ refreshed: false, cancelled: true, pageId, frameReady, renderState }` to direct facade
  callers.
- Do not prompt on window/app close. As with text pages' autosave cache and session restore, a board
  owns persistence of its non-file draft. Theme Editor BT-036 stores its draft in board-local
  storage and re-reports modified after restore; this avoids a main-process close-cancel handshake.
- Only the main board frame owns dirty state and the save handler. Restore registers live state from
  the new frame and starts clean until then; secondary views cannot compete for ownership. Keep
  existing pinned bulk-close rules.
- Theme Editor BT-036 is the first consumer: Save persists and applies the theme, then clears dirty
  state. No new manifest permission is required because the API only affects that board's own page.
- The API ships under unreleased bridge `1.35.0`; do not bump `BOARD_BRIDGE_VERSION` again.
- Implement the bridge API and types in `src/board-shim.ts`; board-authored `board-api.d.ts`
  IntelliSense declarations are not maintained. `persephone.page` is unused and suitable for this
  self-page lifecycle API; `persephone.host` remains content/stream-host-only.
- Add `unsaved changes prompt the user` caution to `BoardEditorFacade.reload()`. There are no unit
  tests or test harnesses; Claude performs the behavior checks live over MCP.
- Update `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and
  `assets/board-template/CLAUDE.md`; use existing `pages[i].modified` rather than duplicating it on
  `pages[i].editor`.

## Concerns / Open questions

- **Derivation quality is the whole feature.** Three colors must produce a theme that looks
  designed, not computed. US-1636 should be judged against the hand-made themes before anything is
  built on top of it.
- **Variables used for two meanings.** `--color-misc-blue` is the app-wide accent and
  `--color-misc-link` the link color (US-1634). The derivation must follow what each variable is
  *used* for, not its name; US-1636 should audit usages of any variable whose name misleads.
- **Preview scope.** Preview in the board's window only, or every window? Leaning towards the
  board's window only — previewing across windows adds IPC for little gain.

## Notes

### 2026-10-09
- Epic created from the user's request, after US-1634 (Persephone themes) made the theme structure
  fresh in context.
- US-1640 planning found that `fork(id)` cannot round-trip a saved custom theme: it rebuilds base
  colors from the palette, pinning every optional base color and the dark/light mode. Added
  `app.themes.file(id)` / `persephone.themes.file(id)` (no new bridge version — 1.35.0 is unreleased),
  returning the stored file of a custom theme or `null` for built-ins; the Theme Editor edits saved
  themes from it.
- Board bridge calls at startup timed out (found with the Theme Editor restored on app restart):
  main registered its `MCP_RESULT` reply listener only in `startMcpHttpServer()` (`initMcpIpc()`),
  so a renderer reply sent before the deferred MCP server start — or ever, with MCP disabled — was
  dropped and `persephone.themes.*` / `persephone.call()` failed with "Request timeout" after 30 s.
  `sendToRenderer()` now calls `initMcpIpc()` first. Also the renderer's `MCP_EXECUTE` listener is
  registered before pages are restored and queues requests until `initEvents()` marks it ready.
