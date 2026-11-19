# US-2123: `pressKey` reaches main-process shortcuts

Epic: [EPIC-199](../../epics/EPIC-199.md)

## Goal

Make agent `pressKey` calls activate Persephone's main-process keyboard shortcuts on the intended
web contents, while preserving the existing CDP behavior for ordinary page and editor keyboard
input. Verify app-window zoom and voice-typing shortcuts through the call tree.

## Background

`src/renderer/automation/input.ts` implements trusted keys through CDP
`Input.dispatchKeyEvent`. `pressKey()` parses compound strings, presses any modifiers via
`dispatchKeyDown()`, presses/releases the main key in `pressMappedKey()`, then releases only the
modifiers it introduced. The held-key registry is per CDP registration and session. This targets
Chromium content and does not trigger Electron's main-process `before-input-event` listeners.
`dispatchSyntheticKey()` is a separate DOM `KeyboardEvent` path. Ordinary text entry is separate:
`src/renderer/automation/forms.ts` calls `typeMappedCharacter()` and falls back to
`Input.insertText`; it should remain on that existing route. A plain `pressKey("a")` is also used
for page keys and text-like input, so only shortcut key sequences should use Electron input.
`keyDown()` and `keyUp()` maintain modifier state across calls in `input.ts`; routing therefore
must be recorded at key-down so its matching key-up uses the same route, including cleanup after a
dispatch failure.

`pressKeyOnTarget()`, `keyDownOnTarget()` and `keyUpOnTarget()` in
`src/renderer/automation/keyboard.ts` are the shared entry points used by app-screen and browser
automation. `AppTargetModel.cdp()` uses `APP_WINDOW_CDP_KEY`; `BrowserTargetModel.cdp(tabId)` uses
the selected guest's registration key. `CdpSession` sends requests through `BrowserChannel` and
the main process resolves that key through `resolveTarget()` in `src/main/cdp-service.ts`; app keys
resolve to the invoking window's `webContents`, while browser keys resolve to the registered
guest. The new `src/main/cdp-key-input.ts` will own the rule for dispatching a keyboard event
through Electron input; it takes the already-resolved `webContents` and calls
`webContents.sendInputEvent()`. `BrowserTargetModel` focuses the selected webview before key
dispatch (or focuses the popup when applicable). The app target's `focusWebview()` is deliberately
a no-op.

The app window listener is in `src/main/open-window.ts` and delegates to
`voiceTypingController.handleInput(event, input, this.window.webContents, "app")` before handling
Ctrl/Meta zoom (`=`, `+`, `-`, `0`). Browser guest contents are listened to in
`src/main/browser/BrowserGuest.ts`; `BrowserGuest.handleInput()` forwards keys to voice typing and
handles guest zoom, reload (`F5`, Ctrl+R), and dev tools (`F12`). The browser guest also already
uses `this.webContents.sendInputEvent()` for mouse release recovery. The feedback entry
`doc/reviews/ai-vision-feedback.md` under EPIC-196 / US-2111 records that `webContents.sendInputEvent`
does reach `before-input-event` and that voice typing had no other shortcut route.

The exact stale caveat is at `assets/guides/agents/browser.md:160-162`: browser `pressKey` keys
reach only the web page, and Persephone browser shortcuts do not run. The app-screen guide is
`assets/guides/agents/pages.md`; its `Automating Persephone's Own UI` section shows
`window.screen.pressKey("Escape")` but contains no shortcut caveat. The existing voice test also
has an explanatory comment saying CDP keys cannot start voice typing; replace that comment when
the test is changed.

Test ownership is already established: `integration-test/tests/shell/shortcuts/shortcuts.test.mjs`
owns window shortcut tests and reads `ctx.app.window.zoomLevel` through the call tree;
`integration-test/tests/capabilities/voice/voice-typing.test.mjs` owns voice typing, declares
`requires: ["launch"]` on its capture tests, and uses the fake fixture transcriber and test
microphone. Browser automation keyboard behavior lives in
`integration-test/tests/browser/automation/input/input.test.mjs`.

## Implementation Plan

### Input routing

