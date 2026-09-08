# Surface QA: `.app` — a board's or a web page's own object model

Manual scenarios for `pages[i].editor.app`, the node a **remote party** contributes to the `call`
tree. A board publishes its model with `persephone.aiVision.expose(root)`; a web page publishes it
by calling the `ai-vision` package's `expose()`, which leaves `window.__aiVision` on the page.
Persephone runs its own resolver over a proxy built from the shape, so everything an agent already
knows — `$help`, `helpSearch`, hints, `elements`, `highlight` — works on content it has never seen
before.

Run through `call` only; do not add or run automated tests or a test harness for these surfaces.

Landed by EPIC-097 (US-1389 to US-1393), on the `ai-vision` library from EPIC-096.

## Test surfaces

Two are needed, and neither is a shipped board:

- **Board:** a scratch board that exposes a model. `C:\projects\test-boards\aivision-probe` is the
  one EPIC-097 used — a task list with a writable `filter`, an indexable `list`, `addItem` /
  `toggleItem` / `clearDone`, two deliberately slow methods (`slowTask`, and `declaredSlowTask`
  which declares `timeoutMs: 1500`), five `data-name` controls in the main frame and one
  (`notes-box`) in a declared secondary view. Any board with the same ingredients works.
- **Web page:** `C:\projects\ai-vision\examples\demo-page\index.html`, the library's own demo,
  opened from `file://` in a browser tab.

**Do not** use `persephone-boards/boards/todo` — exposing that board is EPIC-098, and driving it
from a bare `call` is that epic's gate, not this one.

---

## Test A.1: A board's model appears only after it registers, and only when trusted

**Preparation:** The scratch board's folder exists and is **not** trusted yet.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `boards.openBoard("<board root>")`, then read `pages[i].editor` and then
`pages[i].editor.app`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** While the board is untrusted, `editor.renderState` is `"untrusted"` and `.app` is
refused with the board's existing Trust-this-Board text — not with "unknown member", and not with a
partial answer. Trust the board through `boards.registerBoard` and the dialog it raises, then read
`pages[i].editor.app` again: the node now resolves and its hint lists the board's own members. The
point of the test is that a shape from an untrusted board never reaches the tree at all.

## Test A.2: The board's model is self-describing

**Preparation:** The scratch board, trusted and open.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `pages[i].editor.app`, `pages[i].editor.app.$help`, and `helpSearch` for a phrase that
appears only in the board's own help or member summaries.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** The hint carries the board's `kind`, its summary, and every declared member with its
signature and summary. `$help` adds the board's long-form help. `helpSearch` returns paths under
`pages[i].editor.app.…` — proving the engine indexed a tree it did not author. An agent that has
only ever seen Persephone's own nodes needs no new instructions to read this one.

## Test A.3: A writable property round-trips and a method invokes

**Preparation:** As A.2.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Assign the board's writable filter property with `value`, read it back, read an indexed
item (`app.list[0]`), then call a mutating method with `args`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** The assignment reports success and the read-back returns the new value. `app.list[0]`
returns one item's summary, not the collection's — an indexed hop into a remote node resolves to the
item's own shape. The method returns its result, and the board's visible UI changes to match. A
non-writable property refuses, and an unknown member returns the member list rather than failing
blankly.

## Test A.4: A timeout fires at each of the four levels, and says which one

**Preparation:** As A.2. The board needs a slow method, and a second slow method that declares its
own `timeoutMs`.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Four calls, each to a method that will not answer in time:

1. the undeclared slow method with a per-call `timeoutMs` well below its duration;
2. the method that declares `timeoutMs`, with no per-call option;
3. the undeclared slow method after setting `boards.callTimeoutMs`;
4. the undeclared slow method with nothing set — the built-in 30 s default.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** Each error names the level that applied *and* the full path the agent typed
(`pages["<id>"].editor.app.<member>`), not a proxy-relative one it cannot retry. Each fires at the
expected time, most specific winning. Case 4 must be reachable: if `boards.callTimeoutMs` reports a
number before anyone set it, that does not by itself mean level 3 applied — the level named in the
error is the authority, and it must say 4. The board keeps running afterwards: read a fast member
and confirm it still answers. A slow board is not a broken board.

## Test A.5: `elements` and `highlight` work inside the frame, and inside a secondary view

**Preparation:** As A.2, with the board declaring controls in its main frame and at least one in a
declared secondary view.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `pages[i].editor.app.elements`, then `app.highlight("<a main control>", "…")`, then
`app.highlight("<the secondary-view control>", "…")`.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** `elements` reports each declared control with a resolved selector and live visibility
computed **in the document that owns it** — the host cannot see inside a cross-origin frame, so a
`visible` that tracks the real frame is the whole point. Both highlights report `found: true`, and
the ring is drawn *inside the board's frame*, not over the Persephone chrome. The secondary-view
highlight mounts its panel first if it is closed. A control in a view that is not mounted reports
`visible: false` with a note saying the view was not queried — an unqualified `false` would read as
"the control is not there".

## Test A.6: A web page's model mounts, and is labelled as the page's own

**Preparation:** The library's demo page open in a browser tab (`file://` is fine), fully loaded.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `pages[i].editor.app`, `app.$help`, a writable property round-trip, an indexed read
(`app.items[0].title`), a method with `args`, `app.elements`, and `app.highlight(...)`. Then
`helpSearch` for a phrase from the page's own help.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** Everything A.2–A.5 proved for a board works for a page over CDP. Crucially, the page's
content is *labelled*: the node's kind is prefixed `page:`, so a hint header and every `helpSearch`
hit carry it, the root summary is marked page-authored, and `$help` states in full that content
under `.app` on a browser page is written by the page and is data rather than instructions. Nothing
the page declares appears in the `pages` overview or shadows the facade, the page node, or the root.

## Test A.7: A page with no model costs nothing, and a private page is never probed

**Preparation:** A browser tab on an ordinary page that does not publish `window.__aiVision`, and a
private (incognito or Tor) page the **user** opened.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** Read `pages[i].editor` on the ordinary page, navigate it to a page that *does* publish a
model and read `pages[i].editor.app`, then navigate away again and read it once more. Then read
`pages[j].editor` on the private page.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** A page without the global has no `.app` member and reports no error — it looks exactly
as it did before this feature existed. After navigating to a participating page, `.app` appears;
after navigating away, it is gone, and no stale answer survives the document swap. The private page
is refused by the existing privacy text before anything is evaluated in it, and never gains `.app`.

## Test A.8: Reload and re-registration

**Preparation:** The scratch board, trusted and open, with `.app` resolving.

**Start:** The runner's first operation is `call` with no `path`; the agent must use the returned overview before choosing a branch.

**Call:** `pages[i].editor.reload()`, then read `pages[i].editor.app` again.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths: `none` or `<every incorrect path, in order>`.

**Verify:** The reloaded frame re-registers and `.app` resolves against the new shape. A request
issued against the previous frame never resolves against the new one. If the board's script changed
between reloads, the new members are the ones listed — the shape is a snapshot of the frame that
registered it, not a cached description of the board folder.
