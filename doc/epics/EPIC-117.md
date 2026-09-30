# EPIC-117: Trusted browser automation — real input, actionable locators, agent-sized snapshots

## Status

**Status:** Completed
**Created:** 2026-09-29
**Completed:** 2026-09-30

## Overview

The Playwright-like automation surface (`pages[i].editor.*` on browser and board pages,
`window.screen.*` for Persephone's own window) drives pages with **synthetic DOM events**:
`el.click()`, hand-built `KeyboardEvent`s, and `value` assignment. Chromium treats none of these as
user input, so default actions never happen. Tab does not move focus, Enter does not submit or pick
an autocomplete suggestion, and Ctrl+C/V/A do nothing. Every such call still reports success, and
agents get lost.

This epic moves input onto the CDP `Input` domain, which Chromium treats as real user input. It
checks that an element can actually be acted on before every action, and gives agents snapshots
small enough to use. It also fills the Playwright gaps that matter for testing users' web apps:
dialogs, console, drag, file upload, and fuller waits and screenshots.

## Goals

- Click, hover, type, press-key and check produce **trusted** events (`isTrusted: true`,
  user activation, default actions, real clipboard) on browser pages, boards and the app window.
  `select` on a native `<select>` stays programmatic, as in Playwright: the popup is browser
  chrome. Custom dropdowns are driven by trusted click and keys.
- Every element action checks first: attached, visible, stable, enabled, and not covered at the
  click point. It fails with a message that names the cause, never a silent no-op.
- An agent can see a large app such as Gmail in a few calls: scoped and interactive-only
  snapshots, a size budget, and markers for clickable non-semantic elements.
- The page cannot wedge automation. JS dialogs are handled by policy, and console messages and
  page errors can be read.
- Waits and navigation report what happened (loaded, failed, timed out on X) and always fail
  inside the MCP request timeout with their own message.
- One shared operation set across the three hosts, with no dead adapter code.

## Background (verified 2026-09-29)

### Code map

- `src/renderer/automation/operations.ts`: the shared, target-neutral operations. The browser
  facade (`scripting/api-wrapper/BrowserEditorFacade.ts`), the board facade (`BoardEditorFacade.ts`)
  and `window.screen` (`api/window-screen.ts`) all call it.
- `src/renderer/automation/input.ts` holds the key table (from Playwright's `USKeyboardLayout`) and
  the type and fill strategies. `ref.ts` resolves refs (`e123` = backendDOMNodeId; `f1-e456` =
  iframe session). `snapshot.ts` turns the AX tree into Playwright-style YAML.
- There are three `IBrowserTarget` hosts:
  - `BrowserTargetModel`: its own `<webview>` WebContents, with the debugger attached directly.
  - `BoardTargetModel`: a `board://` OOPIF inside the host window. `cdp-service.ts` routes
    commands to the frame's flattened session; screenshots already clip the host page to the
    iframe rect.
  - `AppTargetModel`: the calling window's top-level session.
- `src/main/cdp-service.ts` handles attach, detach and send for all three.
- `src/renderer/automation/commands.ts` (`handleBrowserCommand`, the old `browser_*` dispatcher,
  about 300 lines) has **no importers**. It is dead code, still listed in
  `architecture/browser-editor.md` and `key-files.md`.
- The shared member list is `scripting/ai-vision/browser-automation-members.ts` (ten operations:
  snapshot, click, hover, type, select, pressKey, evaluate, waitFor, screenshot, networkRequests).
  Browser pages add `check`, `uncheck` and `clear` (selector-only), plus `getText`, `getValue`,
  `getAttribute`, `getHtml`, `exists`, `waitForSelector` and `waitForNavigation`.

### The premise in the code is wrong

`input.ts` and `AppTargetModel.ts` state that CDP `Input.dispatchKeyEvent` / `Input.insertText`
"do NOT work in Electron `<webview>`". On Electron 43, with the debugger attached to the guest
WebContents (as `cdp-service.ts` does), this is false. Measured 2026-09-29 through the existing
`browser:cdp-send` channel on a test page in a browser tab:

| CDP call | Observed |
|---|---|
| `Input.dispatchMouseEvent` pressed/released at an element's center | `mousedown`, `mouseup`, `click` all `isTrusted: true`, `navigator.userActivation` granted |
| `Input.dispatchKeyEvent` Ctrl+C on a selected `<input>` | trusted `copy` event; the text reached the **OS clipboard** |
| `keyDown` with `text`, then `Input.insertText` | typed into the input; `input` events trusted |

Coordinates are CSS pixels of the webview's main-frame viewport, taken from
`getBoundingClientRect()`. No DPI or window mapping is needed.

**Not Win32 messages.** An Electron window, webviews included, is one HWND. `PostMessage`
does not update keyboard state, so modifiers break. `SendInput` moves the user's real cursor and
needs the foreground. CDP input enters the same Chromium input pipeline without touching the OS
cursor or focus. `webContents.sendInputEvent()` is the fallback if CDP input ever regresses.

### Gmail runs (2026-09-29): the acceptance scenario

Task: compose and send a test email to the user's own work mailbox.

| Run | Calls | Outcome |
|---|---|---|
| Hand-written selectors, current methods | 3 | Sent. The recipient stayed plain text (no chip), and Gmail happened to accept it. |
| Blank test agent (`mcp-test-agent-call`), current methods, snapshots and refs | **79** (~10 min) | Sent after a detour. The first send had no recipient and was saved as a draft. Gmail showed an "Error" alertdialog on the final send. |
| Trusted CDP input, prototype script | 4 | Sent. A real Enter picked the autocomplete suggestion and made a recipient chip. Real Ctrl+A / Ctrl+C copied the body. Real Ctrl+Enter sent with no error. |

The test agent's failures, by cost:

1. **Snapshot size.** Gmail's snapshot was about 52 000 characters, above the `call` result cap.
   The compose dialog was cut off, so the agent guessed selectors instead.
2. **`type` crashes on non-input elements**: `TypeError: Illegal invocation` on a `<div>`, and even
   on `<html>`. With `elementKind === "unknown"`, `typeText` falls back to `fillInput`, which calls
   `HTMLInputElement.prototype`'s `value` setter on a non-input (`input.ts`, the final `else`
   branch).
3. **First-match selectors.** `type("input, textarea", …)` filled an unrelated field and reported
   success.
4. **Synthetic keys have no default action.** Enter could not choose the autocomplete
   suggestion. Ctrl+Enter worked only because Gmail listens for that shortcut itself.
5. **Opaque waits.** `waitFor` defaults to a 30 000 ms timeout, the same as the MCP renderer request
   timeout (`src/main/mcp/renderer-bridge.ts`, `REQUEST_TIMEOUT_MS`). The agent sees a bare
   "Request timeout", never "selector X not found".

### Other defects found in review

- **click** calls `el.click()` with no hit-test, so clicking a covered element "succeeds".
- **hover** fires only `mouseenter`/`mouseover`: no `mousemove`/pointer events and no CSS `:hover`.
- **`type(…, { slowly })`** calls `insertText` per character, so no key events fire despite the
  name. **`submit`** uses the synthetic Enter, so forms do not submit.
- **select** uses only the first value (multi-select is ignored), fires no `input`, and never
  checks that the option exists.
- **waitFor** polls with `requestAnimationFrame`, which is throttled or paused in hidden documents.
  The timeout is checked inside that loop, so it can stall. It also reads `document.body.innerText`
  every frame.
- **navigateAndWait** polls `readyState` with silent 2 s / 10 s caps. It never reports a failed
  load, and has no forward, URL wait, or network-idle option.
- **JS dialogs** are unhandled. An `alert()` or `confirm()` blocks the page, and every later
  `evaluate` hangs.
- **No console-message or page-error access.**
- **Snapshot:**
  - Names are not escaped, so a `"` breaks the line.
  - Iframe subtrees are matched to `- Iframe` placeholders by order.
  - Clickable roleless elements carry no marker (Playwright emits `[cursor=pointer]`).
  - There is no scoping and no interactive-only mode.
- **Selectors** support CSS only: no text or role locators, no shadow-DOM piercing, and no way into
  iframes (refs can reach iframes).
- **Backlog item folded in.** After an `about:blank` navigation, the CDP execution context still
  answers from the old document (`tasks/backlog.md`, "A browser tab's CDP session keeps the old
  document after an `about:blank` navigation").

## Design decisions

1. **Trusted input via the CDP `Input` domain is the default for every host.** A per-call
   `{ synthetic: true }` keeps the old JS path for pages where trusted input is unwanted.
   **There is no silent fallback.** If trusted dispatch fails, the call fails. Falling back quietly
   would bring back the "reported success, nothing happened" failure this epic removes.

2. **One input engine, one pipeline per element action:**

   ```
   resolve (selector | ref) → strictness check → scrollIntoView → actionability
     → point (center, or options.position) mapped to the dispatch session's viewport
     → hit-test at the point → Input.dispatchMouseEvent / dispatchKeyEvent / insertText
   ```

   Actionability follows Playwright:
   - **attached, visible** (non-zero box, not `visibility:hidden`);
   - **stable** (same rect across two animation frames, bounded time);
   - **enabled** (no `disabled`, no `aria-disabled="true"`);
   - **receives events** (`elementFromPoint` at the point is the element or a descendant).

   A failure names the reason and, when an element covers the point, which element.
   `{ force: true }` skips every check, including a failing hit-test, and dispatches at the point anyway. Actionability retries until a timeout (default 5 s, below the request timeout); only an ambiguous match fails at once.

3. **Coordinate mapping belongs to the target.** `IBrowserTarget` gains an input-dispatch seam
   (an input session and a frame-offset resolver):
   - **Browser page:** main-frame viewport coordinates, verified. For an element inside a
     cross-origin iframe, dispatch on the top-level session with the iframe's accumulated offset.
   - **Board:** dispatch on the **host window's top-level session**, adding the board iframe's rect
     (the same rect `boardSend` already computes for screenshots). Not yet verified; see Risks.
   - **App window:** top-level session.

4. **Keyboard is trusted too.**
   - `pressKey` sends `rawKeyDown`/`keyDown` + `keyUp` with `windowsVirtualKeyCode`, `code`,
     `location`, and `text`/`unmodifiedText` for printable keys. It reuses the existing key table
     and stops sending the fake `keypress`.
   - `type` focuses by trusted click, selects existing content (trusted Ctrl+A, or `select()` for
     inputs), then calls `Input.insertText`.
   - `slowly` means real per-key down/char/up. `submit` means a trusted Enter.
   - New: `keyDown`/`keyUp` for held modifiers, and multi-key sequences.
   - The `Illegal invocation` fallback is removed. A non-editable target is an error that says
     what the element is.

5. **Strict locators.** A selector that matches more than one *visible* element is an error that
   reports the count and suggests a ref or a narrower selector (Playwright's strict mode).
   `{ nth }` or a `:nth-match`-style option chooses explicitly. Hidden duplicates are ignored, as
   the current `focusElementBySelector` already does.

6. **Snapshots sized for agents.**
   - `snapshot({ root, interactive, maxNodes })`: `root` is a selector or ref for the subtree.
     `interactive` keeps only elements an agent can act on, plus the headings and landmarks that
     give them context.
   - Clickable roleless elements get `[cursor=pointer]`.
   - Names are escaped. Iframe subtrees are joined by frame id, not by order.
   - An oversized snapshot ends with a hint that suggests `root` or `interactive`, instead of being
     cut off mid-tree.

7. **Page events are recorded by `cdp-service.ts` per WebContents or frame session:** JS
   dialogs, console messages, page errors.
   - Dialogs follow a policy the agent can set, `dialogs({ policy: "accept" | "dismiss" | "manual" })`.
     The default is `dismiss`, recorded so the next action's result reports "a confirm() was
     dismissed". Under `manual`, `handleDialog(accept, promptText?)` handles the waiting dialog.
   - `consoleMessages({ since?, level? })` and `pageErrors()` read ring buffers.

8. **Waits run on timers and page events, not animation frames.**
   - Navigation uses the `Page` lifecycle events: `load`, `DOMContentLoaded`, and a
     `networkIdle` option. It reports HTTP and network failures.
   - A wait's default timeout always sits below the renderer request timeout, so its own message
     arrives first. The request timeout itself is raised for a call that declares a longer wait.
   - Execution contexts are tracked by `Runtime.executionContextCreated`/`Destroyed`, so `evaluate`
     never runs in a replaced document (this fixes the `about:blank` bug).

9. **Clipboard.** Trusted Ctrl+C/V use the real OS clipboard; that is what testing a web app
   means. The guide says so. Persephone does not snapshot or restore the clipboard on the agent's
   behalf.

10. **Unchanged:** the incognito/Tor privacy guard, the app-window refusal while a private page is
    active, and page activation before a browser or board command.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1568](../tasks/US-1568-trusted-mouse-input/README.md) | Trusted mouse input engine: input-dispatch seam on `IBrowserTarget` (browser, board, app window), actionability + hit-test, strict locators; click, dblclick, right-click, modifiers, position, hover on CDP `Input` | Completed |
| [US-1569](../tasks/US-1569-trusted-keyboard-input/README.md) | Trusted keyboard and text: `pressKey`, `keyDown`/`keyUp`, `type` (fill, `slowly`, `submit`) on CDP `Input`; remove the `Illegal invocation` fallback; `select` multi-value + validation; `check`/`uncheck`/`clear` by ref, moved into shared operations | Completed |
| [US-1570](../tasks/US-1570-page-events/README.md) | Page events: JS dialog policy and `handleDialog`, console messages, page errors; execution-context tracking (fixes the `about:blank` stale-document bug) | Completed |
| [US-1571](../tasks/US-1571-waits-and-navigation/README.md) | Waits and navigation: lifecycle-event navigation with failure reporting, `forward`, `waitForURL`, element-state waits, timer-based polling, wait timeouts inside the request timeout | Completed |
| [US-1572](../tasks/US-1572-agent-sized-snapshots/README.md) | Agent-sized snapshots: `root`, `interactive`, size budget with hint, `[cursor=pointer]`, name escaping, iframe join by frame id | Completed |
| [US-1573](../tasks/US-1573-playwright-operations/README.md) | Missing Playwright operations: drag, `fillForm`, file upload (`DOM.setFileInputFiles`), element and full-page screenshots, `evaluate` with arguments, viewport resize; one member set across the three hosts | Completed |
| [US-1574](../tasks/US-1574-cleanup-guide-qa/README.md) | Cleanup, guide and QA: delete `automation/commands.ts`, correct the stale comments and docs, rewrite `guides.agents.browser`, add the Gmail compose scenario to `qa/` | Completed |
| [US-1575](../tasks/US-1575-network-responses/README.md) | Network responses: waitForResponse, response bodies, and log retention | Completed |

**Order.** US-1568 first. It builds the dispatch seam and settles the one unverified mapping (the
board OOPIF), and every other input task builds on it. US-1569 follows. US-1570, US-1571 and
US-1572 do not depend on each other and may run in any order after US-1568. US-1572 can even
start first: it removes the agent's biggest cost in the Gmail run and does not touch input.
US-1573 comes after US-1569. US-1574 comes last.

**Delegation.** Codex writes each task document and implements it. Claude reviews each plan
against the source and runs the live checks below.

## Acceptance

- The Gmail scenario, run by a blank `mcp-test-agent-call` agent on the snapshot and ref path
  (evaluate for read-only checks only):
  - sends to the right recipient, with the recipient as a chip;
  - leaves no stray draft and triggers no error dialog;
  - takes **no more than 20** automation calls (79 before).
- The same test page used on 2026-09-29 records `isTrusted: true` for click, hover (`mousemove`,
  `pointerover`), keys and `input`, from all three hosts.
- Tab moves focus, Enter submits a form, and Ctrl+A / Ctrl+C / Ctrl+V act on the page.
- Clicking a covered element fails with a message naming the covering element.
- An `alert()` opened by the page does not hang the next call, and the result reports the dialog.
- A `waitFor` that never matches fails with its own message, not "Request timeout".

## Risks / abort criteria

- **Board coordinate mapping is unverified.** Board frames are cross-origin iframes in the host
  window, so input has to go through the host's top-level session plus the iframe offset. US-1568
  must prove this on a real board before the other tasks rely on it. If the host session cannot
  route input into the OOPIF, try `Input.dispatchMouseEvent` on the frame session. If that fails
  too, boards keep `synthetic` as their default and the epic continues for browser pages and the
  app window.
- **App-window focus.** `AppTargetModel.focusWebview` is a no-op so it never steals the user's
  window focus. Trusted keys go to the focused element of the target renderer. Verify they work
  while the Persephone window is in the background. If not, use `Emulation.setFocusEmulationEnabled`
  and never an OS-level focus call.
- **The user shares the window.** CDP events do not move the OS cursor, but a real mouse moving
  over the same page can change hover state between an agent's move and press. Dispatch
  move + press + release back to back and do not try to lock out the user.
- **Behaviour change for existing callers.**
  - Trusted Enter, Tab and Escape now do what a real key does. The browser preload's Ctrl+F and
    Escape handling (`architecture/browser-editor.md`) will see them as real presses.
  - Strict locators can reject selectors that used to pick the first match.
  - Boards are agent-authored (their scripts call these operations), so a board that relied on
    synthetic behaviour gets `{ synthetic: true }`, not a compatibility shim.
- **Hidden pages.** CDP input needs a laid-out, visible webview. Target resolution already
  activates the page. Keep that invariant in every new operation.

## Notes

### 2026-09-29
- Epic created after a live investigation. The CDP input measurements and the three Gmail runs
  above are its evidence. Test emails 1–3 went to the user's own work mailbox at their request.
- **Board risk cleared (live).** Trusted `Input.dispatchMouseEvent` reaches a board frame two ways:
  on the board's existing frame-routed session at frame-local coordinates, and on the host's
  top-level session at iframe rect + local point. A cross-origin iframe in a browser page
  behaves the same: its flattened session takes frame-local coordinates. So each element's
  input goes to the session its ref resolves in, and no frame-owner quad mapping is needed
  (US-1568).
- **Cross-target leak (live, US-1572).** `Target.getTargets` on a webview's session returns
  every target in the app: other webviews, the Persephone page, and other tabs' iframes. The
  snapshot's iframe discovery takes all of them, so one tab's snapshot can merge another tab's
  iframes, and an app-window snapshot can merge a background private tab's iframes. Discovery
  must keep only iframe targets that descend from the target's own id.
- **Found in passing, for US-1571:** `editor.navigate("data:text/html,…")` treats the URL as
  search text and loads a search page, while `pages.openUrlInBrowserTab` opens the same URL.

### 2026-09-30
- All seven tasks implemented by Codex from Claude-reviewed plans, and each live-verified by
  Claude. The verification found and fixed defects in every task; each task document's
  "Live verification" section lists them.
- **Acceptance met.** The blank-agent Gmail scenario went from 79 calls (baseline) to 55
  (first acceptance run) to **17** (after snapshot-value, guide-recipe and error-message fixes).
  The chip was committed first try, with no failed calls and no error dialog. See US-1574.
- Known limitations (documented in the guide): CSS `:hover` does not apply inside browser
  webviews; `select` is programmatic; element screenshots inside cross-origin iframes and
  cross-frame drags are unsupported; `fullPage` screenshots are browser-only.
- Not verified live: the dialog-policy interaction with a page `beforeunload` guard on reload.
- Epic-close `/review`, `/document`, `/userdoc` not yet run (user-initiated).