1. Update `src/renderer/automation/input.ts` to choose the route for each key-down from its
   effective modifier mask. Use Electron input when Control, Alt, or Meta is active; when the key
   itself is Control, Alt, or Meta on the key-down dispatch path (explicit `keyDown()` or a
   compound `pressKey()`); or when the key is F5 or F12.
   Include Shift in the Electron modifier list when it accompanies Control, Alt, or Meta, but
   Shift-only combinations (`Shift+A`, `Shift+Tab`, `Shift+ArrowRight`) stay on CDP. All other
   function keys also stay on CDP: `BrowserGuest.handleInput()` handles F5 and F12 as main-process
   shortcuts, while no other standalone function key in this scope has a main-process handler.
   Plain keys and text remain on CDP. Record the chosen route beside each key in the existing
   per-target held-key registry, then use that stored route for key-up and for failure cleanup so
   a matching release cannot switch paths. Keep `dispatchSyntheticKey()` as the explicit DOM
   compatibility mode, and keep ordinary `type()` / `typeMappedCharacter()` / `Input.insertText`
   on their current CDP/text route.
2. Add a typed key-input request to the existing `BrowserChannel` boundary in
   `src/ipc/browser-ipc.ts`, expose it through `src/renderer/automation/CdpSession.ts`, and register
   it in `src/ipc/main/cdp-handlers.ts`. Reuse the existing invoke IPC and `guardedIpcHandle`
   pattern; do not add a correlator, custom request protocol, acknowledgement window, or error
   envelope.
3. Add `src/main/cdp-key-input.ts` as a one-job module that owns the rule "dispatch a keyboard
   event through Electron input." Its function accepts an already-resolved `WebContents` and the
   typed Electron keyboard event, rejects destroyed contents using the existing error style, and
   calls `webContents.sendInputEvent()`. Do not add target lookup or other shortcut policy to this
   module.
4. Reuse `resolveTarget()` in `src/main/cdp-service.ts` to resolve the registration key in the
   existing guarded `src/ipc/main/cdp-handlers.ts` handler, then pass the resolved app or browser
   guest `webContents` to `cdp-key-input.ts`. Export the existing resolver by changing its current
   declaration only; `cdp-service.ts` must not gain dispatch logic or net lines. If resolution
   returns a board frame, keep that key on the existing CDP route. `src/ipc/main/cdp-handlers.ts`
   is currently 20 lines and has no entry in the roadmap's god-file table; limit it to the
   required import and guarded handler registration, with no new routing subsystem.
5. Put one conversion helper in `src/renderer/automation/input.ts` that maps a routed key and its
   effective modifier mask to Electron's `KeyboardInputEvent`. Follow the proven mapping in
   `integration-test/tests/helpers/shell-helpers.mjs:38-40`: `keyCode` is an Electron accelerator
   key name (`"="`, `"Plus"`, `"-"`, `"0"`, `"F5"`, `"V"`); `modifiers` is an array of
   `"control" | "alt" | "shift" | "meta"`; send paired `type: "keyDown"` and `type: "keyUp"`
   events and no `char` event for shortcut input. The existing native zoom tests confirm `"="`,
   `"-"`, and `"0"` as the key codes. `CdpSession.ts` transports the already-converted event
   without doing a second mapping. App-window events must reach `OpenWindow`'s existing
   `before-input-event` handler, and browser events must reach the selected
   `BrowserGuest.handleInput()`. Preserve focus targeting: the browser target focuses its selected
   guest or popup before dispatch; app-screen focus remains the current no-op and must not steal
   OS focus. Preserve the order of modifier down, main key down/up, modifier up.

The implementation choice is shortcut-only routing with Control/Alt/Meta detection, not a generic
"any modifier" rule. This preserves CDP's printable `text` behavior and Shift-only selection
behavior: Electron `sendInputEvent` keyDown has no text, and this route does not synthesize a
separate `char` event. Plain key presses, Shift-only combinations, and text entry therefore stay
on the current CDP/IME path. Existing modifier tracking determines the route for held sequences;
the route recorded at key-down controls the matching key-up, including release after a dispatch
failure. The browser's existing focus step and app's no-op focus behavior remain in place.

