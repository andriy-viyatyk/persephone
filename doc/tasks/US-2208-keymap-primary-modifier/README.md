# US-2208: Keymap with a primary modifier

## Goal

Introduce one shared owner for application shortcut identities, primary-modifier matching and displayed labels, preserving Windows behavior and wording byte for byte. Ctrl remains primary on Linux; a darwin slot prepares for Cmd without claiming macOS support. This is a planning task for [EPIC-213](../../epics/EPIC-213.md), roadmap decision 7 and §8, and inventory WIN-28.

## Background

Windows and Linux already receive Ctrl for most shortcuts. The surface is larger than the central service: native Electron input, DOM events, board frames, browser guests, third-party editors, configurable voice chords and static guides have distinct owners. Migrate the central service, its visible labels and voice integration first; defer local handlers that already work on Linux to the macOS port. Do not add general user rebinding. Existing voice shortcut configuration remains supported.

### Inventory

The inventory below groups related commands at their actual owner. `code` means physical DOM/Electron code; `key` means logical key. Extra-modifier acceptance and propagation are determined by each existing predicate, and must not be tightened during migration. Labels quoted are existing English or literal values. An unlabelled command may still be described in guides below.

| Location | Shortcut / action | Match or definition | Label today |
|---|---|---|---|
| `src/renderer/api/internal/KeyboardService.ts` `handleKeyDown` | Ctrl+Tab / Ctrl+Shift+Tab; Ctrl+W / Ctrl+F4; Ctrl+N / Ctrl+Shift+N; Ctrl+O; Ctrl+Alt+[/] | `code`, `ctrlKey`, optional `shiftKey` or `altKey`; board mode suppresses new page | Tab and menu-bar tooltips below; `assets/guides/shortcuts.md` |
| Same | F1 guide, F12 DevTools, Alt+Left/Right history, mouse buttons 3/4 | `code` and explicit modifier exclusions / mouse button; F1 and history respect composition/default prevention as coded | `src/shared/i18n/en/shell.ts` history messages say `Alt+Left` / `Alt+Right`; guides |
| `src/renderer/ui/tabs/PageTabsView.ts` constructor and `updateAddMenu` | New page | Calls central service indirectly | `t("shell.addPageCtrlN", { shortcut: "Ctrl+N" })` twice |
| `src/renderer/ui/sidebar/MenuBarView.ts` | Open file, new window; Ctrl+F folder search | First two invoke actions; Ctrl+F uses `ctrlKey` + `code` | `Ctrl+O`, `Ctrl+Shift+N` passed to `shell.openFileCtrlO` / `shell.newWindowCtrlShiftN` |
| `src/renderer/editors/shared/ImageActionsToolbarView.ts` | Copy image Ctrl+C | Focused image viewport; separate handler below | `editors.copyImageWithShortcut` interpolates literal `Ctrl+C` |
| `src/renderer/core/events/context-menu.ts`, `src/renderer/api/types/events.d.ts`, `src/renderer/uikit/Menu/MenuView.ts` | Optional context-menu `hotKey` | Display-only string; menu invokes `onClick`, it does not bind keys | Rendered verbatim; examples in `src/renderer/uikit/Menu/Menu.story.ts`; no production `hotKey:` assignment found in `src/renderer` |
| `src/renderer/api/dialogs/grid-context-menu.ts`, `src/board-shim/board-context-menu.ts` | Grid / board context-menu actions | Grid passes through menu records; board has native clipboard actions; no independently declared accelerator found | Grid may display upstream `hotKey`; board menu labels are action text |
| `src/main/tray-setup.ts` | Show / quit tray menu | Electron `Menu.buildFromTemplate`, click callbacks, no `accelerator` | Translated action labels, no shortcut |
| `src/main` as a whole | Electron application menus / global registrations | Search found no explicit `accelerator`, `CommandOrControl`, or `globalShortcut` use; tray is the only `Menu.buildFromTemplate` in `src/main` | No app-specified Electron accelerator label. Electron defaults, if present, are not evidence of an app binding |
| `src/main/open-window.ts` `before-input-event` | Ctrl **or** Meta + =/+/-/0 window zoom | Electron `input.control || input.meta`, `input.key`; passes voice input first | `assets/guides/shortcuts.md` uses Ctrl |
| `src/renderer/api/internal/GlobalEventService.ts` `handleWheel`; `src/renderer/uikit/ImageViewport/ImageViewportView.ts` `onKeyDown` | Ctrl+wheel window zoom; image Ctrl+C copy and +/−/0 zoom | Wheel `ctrlKey`; image DOM `key` and `ctrlKey` for copy | Guides use `Ctrl+Mouse Wheel` and `Ctrl+C` |
| `src/shared/voice-typing-shortcut.ts`; `src/main/voice-typing-controller.ts`; `src/renderer/editors/settings/fields/ShortcutField.ts`; `src/renderer/api/speech/voice-typing/VoiceTypingService.ts` | Configured voice chords: defaults Alt+V / Alt+Shift+V; optional Right Ctrl / Shift+Right Ctrl | Shared normalization and canonical `Ctrl`, `Alt`, `Shift`, `Meta` chord strings, reserved set; Electron `input.control/alt/shift/meta` compare; capture converts DOM flags. Right tap uses `code` and down/up state | Stored canonical string displayed by settings field; `src/shared/i18n/en/settings.ts` help names right Ctrl. `assets/guides/shortcuts.md`, `screens/settings.md` |
| `src/renderer/editors/base/TextPageKeymap.ts` | Ctrl+S / Ctrl+Shift+S save; Ctrl+Shift+F search; F5 script | DOM `code`; save starts with Ctrl **or** Meta, but non-board host save requires Ctrl; dirty script-panel save accepts either | Guides; F5 title in `TextChromeView.ts`, `script-panel/ScriptPanelView.ts` |
| `src/board-shim/frame-behaviours.ts` | Ctrl or Meta+S save; Ctrl+Alt+[/] theme | DOM `key` / `code`, `ctrlKey` / `metaKey`; board may prevent default | `assets/guides/boards/custom-editors-advanced.md`, `theme-and-layout.md` |
| `src/renderer/editors/browser/BrowserShortcutTable.ts`; `src/main/browser/BrowserGuest.ts` | Ctrl+L/F; F5 / Ctrl+F5; Ctrl+R / Ctrl+Shift+R; F12; Alt+Left/Right; Ctrl+=/+/-/0 guest zoom | DOM `ctrlKey` + `key` at browser root; Electron `input.control` / `input.alt` + `key` in guest. Guest and root routing differ | Browser toolbar back/forward uses `Alt+Left/Right`; `assets/guides/editors/browser/index.md`, `shortcuts.md` |
| `src/preload-webview/page-reporters.ts`; `src/renderer/editors/browser/page-clipboard-recorder.ts` | Ctrl+F page report; Ctrl+V / Shift+Insert staged paste | DOM `ctrlKey` + `key`; clipboard implementation also handles paste events | Browser automation and clipboard guides |
| `src/renderer/editors/markdown/MarkdownBodyView.ts`; `src/renderer/editors/monaco/MonacoBodyView.ts` | Ctrl or Meta+F markdown find; Monaco converted paste with modifier | DOM `key` / flags; Monaco owns its own default keymap | Markdown and Monaco guides; Monaco's own labels |
| `src/renderer/editors/grid/GridEditor.ts`; `src/renderer/editors/compare/CompareEditor.ts` | Grid navigation, selection, Ctrl+Insert/Delete and clipboard; compare editor navigation | Grid delegates to `av-grid`; compare uses Monaco diff editor. No local Ctrl predicate in these directories | `assets/guides/editors/grid.md`, `shortcuts.md`; library UI |
| `src/renderer/uikit/Tree/TreeModel.ts`, `TreeKeyboardHandler.ts`; `src/renderer/components/tree-provider/CategoryViewModel.ts`, `TreeProviderViewModel.ts`, `TreeProviderView.ts` | Ctrl+click selection, Ctrl+A, Ctrl+C/X/V, Ctrl+F; arrows and F2 | DOM `ctrlKey`, logical keys and selection state; context-dependent | `assets/guides/tabs-and-navigation/file-explorer-and-panels.md`, `shortcuts.md` |
| `src/renderer/ui/tabs/PageTabView.ts`; `src/renderer/editors/link-editor/LinksListView.ts`, `LinksTilesView.ts` | Ctrl+click tab grouping / modified link deletion | Mouse `ctrlKey` | `assets/guides/screens/tabs.md` for tabs |
| `src/renderer/api/dialogs/OpenUrlDialog.ts`, `CommitDialog.ts`; `src/renderer/editors/link-editor/EditLinkDialog.ts`, `src/renderer/editors/mcp-inspector/ToolsPanel.ts` | Ctrl+Enter submit; commit and link also accept Meta+Enter | DOM `key`, flags | No accelerator label found at handlers |
| `src/renderer/editors/video/VideoView.ts` | Enter play | DOM `key`, excludes Ctrl/Alt/Shift | `editors.videoUrlOrCurl` interpolates `Enter` |
| `src/renderer/automation/input.ts` | Injected Control/Shift/Alt/Meta and compound keys | Automation protocol maps names, CDP and synthetic event flags; not an app shortcut registry | API help and agent guides; preserve protocol |

