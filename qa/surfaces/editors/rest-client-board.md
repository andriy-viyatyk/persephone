# Surface QA: REST Client board

Manual scenarios for the bundled REST Client board's page model, controls, and mounted guide. Run
each scenario through the call surface only. Never touch pinned pages; close only pages created by a
scenario. Use a public test API and scratch collection, never a user's credentials.

## Test RC.1: Discover the board model and controls

**Preparation:** An enabled REST Client board with one scratch collection open in the main view and
its Requests secondary view available.

**Start:** The runner's first operation is `call` with no `path`; use the returned overview to pick
the page and editor branch.

**Request:** Discover the page, inspect `pages[id].editor`, then read `pages[id].editor.app`, its
`$help`, `elements`, and summary. Inspect the Requests frame and highlight a request-tree control
and the deletion dialog controls in their respective views.

**Expected:** The page editor id begins with `board-editor:`. The app model has kind marker
`rest-client`, all 33 documented members and only the documented `duplicateRequest` and
`copyAs` additions. Help explains the distinction between page editor id and model kind marker.
Main controls resolve in the main frame; tree and dialog controls resolve in `requests`. Repeated
controls report all visible matches without claiming an index. Guide help paths include
`installed-boards/rest-client/index.md`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** Check that request/response snapshots are copied, requests is an array on the attached
board, and conditional getters are undefined under the documented conditions. Confirm dialog
controls have distinct main and requests names. No dialog is accepted on the user's behalf.

## Test RC.2: Add, duplicate, select, serialize, and delete

**Preparation:** A scratch collection created for this scenario.

**Start:** First call has no `path`; follow the overview to the target page's
`pages[id].editor.app`.

**Request:** Add a request in a scratch collection, select it, set method and URL, call `copyAs` for
one supported format, duplicate it, inspect both snapshots, then delete only the requests created
here. Use the Requests view's context menu to inspect request and collection delete confirmation
controls without confirming a destructive action against preexisting data.

**Expected:** Mutations update the visible model and persist in the collection. Duplicate returns a
copied request with a new id. `copyAs` returns source text without changing clipboard state.
Unknown request ids produce a diagnostic. Tree controls and the in-board dialog use the requests
view names.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** The created requests are removed, preexisting requests remain unchanged, and only this
scenario's page is closed.

## Test RC.3: Await a request and read the response

**Preparation:** A scratch collection; use a public echo/test API and no private headers or user
credentials.

**Start:** First call has no `path`; discover the collection and model from the overview.

**Request:** Add a GET request to the public test API, select it, await `pages[id].editor.app.send()`,
then read response, responseTime, and the response viewer controls. Also request an invalid public
test route that returns a transport/body failure.

**Expected:** `send()` waits for completion and returns a copied response with status, statusText,
headers, body, optional binary/contentType, and formatted size. The selected response and response
time are available after completion. HTTP error statuses remain ordinary responses; transport or
body failures return status 0. Sending is explicitly a real network action.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** Send button reports its busy state during execution. Response segments use clicks on
`data-value`; do not call `select()` on segmented groups. Read response values through the model.

## Test RC.4: Body/header controls and safe argument surface

**Preparation:** A disposable scratch request with sample non-secret header/form rows.

**Start:** First call has no `path`; discover the board through overview.

**Request:** Inspect all declared controls. Exercise method-label, body-language, and
response-language with native `select()`. Exercise headers-view, body-type-select,
response-tab-select, and response-headers-view by clicking a matching `data-value` button. Use
model methods to edit request method, URL, body type/language, header/form keys and enabled flags;
avoid passing any header/body/form values as method arguments.

**Expected:** GET and HEAD force body type none; changing from none to a body-capable method chooses
raw and adds the current language Content-Type. Body type/language changes apply the UI Content-Type
rules and default multipart row. Model methods preserve row values and reject unknown request ids.
No secret-value setters exist. Both splitters are declared in the main view.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** Main-frame confirmation controls use the `-main` suffix. Request value fields can be
located through elements but cannot be changed by a corresponding value setter.

## Test RC.5: Guides, response limits, and image routing

**Preparation:** A trusted bundled REST Client board. Use a harmless image response and a disposable
collection.

**Start:** First call has no `path`; discover guide and board branches through the overview.

**Request:** Read the About/MCP guide list and `guides["installed-boards/rest-client/index.md"]`.
On the board page, press F1. Open an image response in Image Viewer and inspect the resulting page.
Send harmless text and binary responses, close and reopen only the scenario-created page, and check
which response restores. Read help for cache and upload limits, and check the documented New Editor
and native link/trait drop gaps.

**Expected:** The board guide is mounted as bundled documentation in About, MCP guides, and F1.
Image Viewer opens a blob-URL page titled Image directly; only Save to File asks for a path.
Text responses restore across a page restart while they fit within the 9 MiB persisted cache cap;
binary response entries are session-only. Upload bodies are capped at 32 MiB after file allocation/read. Help states that Open in New Editor and
native Persephone link/trait drops are unavailable in the board tree.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** Close only pages created by this scenario. Do not alter a preexisting collection.