Before/after for the event dispatch in `src/renderer/automation/input.ts`:

```ts
// Before: a compound trusted press also goes through CDP and bypasses before-input-event.
await cdp.send("Input.dispatchKeyEvent", eventParams(key, type, modifierMask(keys)), sessionId);

// After: `electronKeyboardInputEvent()` in input.ts maps accelerator keyCode/modifiers;
// route the key pair through the selected target, with no char event.
await cdp.sendInputEvent(electronKeyboardInputEvent(key, type, modifierMask(keys)));
```

The after snippet is the intended shortcut branch inside the existing key-dispatch helper; the
existing CDP dispatch remains the ordinary-key branch.

### Tests and guides

6. Add one new test to `integration-test/tests/shell/shortcuts/shortcuts.test.mjs` that uses
   `ctx.app.window.screen.pressKey("Ctrl+=")`, then `"Ctrl+-"`, then `"Ctrl+0"`. Assert each
   expected `ctx.app.window.zoomLevel` through `ctx.waitFor`. Start at zoom 0, expect 0.5 after
   Ctrl+= and 0 after Ctrl+-, set zoom to 0.5 before Ctrl+0 to prove reset, and restore the
   original zoom in `finally`. Leave the existing "Ctrl+plus zooms the window in" and
   "Ctrl+- zooms the window out" tests (which use `pressNativeShortcut`) unchanged and do not
   weaken their assertions.
7. Extend `integration-test/tests/capabilities/voice/voice-typing.test.mjs` with an Alt+V test
   that reuses the setup from "Transcript toolbar transcribes from the microphone": register and
   trust `fixtureBoard(ctx, "voice/fixture-transcriber")` with `trustFixtureBoard`, create and
   show a text page, click `EDITOR_SELECTOR` to focus the editor, and keep the existing fixture
   provider/trust cleanup. Read `ctx.app.settings.get("voice-typing.shortcut")` and press that
   configured shortcut (the default is defined as `DEFAULT_VOICE_TYPING_SHORTCUT = "Alt+V"` in
   `src/shared/voice-typing-shortcut.ts:8`, and as the `"voice-typing.shortcut"` setting default
   in `src/renderer/api/settings-schema.ts:56`). Wait for `[data-name="voice-typing-overlay"]` to
   show recording, press the same setting again to stop, then use `ctx.waitFor` on
   `pages[pageId].content` until it contains `FIXTURE_TEXT`; wait for the overlay to become
   hidden. Declare `requires: ["launch"]` because capture uses the fake test microphone. Keep the
   existing transcript toolbar tests. Replace the stale comment at lines 31-34 with text saying
   the shortcut test now covers the app `before-input-event` route, overlay, and transcription.
8. Extend `integration-test/tests/browser/automation/input/input.test.mjs` with a browser guest
   reload regression. On its existing local input fixture, set a window marker with `evaluate`,
   start `editor.waitForNavigation()` before pressing `F5` through the browser editor's `pressKey`,
   await navigation, and assert that reloading cleared the marker. `waitForNavigation` is in the
   browser call-tree table at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:74` and
   its implementation at lines 632-635; it arms the next main-frame navigation, with no URL-change
   predicate. `src/main/cdp/cdp-waits.ts:220-235` observes `Page.frameStartedLoading` and
   `Page.frameNavigated`, including a reload at the same URL. The existing
   `integration-test/tests/browser/automation/observe/observe.test.mjs:102-109` demonstrates
   arming before the navigation trigger. This checks the guest route without adding a call-tree
   zoom member.
9. In `assets/guides/agents/browser.md`, replace the exact stale statement at lines 160-162 with
   wording that `pressKey` reaches the focused web page and Persephone's browser shortcuts. In
   `assets/guides/agents/pages.md`, update the `Automating Persephone's Own UI` section to name
   `window.screen.pressKey` as able to invoke app-window shortcuts, including zoom and voice
   typing. It has no current shortcut caveat to delete, so make this a short positive clarification.

### Regression set for Claude

Run the following existing modules after routing changes, as their Control, Alt, or held-Control
key presses will now reach Electron's input handler. This is in addition to the new zoom, voice,
and browser F5 cases above; keep every existing assertion.

