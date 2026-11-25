---
title: "Browser selectors, locator reads, and waits"
audience: both
summary: "Choose selector engines and chains, read element state and text, and wait for page conditions."
---

# Selectors, locator reads, and waits

Return to [Browser automation](./browser.md) for host members, snapshots, page models, profiles, and browser-specific limits.
## Locators and actions

Trusted CDP input is the default. Use `{ synthetic: true }` only when legacy DOM events or value
assignment are specifically needed; the synthetic compatibility path can choose the first matching
element and retains an unknown-element value-setter fallback. It is not strict or trusted.

Selector actions resolve visible matches strictly: multiple visible matches fail immediately.
Narrow the selector, use a snapshot ref, or choose a zero-based `{ nth }` index among visible
matches. Actions retry until the default 5-second timeout (or `timeout`) while checking that the
element is attached, visible, stable, enabled, and receives pointer events. Stability means the
element keeps the same bounding box across two consecutive animation frames. `{ force: true }`
skips all those checks and clicks whatever is on top at that point. `position` is relative to the
element border-box.

Trusted `hover()` sends native CDP mouse movement and applies CSS `:hover` in browser and board guests.
`click()` checks visibility before moving the pointer, so call `hover(container)` first for a
hover-revealed target or rely on its default `hoverFirst` retry after a not-visible result. That
single retry forces `:hover` on the target and its composed ancestors. Pass `{ hoverFirst: false }`
to disable that automatic reveal attempt. `window.screen` does not force CSS pseudo state. Synthetic
hover remains a separate DOM-event-only compatibility path.

Before a trusted click presses, automation moves to the target, waits one animation frame (up to
50 ms), and checks what is under the pointer. If hover handling replaces the target, it resolves
and checks again, up to three rounds. For browser and board left clicks, `checkClick` defaults to
true: after release, automation checks that the page dispatched a `click`. If press and release
landed on different elements, or both arrived but no click followed, the error code is
`click-not-dispatched`; the error names the two elements when they changed. Pass
`{ checkClick: false }` for pages that intentionally act on press without dispatching a click. The
check does not apply to `window.screen` or coordinate `clickAt()`.

If a click closes its own popup while releasing, it counts as delivered; there is no remaining page
to inspect.

Actions scroll targets within their containers before hit testing; a still-clipped target reports its
clipping container. `focus(locator)` focuses without clicking. Targeted keyboard calls click by
default; pass `{ target: locator, focus: "focus" }` to `pressKey`, `keyDown`, or `keyUp` to avoid it.

`drag` accepts a destination locator or `drag(source, { by: { x, y } }, { steps, holdMs })`;
`by` starts at the resolved source point. A locator drag can use an outside-box `targetPosition` once
its destination anchor is actionable. `steps` sets movement count; `holdMs` delays after press.
`clickAt({ x, y })` and `dragTo({ from, to })` use viewport CSS pixels in the selected browser tab or
board frame.

Use `mouseDown`, `mouseMove`, and `mouseUp` when the page updates while a button is held and you need
to inspect that intermediate state. Locator targets are resolved with hover's actionability checks;
coordinate targets use the host viewport CSS pixels. The default button is left. `mouseMove` sends
one event by default; `{ steps }` interpolates up to 1000 events from the tracked point. Moves retain
the full held-button state, and `mouseUp()` releases at the last point when no target is supplied.
`mouseUp` without a matching held button fails. For browser right-clicks, the existing context-menu
policy stays active until release; `{ nativeMenu: true }` opts into Persephone's menu.

`wheel({ deltaX, deltaY }, target?)` sends trusted wheel deltas unchanged in CSS pixels. It uses the
last tracked point when target is omitted and fails until a pointer point has been established.
Adopted `ctx.usePage` pages release held keys and buttons during test cleanup. Browser tab and popup
teardown release their state; retiring board frames and lost app contexts discard stale state.

```js
await editor.mouseDown("#start");
await editor.mouseMove("#end", { steps: 12 });
const liveCount = await editor.count(".selected-day"); // inspected while left is held
await editor.mouseUp();
const committedCount = await editor.count(".selected-day");
```

Browser pages accept hidden aliases such as `dblclick`, `fill`, `press`, `textContent`, and
`inputValue`; these stay out of `$help`. `fill` replaces the value; `press` takes the key first.
Unknown names such as `getByRole` get a one-line suggestion for a supported equivalent.

Automation right-click runs the page handler and suppresses Persephone's menu by default; pass
`{ button: "right", nativeMenu: true }` to opt in. A physical right-click on the same tab within
about 500 ms after a page-prevented automation menu can lose the app menu once.

| Input | Behavior |
|---|---|
| Text, search, email, URL, tel, password, number; textarea | Trusted focus, select existing content, then `Input.insertText`. |
| `contenteditable` | Trusted focus and validated trusted selection, then insertion. |
| `slowly: true` | Mapped characters use real key events; unmapped Unicode is inserted one character at a time. |
| `submit: true` | Presses trusted Enter after typing. |
| date, time, datetime-local, month, week, color, range | Validated native value assignment and untrusted `input`/`change`. |
| file input | Use `setInputFiles`; files are assigned directly, without native chooser interception. |
| Other non-editable elements | `type()` fails with a clear error. |