Other printed shortcut documentation: `assets/guides/getting-started.md`, `index.md`, `whats-new.md`, `mcp-setup/index.md`, `tabs-and-navigation/index.md`, `tabs-and-navigation/menu-bar.md`, `screens/header.md`, `screens/menu-bar.md`, `screens/settings.md`, `screens/tabs.md`, `editors/folder.md`, `editors/image.md`, `editors/markdown.md`, `editors/monaco.md`, `scripting/index.md`, `boards/env-vars.md`, `boards/getting-started.md`, `boards/theme-and-layout.md`, `boards/custom-editors-advanced.md`, `agents/boards/lifecycle-and-ui.md`, `agents/boards/theme-and-assets.md`, `agents/browser.md`, `agents/browser-automation.md`, and `agents/web-app-tests/{index,attached-runs-and-results,call-boundary-and-examples,unattended-runs}.md`. `assets/guides/shortcuts.md` is the consolidated shortcut table. These are static text, not runtime labels; do not rewrite Windows text in this phase.

### Linux and desktop interaction

- Right Ctrl is a physical-key option, not the primary-modifier rule. `ShortcutField.captureRightCtrlTap` and `VoiceTypingController.trackRightCtrlTap` require `code === "ControlRight"` on both down and up; neither checks `location`. The shared voice module names and normalizes the option but does not detect the tap. Electron documents `code` and `location` as corresponding to DOM values; the [UI Events code specification](https://www.w3.org/TR/uievents-code/) defines `ControlRight` by physical position. This makes it plausible on both X11 and Wayland, but source and standards do not establish actual delivery on either backend, on remapped keyboards, or through every guest. Treat both as **unverified**, not a known Linux failure. Do not substitute `location` or change tap semantics without evidence; Phase 2 checks real physical input. Default Alt chords remain available.
- Windows-specific `Win+Ctrl+D` and `Win+L` in `assets/guides/agents/web-app-tests/unattended-runs.md` and `src/main/virtual-desktop-manager.ts` describe Windows desktop operations, not Persephone key bindings. Windows-specific Shift+Insert descriptions in browser agent guides also need platform context, not blind replacement. Virtual desktops are deferred to Phase 2. `settings.ts` right Ctrl is a physical key name, not “Win”. No application shortcut label using `Win` was found.
- `MenuBarView` is custom UI; no Alt-based mnemonic registration was found in its code, and the tray has no accelerator. Alt+Left/Right is navigation, not a menu mnemonic. Electron/desktop native menu behavior and Alt interception remain a live-check concern; do not invent an Alt mnemonic migration.
- GNOME/compositor bindings are configurable and vary by version and Ubuntu settings. [GNOME keyboard shortcuts](https://help.gnome.org/gnome-help/shell-keyboard-shortcuts.html) and [workspace switching](https://help.gnome.org/gnome-help/shell-workspaces-switch.html) describe Super, Alt+Tab, Alt+F2 and Ctrl+Alt+arrow/workspace variants. Ubuntu may also bind Ctrl+Alt+T and Ctrl+Alt+Delete; verify actual settings in the target VM. The concrete overlap in the app's published table is Monaco **Ctrl+Alt+Up/Down** add cursor above/below (`assets/guides/shortcuts.md`) where those arrows are assigned to workspace switching; GNOME's documented horizontal workspace bindings may instead be Left/Right. There is no fixed Persephone Super, Ctrl+Alt+T, Alt+F2, Alt+Tab or Ctrl+Alt+Delete binding found in this inventory. User-configured voice chords can collide with any of them; normalization does not reserve desktop shortcuts. Ctrl+Alt+[/] themes are not an exact match to those examples. No claim of interception until checked in Phase 2's GNOME Wayland VM; Xvfb/WSLg is not that check.

## Implementation Plan

- [x] Add pure `src/shared/keymap.ts`, importing existing `supportedPlatform`/`isMac` from `src/shared/platform.ts`; no new `process.platform` checks or Electron/DOM runtime dependency. This module owns primary modifier selection, named central shortcut definitions, event matching and display formatting. Specify win32/linux = `Ctrl`, darwin = `Cmd`; unsupported platforms explicitly fall back to Ctrl as today. Use a structural `{ ctrlKey: boolean; metaKey: boolean }` event input so keyboard and wheel callers can eventually share it; `isPrimaryModifier` selects only the relevant flag and does not impose other exclusions. Keep original `code`, Shift/Alt checks, ordering, default prevention and board-mode behavior at the caller. A darwin slot is preparation, not a promise that deferred handlers already use Cmd.
- [x] Define typed central shortcut descriptors for new page/window, close, tab navigation, open and theme cycle; store the key and additional modifiers once, with formatting that preserves existing `Ctrl+Shift+N`, `Ctrl+Alt+]` spelling/order. Keep different chords for one action distinct (Ctrl+W and Ctrl+F4). Do not make `KeyboardService.ts` a larger registry or change F1/F12/history conditions. Example, preserving existing additional-modifier semantics:

  ```ts
  // Before: if (e.ctrlKey) { ... }
  // After:  if (isPrimaryModifier(e)) { ... }
  // Before: t("shell.addPageCtrlN", { shortcut: "Ctrl+N" })
  // After:  t("shell.addPageCtrlN", { shortcut: formatShortcut(keymap.newPage) })
  ```

  Name/API may be adjusted during implementation, but the shared owner and separation are mandatory. The formatter must use descriptor display keys (e.g. `N`, not `KeyN`) and permit the exact existing Windows output. Never parse translated display strings to match events.
- [x] Migrate `src/renderer/api/internal/KeyboardService.ts` central Ctrl predicates to the shared rule and central definitions, without moving guide resolution, adding import-zone exceptions, or changing event priority. In `src/renderer/ui/tabs/PageTabsView.ts` both title sites and `src/renderer/ui/sidebar/MenuBarView.ts` open/new titles use the same descriptors and formatter. For `ImageActionsToolbarView.ts`, format its existing Ctrl+C label with a shared copy descriptor and migrate the matching Ctrl+C predicate in `src/renderer/uikit/ImageViewport/ImageViewportView.ts` to the same primary rule, preserving its logical `key === "c"` and other behavior. The shared matcher is passed through `ImageViewportProps` by the image, SVG, and Mermaid editor owners to preserve UIKit's import boundary. This keeps the label aligned with its handler on darwin; its Windows label remains identical. Read `src/renderer/uikit/CLAUDE.md` before modifying UIKit. `MenuView.ts` stays a generic display-only renderer; do not turn arbitrary external `hotKey` strings into bindings. The tray has no accelerator to migrate.
- [x] In `src/shared/voice-typing-shortcut.ts`, reuse the central definitions to derive the corresponding reserved application chords, retaining the exact existing reserved set including browser/F5/F12/Alt-arrow rules. Keep normalization, accepted aliases, modifier order, exact serialized strings, default values and physical Right Ctrl constants stable. In `src/main/voice-typing-controller.ts` and `src/renderer/editors/settings/fields/ShortcutField.ts`, continue consuming that shared voice owner; do not reinterpret a saved `Ctrl` as primary or rename `Meta` to `Cmd`. Change only integration necessary to prevent duplicate central shortcut rules. Preserve keydown/up state, target checks, autorepeat and prevention behavior. Example:

  ```ts
  // Before: RESERVED_CHORDS includes "Ctrl+N" as an independent literal
  // After:  RESERVED_CHORDS includes the shared new-page chord's canonical Ctrl form
  ```

  The canonical stored chord is separate from a platform display label; ensure Windows and Linux reservations remain byte-identical. Do not broaden or narrow voice validation on Windows. No settings migration is needed.
- [x] Leave the editor-local and other deferred rows above unchanged for Linux. `src/main/open-window.ts` accepts Ctrl **or** Meta today, as do several other handlers: replacing these with a single platform flag would change Windows behavior. Keep those semantics until an explicitly scoped macOS migration. Keep `src/main/browser/BrowserGuest.ts`, `src/board-shim/frame-behaviours.ts`, third-party Monaco/av-grid, wheel and selection gestures, and automation protocol under their present owners. For a future migration, model DOM and Electron input separately and account for iframe/guest routing and existing Ctrl-or-Meta behavior.
- [x] Run `npm run typecheck` and `npm run lint` on this checkout; both pass.
- [ ] Verify the existing suite areas below on Windows and Linux. Do not add unit tests or a harness. Per EPIC-213 decision 5, Claude performs Linux live checks and suite runs; record results and failures against their owners. Do not start Persephone during planning. Physical right-Ctrl, native menus, GNOME interception and actual labels require the separate Phase 2 VM check; existing synthetic input is not proof of physical delivery.
- [x] No English catalog messages or Windows wording changed, so no language-pack or guide updates are needed. No `await import()` bypass or new platform checks were added.

### Existing verification areas

- `integration-test/tests/shell/shortcuts/shortcuts.test.mjs`: Ctrl+N/W, Tab/Shift+Tab, save, zoom, theme, F1, F5, Alt history. This is the primary regression area.
- `integration-test/tests/capabilities/voice/voice-typing.test.mjs`: configured voice shortcut through app `before-input-event`, recording and transcription; requires its fixture and microphone setup. It does **not** establish right-Ctrl physical behavior.
- `integration-test/tests/browser/navigation/navigation.test.mjs`: Ctrl+L root focus; `integration-test/tests/browser/automation/input/input.test.mjs`: F5 and clipboard keys. `integration-test/tests/browser/tabs/tabs.test.mjs` explicitly records guest zoom shortcuts as uncovered.
- `integration-test/tests/editors/grid/keyboard.test.mjs`: Ctrl+Delete/Shift+Delete and paste. `integration-test/tests/shell/menus/menus.test.mjs` and `integration-test/tests/shell/menu-bar/menu-bar.test.mjs` exercise menus, but do not prove accelerator label bytes or keyboard activation. Inspect affected rendered labels and Windows byte identity separately during UI review. Consult `doc/standards/integration-tests.md` for the runner and prerequisites.

## Concerns

- The existing central predicates frequently allow additional modifiers. Preserve this even if a descriptor looks like an exact chord; a stricter matcher would be a Windows regression.
- The reserved voice list is intentionally not a complete conflict detector: browser, editor and desktop bindings overlap by focus and OS. Keep it unchanged now. Physical Ctrl and a user-specified literal Ctrl are not portable aliases for primary.
- macOS remains unsupported. The new owner provides a Cmd slot only for migrated commands; Electron native defaults, third-party editors, deferred handlers and persisted voice settings still require a coordinated port.
- GNOME claims and right-Ctrl delivery are session, layout and configuration dependent; report the actual settings and observed result when Phase 2 runs. No change of bindings is authorized by this task.

## Acceptance Criteria

- [ ] One pure shared keymap owns primary selection and central command descriptors/labels, using `platform.ts`; win32/linux use Ctrl, darwin has Cmd, unsupported fallback is explicit.
- [ ] Central service and specified visible labels use it; Windows behavior, shortcut strings and displayed labels remain byte-identical, including extra modifiers, board mode, event routing, and Ctrl-or-Meta exceptions left untouched.
- [ ] Voice defaults, normalized persisted values, reserved chords and right-Ctrl tap behavior are unchanged; the central reserved definitions are reused without a user-rebinding feature.
- [ ] Linux behavior and deferred local owners are documented; GNOME collisions and physical-key delivery are checked in Phase 2 rather than asserted from Xvfb.
- [ ] Typecheck, lint and named applicable existing UI test areas pass on Windows and Linux, with Linux runs performed by Claude; no new unit tests or harnesses. Record any pre-existing or environment failures.
- [ ] If English messages changed, translation completion is tracked for epic close. No guide change is needed when Windows wording is unchanged.

## Files Changed Summary

| Path | Planned change |
|---|---|
| `src/shared/keymap.ts` | New pure primary-modifier rule, central descriptors, matcher and formatter |
| `src/renderer/api/internal/KeyboardService.ts` | Consume shared central bindings without changing dispatch semantics |
| `src/renderer/ui/tabs/PageTabsView.ts`, `src/renderer/ui/sidebar/MenuBarView.ts`, `src/renderer/editors/shared/ImageActionsToolbarView.ts` | Format displayed primary shortcuts through the shared owner |
| `src/renderer/uikit/ImageViewport/ImageViewportView.ts` | Match the displayed image-copy shortcut through the shared primary rule |
| `src/shared/voice-typing-shortcut.ts` | Reuse central reserved definitions while preserving serialized chords |
| `src/main/voice-typing-controller.ts`, `src/renderer/editors/settings/fields/ShortcutField.ts` | Only if needed for integration; preserve physical tap behavior |
| `src/shared/platform.ts` | Reuse existing platform identity; no change anticipated |
| `src/main/tray-setup.ts`, `src/renderer/uikit/Menu/MenuView.ts`, `src/main/open-window.ts`, `src/main/browser/BrowserGuest.ts`, `src/board-shim/`, `src/renderer/editors/{grid,compare,markdown,monaco,browser}/`, tree and automation owners | No change in this task; inventory and deferred migration above |
| `src/shared/i18n/en/`, `assets/languages/`, `assets/guides/`, `integration-test/` | No change anticipated; existing labels, translations, guides and tests are retained |