- `integration-test/tests/shell/shortcuts/shortcuts.test.mjs`: all tests, including Ctrl+N/W,
  Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+S, the theme shortcut test (Ctrl+Alt), and Alt+Left/Right;
  its two existing native zoom tests stay unchanged.
- `integration-test/tests/shell/dialogs/entrypoints.test.mjs`: "Open URL opens a fixture-server
  URL and Cancel opens no page" (both Ctrl+O calls).
- `integration-test/tests/core/files/files.test.mjs`: tests using its Control+A
  `replacePageContent` helper.
- `integration-test/tests/shell/tabs/tabs.test.mjs` and
  `integration-test/tests/shell/menus/menus.test.mjs`: tests using
  `shell-helpers.mjs` `replacePageContent` (Control+A).
- `integration-test/tests/capabilities/voice/voice-typing.test.mjs`: existing "Transcript toolbar
  transcribes from the microphone" test's Control+End focus operation.
- `integration-test/tests/browser/popups/popups.test.mjs`: "popup content methods target the
  popup and preserve both CDP and synthetic input" (Control+A).
- `integration-test/tests/browser/navigation/navigation.test.mjs`: "URL bar focuses, submits
  fixture URLs, and shows visited history" (Control+L).
- `integration-test/tests/editors/html/html.test.mjs`: "HTML Preview runs scripts and reflects
  source edits" (Control+A).
- `integration-test/tests/editors/grid/data-operations.test.mjs`: "Ctrl+Insert adds an unsorted
  row and is blocked while sorted or filtered".
- `integration-test/tests/editors/grid/keyboard.test.mjs`: "Ctrl+Delete deletes the selected row
  and Ctrl+Shift+Delete deletes its selected column" and "Pasting TSV grows rows and columns, and
  one value fills a selection" (Control+V; Shift+Arrow selection stays on CDP).
- `integration-test/tests/editors/compare/compare.test.mjs`: "Git Diff shows committed and
  working revisions and saves edits from the working side" (Control+A/S).
- `integration-test/tests/editors/markdown/markdown.test.mjs`: "editing Markdown in Text Editor
  updates the rendered preview" (Control+A).
- `integration-test/tests/editors/switching/switching.test.mjs`: JSON, Markdown, and Mermaid
  source/edit switching tests (Control+A).
- `integration-test/tests/editors/svg/svg.test.mjs`: "SVG Preview renders unsaved source edits"
  (Control+A).
- `integration-test/tests/editors/text/text.test.mjs`: "text: insertion can be undone"
  (Control+Z).
- `integration-test/tests/editors/text/text-behavior.test.mjs`: "typing updates content and
  modified state through undo and redo", "keyboard multi-cursor typing edits two lines at once",
  and "JSON document formatting preserves data and changes its layout" (Control, Control+Alt,
  and Shift+Alt+F).
- `integration-test/tests/editors/video/video.test.mjs`: "Video Player submitUrl plays an HTTP
  fixture and Enter submits the expanded URL field" (Control+A).
- `integration-test/tests/sidebar/search/search.test.mjs`: "Explorer name search filters entries
  and restores expanded folders when cleared" (Control+F).
- `integration-test/tests/editors/folder/folder-view.test.mjs` and
  `integration-test/tests/sidebar/explorer/explorer.test.mjs`: input-dialog tests using
  `sidebar-helpers.mjs` `answerInputDialog` (Control+A).

Claude runs the integration suite; this plan adds no test harness. The fake microphone already
comes from owned test launches as described in `doc/standards/integration-tests.md`.

## Concerns

No implementation-blocking question remains. Reuse the proven event fields in
`integration-test/tests/helpers/shell-helpers.mjs:38-40`; preserve the distinction between the
app window and a browser guest, and do not route board rules or a new board shortcut policy into
the automation layer. There is no new UI text, no translation work, no `window.persephone` API
change, and no board bridge version change planned.

## Acceptance Criteria

- [x] `src/main/cdp-key-input.ts` owns Electron keyboard dispatch and accepts already-resolved
   `WebContents`; `src/main/cdp-service.ts` only exposes its existing resolver with zero net line
   growth, while board-frame keys remain on CDP.
