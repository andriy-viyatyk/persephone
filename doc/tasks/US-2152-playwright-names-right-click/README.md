# US-2152: Playwright names and automation right-click

[EPIC-203](../../epics/EPIC-203.md) · proposals H1, H2 and A5 · feedback [12, 15 and 22](../US-2138-web-app-test-feedback/README.md)

## Goal

Make common Playwright guesses work or return a concise Persephone equivalent, and keep automated right-clicks from opening Persephone's browser menu by default.

## Background

EPIC-203 decisions 1–6 and 9 bind this task. Implement after US-2150 and US-2151, rebasing on their actual interfaces. `focus` is US-2150's real member, not an alias. Role locators and the proper boolean visibility query are later roadmap work; `role=...` is not a supported selector today.

`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` describes `BrowserEditor` with `BROWSER_AUTOMATION_MEMBERS` from `src/renderer/scripting/ai-vision/browser-automation-members.ts` and its own editor members. `AutomationSurface.ts` delegates shared input to `src/renderer/automation/`; `forms.ts` selects and clears existing content before inserting, so `type` replaces rather than appends, as Playwright `fill` does. Native date/time/color/range inputs use validated assignment and untrusted events. `select` takes string value(s), not Playwright's full option-object grammar. `pressKey` takes the key first and an optional `{ target }`, not a locator-first argument.

The installed npm dependency is ai-vision 1.4.0 (`package.json` / lockfile). In `node_modules/ai-vision/dist/core/resolver.js` a descriptor member or live child must exist before `provide` is consulted; `provide` alone cannot make an unlisted method callable. `IAiMember` has no hidden flag. `hint.js` prints descriptor members in `$help`, hints and `$describe`; `errorAt` calls `findMemberSuggestions` and `formatSuggestions` even with `hints: "never"`. `src/test-host/client.ts` preserves `Did you mean` and only adds fallback text when absent (EPIC-202 decision 9). The dependency therefore needs a durable extension, not an edit to ignored `node_modules`. This repository already runs `patch-package` in postinstall.

`BrowserGuest` (`src/main/browser/BrowserGuest.ts`) receives Electron webContents `context-menu`, prevents Electron's default, and forwards its fields as `BrowserChannel.event`; `BrowserWebviewModel` routes it to `showBrowserContextMenu` in `src/renderer/editors/browser/webview-context-menu.ts`. `src/renderer/automation/mouse.ts` sends trusted CDP `Input.dispatchMouseEvent` through `CdpSession.send`; `src/main/cdp-service.ts` resolves the registration and dispatches to the guest webContents. `clickElement` supports `button: "right"`; `clickAtCoordinates` also accepts a button, and US-2150 adds browser coordinate calls. The menu event includes coordinates but no documented input-origin identifier. The `synthetic` click path currently calls `el.click()` and does not send a right-button contextmenu.

## Implementation Plan

- [x] **ai-vision extension:** create `patches/ai-vision+1.4.0.patch` with the existing `patch-package` workflow; do not publish a release or edit `C:/projects/ai-vision`. The existing files `patches/monaco-editor+0.57.0.patch` and `patches/vite-plugin-monaco-editor-esm+2.0.3.patch` establish the exact `<package>+<version>.patch` convention. Patch the installed package's `dist/core/resolver.js`, `hint.js`, `member-suggestion.js` where needed, and matching `.d.ts` declarations. Add `IAiMember.hidden?: boolean`: the resolver still finds the member, while `$help`, hints, `$describe` member lists and fuzzy suggestions filter it out. Add `IAiVisionDescriptor.suggest?(name: string): string | undefined`; `errorAt` consults it for `unknownMember` before the existing fuzzy suggestion, formatting its return as a one-line `Did you mean ...?` without adding an error path. Preserve existing behavior for other nodes, `hints` modes, and remote descriptor visibility. Extend `EditorFacadeDescription` and `describeEditor` in `src/renderer/scripting/api-wrapper/EditorFacadeBase.ts` to pass `suggest` through. The patch applies to a clean cached ai-vision 1.4.0 package and `npm run postinstall` reapplies it.
  - [ ] `npx patch-package ai-vision` could not finish generation because sandboxed child `git init` returned EPERM; the same intended diffs were generated from the cached clean package and verified with patch-package's parser and postinstall.
  - [ ] A second full offline `npm install` against a clean ai-vision folder could not reach postinstall because npm lacked cached `react-dom` metadata; the standalone postinstall application succeeded.
