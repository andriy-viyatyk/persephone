# Browser automation

Use `pages[i].editor` for browser pages and boards. Use `window.screen` for Persephone's own
visible window. Start with a narrow snapshot, then act on its refs:

```js
const view = await pages[id].editor.snapshot({ interactive: true });
// If the result names a shortened dialog or suggests a root, scope to that ref:
const form = await pages[id].editor.snapshot({ root: { ref: "e12" }, interactive: true });
await pages[id].editor.fillForm([
  { name: "To", locator: "input[name=to]", action: "type", value: recipient },
  { name: "Subject", locator: "input[name=subject]", action: "type", value: "A subject" },
]);
```

Snapshot refs must be passed as `{ ref: "e12" }`; a plain string always means a CSS selector.
Clickable roleless nodes carry `[cursor=pointer]`. The default snapshot budget is 18,000 characters
and the outer `call` result cap is 20,000. `# Shortened … Not shown: …` means lines were omitted;
use the suggested dialog/landmark ref as `root`, or narrow with `interactive`, `maxNodes`, or
`maxChars`. Iframe refs belong to the target page/frame that produced them.

## Hosts and members

For a page the user will use repeatedly with no `pages[pageId].editor.app` model, read
[Site extensions](./site-extensions.md) to build a reusable model.

All three hosts share these 21 operations:

| Member | Purpose |
|---|---|
| `snapshot` | Accessibility tree; accepts `root`, `interactive`, `maxNodes`, `maxChars`. |
| `click`, `hover` | Pointer actions; trusted CDP input by default. |
| `type`, `select`, `check`, `uncheck`, `clear` | Edit fields and toggles. |
| `pressKey`, `keyDown`, `keyUp` | Trusted keyboard input and held-key sequences. |
| `drag`, `fillForm`, `setInputFiles` | Drag, ordered form fill, direct file assignment. |
| `evaluate`, `waitFor`, `screenshot` | Page JavaScript, waits, and images. |
| `networkRequests`, `consoleMessages`, `pageErrors` | Recent recorded diagnostics. |
| `waitForResponse` | Wait for a matching response; optionally read its body. |

| Host | Additional members and boundaries |
|---|---|
| Browser page: `pages[i].editor` | `navigate`, `navigateAndWait`, `back`, `forward`, `reload`, `tabs`, `activeTab`, `addTab`, `closeTab`, `switchTab`, `wait`, `waitForSelector`, `waitForNavigation`, `waitForURL`, `getText`, `getValue`, `getAttribute`, `getHtml`, `exists`, `setViewport`, `clearViewport`, `dialogs`, `handleDialog`. Viewport, browser navigation/tab/query methods, network history, and JS dialog policy are browser-only. |
| Board: `pages[i].editor` | Board state (`boardRoot`, `folderPath`, `boardName`, `renderState`, `getManifest`, `secondaryViews`, `statusText`, `busy`, `frameReady`, `contentHostError`), `reload`, `tabs`, `activeTab`, `switchTab`, `dialogs`, `handleDialog`. Tabs are main/secondary frames; navigation and tab creation/closing are absent. `networkRequests()` returns an empty list. |
| App: `window.screen` | No browser navigation/tabs or JS dialog policy. `consoleMessages()` and `pageErrors()` read Persephone's renderer logs. `setInputFiles()` targets Persephone's own UI. `networkRequests()` returns an empty list. |

`window.screen` covers the complete visible app window, including the active page. It refuses to
automate while that page is a user-owned incognito or Tor page. Use `pages` to switch pages.

## Locators and actions

Trusted CDP input is the default. Use `{ synthetic: true }` only when legacy DOM events or value
assignment are specifically needed; the synthetic compatibility path can choose the first matching
element and retains an unknown-element value-setter fallback. It is not strict or trusted.

Selector actions resolve visible matches strictly: multiple visible matches fail immediately.
Narrow the selector, use a snapshot ref, or choose a zero-based `{ nth }` index among visible
matches. Actions retry until the default 5-second timeout (or `timeout`) while checking that the
element is attached, visible, stable, enabled, and receives pointer events. `{ force: true }`
skips all those checks and dispatches anyway. `position` is relative to the element border-box.

`hover()` sends trusted pointer events, but CSS `:hover` does not apply inside browser webviews.
Script-driven pointer listeners can still respond. The app window and board do not share that
browser-webview limitation.

| Input | Behavior |
|---|---|
| Text, search, email, URL, tel, password, number; textarea | Trusted focus, select existing content, then `Input.insertText`. |
| `contenteditable` | Trusted focus and validated trusted selection, then insertion. |
| `slowly: true` | Mapped characters use real key events; unmapped Unicode is inserted one character at a time. |
| `submit: true` | Presses trusted Enter after typing. |
| date, time, datetime-local, month, week, color, range | Validated native value assignment and untrusted `input`/`change`. |
| file input | Use `setInputFiles`; files are assigned directly, without native chooser interception. |
| Other non-editable elements | `type()` fails with a clear error. |

`select()` sets native `<select>` values programmatically (arrays work for `multiple`) and dispatches
untrusted `input`/`change`. It checks visible, enabled and stable, but not the pointer hit-test.
Use trusted click plus keys for custom dropdowns.
`check()`/`uncheck()` can click a visible associated label when the checkbox itself is hidden.