- [x] `src/ipc/main/cdp-handlers.ts` remains a thin guarded registrar: it is currently 20 lines
   and is not listed as a god file in the roadmap; add only the import and handler registration.
- [x] Shortcut `window.screen.pressKey`, browser `pressKey`, `keyDown`, and `keyUp` reach the app
   window or selected browser guest via Electron input, with held modifiers preserved. Plain keys
   and Shift-only combinations remain on CDP; explicit synthetic input remains the DOM-event
   compatibility path. A matching key-up uses the route recorded at key-down.
- [x] App Ctrl+=, Ctrl+-, and Ctrl+0 update `window.zoomLevel`, asserted through the call tree.
- [x] `Alt+V` starts voice typing with the owned test instance's fake microphone, and the fixture
   transcription reaches the page content; the test declares `requires: ["launch"]`.
- [x] Browser guide caveat is removed and the app-screen guide accurately describes shortcut
   support.
- [x] Existing keyboard input and shortcut assertions remain intact; no assertion is weakened.
- [x] No test or suite is run by Codex; Claude runs the UI integration suite.
- [x] Add no unit tests or test harnesses. Add no English UI catalog message; if implementation
  later needs one, place it in `src/shared/i18n/en/` and leave translation to epic close.
- [x] Do not edit `C:\projects\persephone-boards`, `node_modules/ai-vision`, or the
  `github:andriy-viyatyk/ai-vision` package; do not publish or bump that package.
- [x] Do not change `window.persephone`, add a board rule, grow a roadmap §2.3 god file, add
  `await import()` or an import-zone wrapper, or edit the roadmap. If a `window.persephone` change
  becomes necessary, stop this plan and include the required `BOARD_BRIDGE_VERSION` bump and
  history line in scope.

Files inspected and planned for no change: `src/main/open-window.ts` (existing app shortcut
owner), `src/main/browser/BrowserGuest.ts` (existing guest shortcut owner),
`src/renderer/automation/keyboard.ts` (shared API entry points),
`src/renderer/automation/AppTargetModel.ts`, `src/renderer/editors/browser/BrowserTargetModel.ts`,
`src/renderer/automation/forms.ts`, `src/renderer/automation/input-session.ts`,
`integration-test/run.mjs`, the integration-test host and all test harness code,
`doc/active-work.md`, `doc/epics/EPIC-199.md`, `doc/reviews/refactoring-roadmap.md`,
`BOARD_BRIDGE_VERSION` and its history, `src/shared/i18n/en/` and language packs,
`C:\projects\persephone-boards`, `node_modules/ai-vision`, and the ai-vision npm package.
`doc/standards/integration-tests.md`, `.claude/skills/ui-tests/SKILL.md`, and
`assets/guides/agents/web-app-tests.md` are reference documents only.

## Files Changed

| File | Planned change |
|------|----------------|
| `src/renderer/automation/input.ts` | Route shortcut key down/up through the target input seam; preserve plain key and synthetic paths |
| `src/renderer/automation/CdpSession.ts` | Expose the established IPC request for target keyboard input |
| `src/ipc/browser-ipc.ts` | Declare the typed input request in the existing BrowserChannel family |
| `src/ipc/main/cdp-handlers.ts` | Register the request through the existing guarded invoke pattern |
| `src/main/cdp-service.ts` | Export the existing `resolveTarget()` declaration only; no net growth |
| `src/main/cdp-key-input.ts` | Own keyboard dispatch through `WebContents.sendInputEvent()` |
| `integration-test/tests/shell/shortcuts/shortcuts.test.mjs` | Add call-tree keyboard zoom cases |
| `integration-test/tests/capabilities/voice/voice-typing.test.mjs` | Add Alt+V fake-microphone coverage and remove stale comment |
| `integration-test/tests/browser/automation/input/input.test.mjs` | Add browser guest F5 reload coverage |
| `assets/guides/agents/browser.md` | Remove the browser shortcut caveat |
| `assets/guides/agents/pages.md` | Clarify app-screen shortcut support |
| `doc/tasks/US-2123-presskey-main-shortcuts/README.md` | This task plan |