- [x] **Alias owner:** add `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts`, a browser-only static table of descriptor members with `hidden: true` plus bound alias implementations operating on the existing facade. Wire it into `BrowserEditorFacade`'s descriptor and `provide`, retaining access restrictions and `this` binding. No new browser rule belongs in shared board code. Support path calls with `args` and inline JSON calls; return precisely the target's result and errors. Do not accidentally install aliases on boards or `window.screen`.

  | Hidden alias and accepted arguments | Existing implementation to reuse |
  |---|---|
  | `dblclick(locator, options?)` | `click(locator, {...options, clickCount: 2})`; force 2 even if supplied |
  | `fill(locator, text, options?)` | `type(locator, text, options)`; replaces the value |
  | `press(key, options?)` | `pressKey(key, options)`; use `{target: locator}` for a target |
  | `goto(url, options?)` | `navigateAndWait(url, options)`, returning `{url, status}` |
  | `selectOption(locator, values, options?)` | `select(locator, values, options)` with string or string array |
  | `setChecked(locator, checked, options?)` | validate boolean; `check` for true, `uncheck` for false, including existing radio restriction |
  | `textContent(locator, options?)`, `inputValue(locator, options?)` | `getText`, `getValue` respectively; both return `string | null` |
  | `waitForTimeout(ms)` | `wait(ms)` in milliseconds |
  | `goBack(options?)`, `goForward(options?)` | `back`, `forward`; same navigation result and history errors |

  All listed targets exist in the facade and describe tables. Do **not** add `isVisible` as an alias: `exists` is an existence query and `waitForSelector(..., {state: "visible"})` is a wait that rejects on timeout, not a cheap boolean query. Put it in the suggestion table until D4. Do not add a `focus` alias.
- [x] **Suggestion owner:** in the same browser-only collaborator define exactly one static map and implement `suggest(name)` as its lookup, attached only to the browser editor descriptor. Examples: `getByRole` → use a CSS selector such as `button[aria-label="Save"]`, or `text=Save` with an action; role/name accessible matching is not available yet. `locator` → pass CSS or `text=` directly to `click`/another action. `waitForLoadState` → `waitForNavigation({waitUntil: ...})` (a navigation wait, not an arbitrary current load-state query). `isVisible` → `waitForSelector(selector, {state: "visible"})` waits and may time out. `$` → `exists`, `getText`, `getValue` or `evaluate` according to the desired result; `$$` → `evaluate` for multiple values, never promise element handles. `content` → `getHtml(selector)` for an element or `evaluate("document.documentElement.outerHTML")` for a document. `title` and `url` already exist as properties; `title()`/`url()` hit ai-vision's existing property-not-method message, so don't add unreachable unknown-member entries. `evaluate`, `screenshot`, and `reload` already exist as methods; don't add suggestions for them. `$` and `$$` are valid identifiers in the current path parser. Keep every suggestion one line and retain the `Did you mean` prefix.
- [x] **Right-click owner and ordering:** add `src/renderer/editors/browser/BrowserAutomationMenuGuard.ts` with `arm(tabId)`, `release(tabId)`, `consume(tabId): boolean`, tab cleanup and disposal. It owns a per-internal-tab count of pending automation menu requests. Each arm creates one entry; consume removes one for the first guest `context-menu` event on that tab. Release starts expiry for that entry, including after a failed CDP release; use one named and commented `AUTOMATION_MENU_GRACE_MS` constant, approximately 500 ms. Keep entries individually expirable so multiple clicks and failures cannot leave stale counts. A consumed entry must not be recreated by its subsequent release. Arm one entry for each right-button press in a multi-click, and pair every arm with release in `finally` even if a dispatch fails.
- [x] Construct and own the guard in `src/renderer/editors/browser/BrowserEditor.ts` alongside `BrowserTargetModel`; clear its tab in `releaseTab` and dispose it with the editor. Add optional `automationContextMenu?(tabId, phase: "arm" | "release")` to `IAutomomationTarget` in `src/renderer/automation/types.ts`. Only `BrowserTargetModel` implements it, delegating to the guard using the resolved internal tab ID; capture the actual tab before the press so a tab switch cannot move the release to another tab. Keep popup IDs distinct from internal tabs; do not suppress an unrelated internal tab. In `src/renderer/automation/mouse.ts`, `clickElement` and `clickAtCoordinates` invoke this hook around each right-button press/release when `nativeMenu !== true`, reusing `dispatchMouseEvent`; no browser-menu policy enters shared automation. App and board targets have no hook and retain their behavior. The existing synthetic path still uses `el.click()` and does not generate a right-button menu.
- [x] In the existing `context-menu` case of `src/renderer/editors/browser/BrowserWebviewModel.ts`, check `guard.consume(internalTabId)` before `showBrowserContextMenu` and skip the menu when consumed. This is minimal delegation in a roadmap section 2.3 god file. The guest event is the browser's menu request after the page had its chance; do not prevent the page's DOM `contextmenu` handler. No main-process or IPC change.
- [x] Add `nativeMenu?: boolean` to `IBrowserClickOptions` in `src/renderer/api/types/browser-editor.d.ts`, its shipped mirror `assets/editor-types/browser-editor.d.ts`, and `ClickActionOptions` in `src/renderer/automation/locator.ts`; include the option on the coordinate interface introduced by US-2150. Update `click` in `browser-automation-members.ts` and `BROWSER_EDITOR_HELP` for `clickCount: 2`, the default/opt-in and page handler behavior. This shared table is also used by other hosts: explain that native-menu policy applies to browser guests. Update US-2150's coordinate describe entry and any applicable `window.screen` entry only if its signature changes. `scripts/describe-tables-check.mjs` checks public facade methods against descriptor tables, not descriptor entries against public methods. These aliases are bound via `provide`, not facade methods, so no `METHOD_ALLOWLIST` entry is needed. Its `importedSource` recognizes only named existing tables: extend it to recognize the new static alias table so the static spread is parsed without a dynamic-member diagnostic; retain hidden entries in the descriptor, not the visible rendered list.

  Before → after (illustrative call surface):

  ```js
  // Before: equivalent existing calls
  await editor.click("#item", { clickCount: 2 });
  await editor.type("#name", "Ada");
  await editor.click("#item", { button: "right" }); // may open Persephone menu
  // After
  await editor.dblclick("#item");
  await editor.fill("#name", "Ada");
  await editor.click("#item", { button: "right" }); // page handler runs, no Persephone menu
  await editor.click("#item", { button: "right", nativeMenu: true });
  ```