For keys, `pressKey("Control+C")` targets the focused element. Pass `target` to focus a locator by
trusted click first. `keyDown()` holds a key across calls until `keyUp()` releases it. Ctrl+C/V use
the real OS clipboard; Persephone does not save or restore its contents.

### Autocomplete fields and chips (mail recipients, tags, search suggestions)

```js
await editor.type({ ref: "e13554" }, "name@example.com");   // the combobox, e.g. "To recipients"
await editor.pressKey("Enter", { target: { ref: "e13554" } }); // commit the highlighted suggestion
await editor.snapshot({ root: { ref: "e13552" }, interactive: true }); // the field's container
```

- A committed value usually shows up as an `option "<value>"` (or a `button`) inside the field's
  `listbox`/`group`, and the combobox flips back to `[collapsed]`. That line is the chip; do not
  click it (clicking a chip opens or removes it).
- The suggestion popup is often attached outside the dialog, so a `root`-scoped snapshot may not
  show it. Pressing Enter is enough; you do not need to find the suggestion.
- Commit (Enter) or close (Escape) the suggestions before moving on. An open popup covers the next
  fields, and `click`/`fillForm` then fail as "covered".
- Refs die when an app re-renders a container. On a "take a new snapshot" error, snapshot again and
  use the fresh ref instead of retrying the old one.

## Waits, navigation, events

| Wait | Default |
|---|---|
| Actionability | 5 seconds; override with `timeout`. |
| `waitFor` / `waitForSelector` | 10 seconds; selector states: attached, detached, visible, hidden. |
| `navigateAndWait`, `waitForNavigation`, `waitForURL` | `load`; `waitUntil` also accepts `domcontentloaded` or `networkidle`. |

`waitFor` also accepts `text`, `textGone`, or `time`. Waits poll on 100 ms timers. Explicit MCP
wait deadlines add five seconds to the request deadline and cap it at 600,000 ms. Navigation results
are `{ url, status }`: HTTP errors resolve with their status; main-frame network failures reject.
`waitForURL` accepts exact strings or regular expressions.

`waitForResponse(urlOrRegex, options?)` exists on browser pages, boards, and `window.screen`. Start
the wait before the action that triggers the request:

```js
const responseWait = editor.waitForResponse(/api\/result\?page=\d+/, { timeout: 15_000 });
await editor.click("#load-result");
const response = await responseWait;
```

A string matches the URL exactly; use a RegExp when query parameters vary. Redirect hops do not
resolve the wait: matching uses the final response URL. The promise resolves when the response
headers arrive; with `includeBody: true` it waits for the body to finish loading, so a body the page
never reads can time out. A response cut off after its headers (for example `net::ERR_ABORTED`)
still resolves, without a body. HTTP error status codes resolve normally; a request that fails
before any response, and a timeout, reject with an error. Existing same-process iframes and owned out-of-process iframes are covered
when the wait is armed. An iframe created after arming is outside that wait. While the promise is
pending it holds the automation activity lease, so the configured dialog auto-dismiss behavior
applies.

`networkRequests()` history and its `includeBodies` / `maxBodyBytes` options are browser-page-only;
boards and `window.screen` return `[]`. Response bodies are omitted by default. Opt in with
`networkRequests({ includeBodies: true })` or `waitForResponse(..., { includeBody: true })`.
Responses are capped at 64 KiB by default and 1 MiB maximum. Binary content is returned as base64
with the corresponding encoding flag. A body the page read as a Blob is not kept by Chromium and is
omitted. History bodies are available only for requests made after
automation first touched the tab, and only while Chromium still buffers them. Bodies may contain
secrets; they are fetched only on request and are never logged or persisted.

JavaScript dialogs default to dismiss during automation activity and its two-second grace period.
Dialogs opened while the agent is idle remain user-controlled. `dialogs()` reads pending/handled
state and can set `accept`, `dismiss`, or `manual`; under `manual`, the next operation waits for
`handleDialog(accept, promptText?)`. `consoleMessages()` and `pageErrors()` return bounded recent
records.

## Other operations

```js
const editor = pages[id].editor;
await editor.drag(source, destination, { targetPosition: { x: 8, y: 8 } });
await editor.fillForm([
  { name: "Email", locator: "input[name=email]", action: "type", value: "person@example.test" },
  { name: "Updates", locator: "input[name=updates]", action: "check" },
]);
await editor.setInputFiles("input[type=file]", ["C:/data/report.csv"]);
await editor.screenshot({ target: { ref: "e12" }, format: "jpeg", quality: 70 });
const answer = await editor.evaluate("(a, b) => a + b", { args: [2, 3] });
await editor.setViewport({ width: 900, height: 700 }); // browser pages only
```

`fillForm()` applies fields sequentially and names the first failing field; earlier changes remain.
`setInputFiles()` accepts existing local files on hidden or visible file inputs. `evaluate()` accepts
JSON-safe function args; string arrow functions are invoked. Screenshots support PNG/JPEG and
quality for JPEG. Browser pages support `fullPage`; `target` and `fullPage` cannot be combined.
A `target` selector with several visible matches needs `{ nth }`. Cross-origin iframe element
screenshots are unsupported; the error says to pass the iframe element's own ref from the parent
document. Drag source and target must be in the same frame; cross-frame drag fails with
`drag source and target must be in the same frame`.