`type()` replaces existing content, and `clear()` removes it, including for fields addressed by
board-frame refs in `window.screen`.

`select()` sets native `<select>` values programmatically (arrays work for `multiple`) and dispatches
untrusted `input`/`change`. It checks visible, enabled and stable, but not the pointer hit-test.
Use trusted click plus keys for custom dropdowns.
`check()`/`uncheck()` can click a visible associated label when the checkbox itself is hidden.

For keys, `pressKey("Control+C")` targets the focused element. Pass `target` to focus a locator by
trusted click first, or use `focus: "focus"` to avoid a click. `keyDown()` holds a key across calls
until `keyUp()` releases it. Trusted Ctrl+C writes the OS clipboard until the page clipboard is armed. The
test-only page clipboard is described in [Browser](./browser.md#page-scoped-test-clipboard).
On a browser page, `pressKey` reaches the focused web page and Persephone's browser shortcuts,
including zoom, reload, and developer tools.
`Ctrl+L` is BrowserEditor-root only, so focus Persephone chrome (for example, a toolbar control)
before sending it. `Ctrl+F` also has a global route while this Browser page is focused.

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
| `navigateAndWait`, `reload`, `back`, `forward`, `waitForNavigation`, `waitForURL` | `load`; `waitUntil` also accepts `domcontentloaded` or `networkidle`. |

Pass exactly one of `selector`, `text`, `textGone`, or `time` to `waitFor`. Waits poll on 100 ms
timers. Explicit MCP wait deadlines add five seconds to the request deadline and cap it at 600,000 ms. Navigation results
are `{ url, status }`: HTTP errors resolve with their status; main-frame network failures reject.
`waitForURL` accepts exact strings or regular expressions.

`waitForResponse(urlOrRegex, options?)` exists on browser pages, boards, and `window.screen`. Start
the wait before the action that triggers the request:

```js
const responseWait = editor.waitForResponse(/api\/result\?page=\d+/, { timeout: 15_000 });
await editor.click("#load-result");
const response = await responseWait;
```

A string matches the URL exactly; use a RegExp when query parameters vary. A `call` carries only JSON,
so there pass `{ "regex": "api/result\\?page=\\d+", "flags": "i" }` (flags optional) instead of a RegExp;
`waitForURL` accepts the same form. Redirect hops do not
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

Request routing and captured downloads for web-app tests are covered in [Browser](./browser.md#capturing-a-download-in-a-web-app-test),
[Browser request routing](./browser-request-routing.md), and the [web-app test guide](./web-app-tests/index.md).

JavaScript dialogs default to dismiss during automation activity and its two-second grace period.
Dialogs opened while the agent is idle remain user-controlled. `dialogs()` reads pending/handled
state and can set `accept`, `dismiss`, or `manual`; under `manual`, the next operation waits for
`handleDialog(accept, promptText?)`. `window.prompt()` is not available in browser pages (the
Electron runtime throws instead of showing it), so only `alert`, `confirm` and `beforeunload`
dialogs occur. `consoleMessages()` and `pageErrors()` return bounded recent records.

## Other operations

For document-start scripts, fake page time, and browser storage state, see [Browser](./browser.md)
and the [web-app regression test guide](./web-app-tests/index.md). Storage-state files contain
authentication secrets and belong only in an existing git-ignored local folder.

```js
const editor = pages[id].editor;
await editor.drag(source, { by: { x: 40, y: 0 } }, { steps: 12, holdMs: 100 });
await editor.clickAt({ x: 120, y: 80 }); // dragTo({ from, to }) uses the same viewport coordinates
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

After several pages of a site are automated, MCP may offer an optional site-extension suggestion. Finish the current task first, then ask whether the work recurs and offer an extension if appropriate. Read `guides.agents["site-extensions"]` before building one. The user can disable agent tips in Settings → MCP Server / Mneme.

After restore, tab metadata is available without loading background tabs. Guest operations targeting a background tab can start it without switching the active tab.

## Real browser pop-ups

`editor.popups` lists live real windows opened by this page, including nested windows. Each entry
has a runtime-only `id`, immediate `openerId`, `url`, `title`, and `loading`; tab dispositions still
appear as ordinary tabs. A pop-up request handled by this browser page opens as a new active inner
tab in that page. Use popup IDs with content methods' `{ tabId }` option, including
`evaluate()`, input, screenshots, and navigation waits. An OAuth page can return its result through
`window.opener.postMessage`; wait on the popup with `waitForURL()` or `waitForNavigation()` while
the opener receives the message. `closePopup(id)` runs the popup's `beforeunload` handler and
rejects if the page refuses to close. Close pop-ups when finished. `closeTab()`, `switchTab()`,
`fullscreen()`, `back()`, `forward()`, and `navigateAndWait()` accept tabs only; back/forward and
`navigateAndWait()` operate on the active tab. Pop-ups close with their opener tab or page and are
never restored. Browser privacy rules still apply.

`popup-opened` announces the ID; `popup-closed` follows on close. `events.wait()` avoids polling.

## Selector engines and locator forms

String locators use one shared grammar. CSS remains available, alongside these engines:

| Engine | Example | Match |
|---|---|---|
| `role=` | `role=button[name="Save"]` | Chromium accessibility role and name. |
| `label=` | `label=Email` | Associated label (minus nested controls), `aria-labelledby`, or `aria-label`. |
| `placeholder=` | `placeholder=Search` | The placeholder attribute. |
| `testid=` | `testid=save` | Exact, case-sensitive `data-testid`. |
| `title=` / `alt=` | `title=Refresh` / `alt=Logo` | The corresponding attribute. |
| `text=` | `text="Saved"` | Existing visible-text matching. Quoted text is exact after whitespace normalization. |
| `ref=` | `ref=e12 >> text=Save` | A snapshot ref as the first step, scoped to the target's main frame. |

Names and attribute values generally match a case-insensitive substring; quoted values with `s`
(for example, `role=button[name="Save"s]`) match case-sensitive exact text, and `/pattern/flags`
uses a regular expression. Role names and states come from Chromium's accessibility tree, the same
source used for ordinary snapshot role/name lines. Names are whitespace-normalized. `text=` keeps
its existing quoted-exact behavior; add `i` for substring matching or `s` for exact case-sensitive
matching. Role state filters include `checked`, `disabled`, `expanded`,
`level`, `pressed`, and `selected`; supported values are described by the state itself (for example
`[checked=false]` or `[pressed=mixed]`).

`[include-hidden]` asks the role engine to include ignored accessibility matches when Chromium
returns them. It cannot reveal every visually or semantically hidden node: Chromium's AX query does
not return `display:none` or `aria-hidden` nodes. Pointer-generic snapshot lines can display
substitute descendant text; use `role=` for the Chromium role/name fact.

Use `>>` to chain steps; each next step searches inside the preceding matches. `nth=N` is a step
that selects from the raw ordered candidate list, with negative values counting from the end:
`li >> nth=-1`. CSS steps also accept `:has-text("Save")` and `:visible` suffix filters. The object
form is convenient for composed locators, for example
`{ role: "button", name: "Save", exact: true, within: { ref: "e12" }, visible: true, nth: 0 }`;
locator kinds include `role`, `label`, `placeholder`, `testId`, `title`, `alt`, `text`, and `selector`,
with `name`, `exact`, `within`, `hasText`, `visible`, and `nth` modifiers. A role name may also be
`{ regex, flags? }`; `within` accepts any locator form. A direct `{ ref }` keeps its frame scope;
a `ref=` string step must be first and resolves in the target's main frame (a board's selected frame).

For actions, `{ nth }` counts visible matches after final action visibility filtering. This differs
from selector `nth=N`, which chooses from the raw ordered list before that filtering. Actions require
one visible match by default and retry transient attachment/visibility/actionability issues. Read
methods are immediate: `count` and `allInnerTexts` allow multiple matches; `isVisible` returns false
for zero but is strict for multiple; `isEnabled`, `isChecked`, and `innerText` require exactly one.
`boundingBox` is strict for multiple, returns null for no visible match, and reports viewport CSS
pixels; out-of-process frame refs cannot be translated. Pass `{ nth }` to choose a single match.
`innerText` is untrimmed; `query`'s `text` is trimmed and bounded. `isChecked` supports native and
ARIA checkable controls (mixed or unsupported state throws); `isEnabled` follows native `disabled`
and inherited `aria-disabled`.

A name in both an open dialog and the page fails strict mode; scope it:
`dialog[open] >> role=button[name="Discard"s]`.

`query(locator, { fields })` returns `{ matches, truncated }`, capped at 200 elements. Defaults are
`role`, `name`, `text`, `visible`, `enabled`, `checked`, `tag`, and `ref`; request `value` or
`attributes` explicitly. Only requested fields are returned. Page values can contain sensitive data;
text and attribute strings are bounded. `role` and `name` are Chromium accessibility facts, or null
when no usable AX node exists. Raise the outer call's `maxLength` if the serialized response is cut;
it does not raise the 200-row cap.

## Waiting for a page predicate

`waitForFunction(fn, options)` evaluates a page predicate repeatedly and returns its first truthy,
JSON-serializable result. In an in-app script, pass a function; over `call`, pass function source as
a string because arguments cross the boundary as JSON. Options include `args`, `timeout` (default
10 seconds, maximum 28 seconds), and `polling` (`"raf"` by default, or a 10–10,000 ms interval).
Animation-frame polling has a 100 ms timer fallback. Navigation rejects with a page-navigated
message. The host deadline bounds a pending page wait, but cannot interrupt synchronous infinite
page code or undo side effects already started. The caller-authored predicate can read and mutate
the page, like `evaluate()`.