- [x] **Board contract:** `src/renderer/api/boards/board-host-rpc.ts` invokes the same `resolveAiCall` with `hints: "never"` and throws its error text. Browser-editor aliases and tailored unknown-name errors are reachable through `persephone.call()` and change what a board receives; right-click behavior changes too. Existing successful results retain shape and key order; existing error codes need not change, but error text for mapped unknown names does. New alias results exactly follow their targets. US-2150 bumps `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from 1.58.0 to 1.59.0 and writes the 1.59.0 history line. US-2152 extends that same line in `assets/guides/agents/boards/bridge-versions.md` with aliases, browser-editor suggestions and the automation right-click default; **do not bump again**.
- [x] Extend US-2150's existing 1.59.0 history line in `assets/guides/agents/boards/bridge-versions.md` with browser aliases, suggestions and default automation right-click behavior; keep the browser and web-app guide sentences deferred to epic `/userdoc`, as instructed.
- [ ] At epic `/userdoc`, add sentences to `assets/guides/agents/browser.md` (aliases, type replacement, double-click, right-click, opt-in and the accepted brief physical-click limitation in Concerns) and `assets/guides/agents/web-app-tests/index.md` (double-click, right-click and one-line guidance). `npm run guides:check` was attempted but esbuild could not start its service because the sandbox returned EPERM.
- [x] Run `npm run describe-tables:check`, `npm run lint`, and `npm run typecheck`; `src/renderer/automation` is in `scripts/typecheck-strict.mjs` and must remain strict. No new tests or harnesses. Observe import zones: no `await import()` or wrapper to evade a zone. Roadmap §2.3 names `BrowserWebviewModel.ts` and `src/main/cdp-service.ts` as god files: only minimal delegation in `BrowserWebviewModel.ts`; new policy belongs to the renderer collaborator and `cdp-service.ts` is unchanged. Reuse existing CDP routing; add no board rules outside `src/shared/board/` / registries.

### Live verification by Claude

Use a local test page with an editable input, checkbox, select, a double-click target and an element without a page menu. Open it in an agent-accessible browser page and use the Persephone MCP `call` tool with `path: 'pages["<id>"].editor.<member>'`, `args: [...]`, `hints: "never"`.

1. Call each alias once against its canonical member; compare behavior and results, including replacement, check/uncheck and navigation results. Confirm `editor.$help` does not list the aliases.
2. Call `getByRole`, `locator`, `waitForLoadState` and `isVisible`; each gives a one-line `Did you mean` response. Check that a plain typo still receives a fuzzy suggestion.
3. Right-click the element without a page menu and immediately make another call; it succeeds without "popup menu is open". Repeat with `{ nativeMenu: true }`, verify the menu opens and close it via `windows[i].menus[0].close()`.

## Concerns

- **Decision - A5 renderer guard:** use per-tab consume-once entries and a short expiry; the existing event reaches the renderer, so no main-process or IPC change is needed. A physical right-click on the same tab during the grace window after an automation right-click whose page prevented the menu (and thus consumed no entry) can lose its Persephone menu once. This is accepted: the interval is short, bounded and per tab; the consequence is a missing menu, not a wrong action. State this limitation in the browser guide.
- **Decision - ai-vision patch:** patch the installed 1.4.0 dist with the minimal future-upstream API and do not publish or edit the separate ai-vision repository during this run. The installed package lacks both required extension points. Follow up later by upstreaming the patch into ai-vision and dropping the local patch.
- **Decision - hidden descriptors and lint:** aliases are `hidden: true` descriptor members resolved via `provide`, not public facade methods. The checker only requires descriptions for public facade methods; no allowlist entry is needed. Teach its static table reader the new imported table so it can inspect the descriptor.
- **Decision - one epic bridge version:** extend US-2150's 1.59.0 history entry rather than bumping again, so the epic's related changes share one bridge version. Board-observable aliases, suggestion errors and right-click behavior are recorded there.
- **Decision - live verification scope:** Claude checks the specified aliases, suggestions and menu behavior using MCP calls; concurrent physical clicks, iframes and repeated board calls are outside this live list because Claude cannot make a physical click.
- **Decision - file scope:** keep the guard, lifecycle and hook in renderer collaborators, and leave the main-process and IPC files unchanged; the existing event route is sufficient.
- `press` intentionally has Persephone's key-first signature; `selectOption` supports only existing value strings. State these narrower forms in help/guide text. `$help` long-form guidance may mention examples, but its member lists remain short.

## Acceptance Criteria

- [ ] All table aliases work through `call`, delegate once to their canonical operation, preserve results and target errors, and stay out of member lists; no `isVisible` or `focus` alias.
- [ ] Browser-only exact suggestions and existing fuzzy suggestions use the same ai-vision unknown-member path, including with `hints: "never"`; existing members and property errors remain intact.
- [ ] Trusted automation right-click defaults to no Persephone menu; opt-in opens it and page handlers run. Guard entries are consumed once or expire per tab, subject to the accepted physical-click limitation in Concerns; other tabs and app/board targets are unaffected.
- [ ] US-2150's 1.59.0 bridge history line reflects these board-observable calls without another version bump; describe-table, lint, typecheck and applicable guide checks pass; Claude's live checks pass. No test harness or unit tests are added.

## Files Changed

| Path | Planned change |
|---|---|
| `patches/ai-vision+1.4.0.patch` | Hidden descriptor members and exact suggestions in the existing resolver/renderers and declarations. |
| `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts` | Browser-only hidden descriptors, bound implementations and static suggestions. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `src/renderer/scripting/api-wrapper/EditorFacadeBase.ts` | Attach browser descriptor data and pass the suggestion hook through. |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts` | Describe click option and double-click; update US-2150 coordinate descriptor where it actually lives. |
| `src/renderer/automation/mouse.ts`, `src/renderer/automation/locator.ts`, `src/renderer/automation/types.ts` | Shared right-button hook calls and typed options/optional target hook. |
| `src/renderer/editors/browser/BrowserAutomationMenuGuard.ts` | New per-tab consume-once and expiry policy. |
| `src/renderer/editors/browser/BrowserEditor.ts`, `src/renderer/editors/browser/BrowserTargetModel.ts` | Own and dispose guard; delegate target hook. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | One guard check before opening the menu. |
| `src/renderer/api/types/browser-editor.d.ts`, `assets/editor-types/browser-editor.d.ts` | Public click option and applicable browser aliases/coordinate declarations. |
| `scripts/describe-tables-check.mjs` | Recognize the imported static alias table; no allowlist entry. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend US-2150's existing 1.59.0 line; no version bump. |
| `assets/guides/agents/browser.md`, `assets/guides/agents/web-app-tests/index.md` | User-guide sentences at epic `/userdoc`. |

No changes planned in `src/renderer/automation/CdpSession.ts`, `src/ipc/browser-ipc.ts`, `src/main/cdp-service.ts`, `src/main/browser/BrowserGuest.ts` (existing CDP and event routes), `src/shared/board-bridge-version.ts` (US-2150 owns the single bump), `src/renderer/editors/browser/webview-context-menu.ts` (menu construction), `src/test-host/client.ts` (already preserves suggestions), `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` (no browser aliases), `doc/active-work.md` or `doc/epics/EPIC-203.md`.
