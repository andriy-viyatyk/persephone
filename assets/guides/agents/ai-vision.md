---
title: "AI Vision — give a board or web app its own object model"
audience: agent
summary: "Authoring reference for publishing an object model from a board or a web page so it appears to an agent at pages[i].editor.app, with descriptors, elements, highlight, refresh, and notify."
---

# AI Vision — give a board or web app its own object model

This page is for the agent **building** a board (or a web app the user opens in Persephone's
browser). It tells you how to publish that app's own object model so another agent can drive it
by path — reading properties, calling methods, and pointing at controls on screen — instead of
guessing from an accessibility snapshot.

If instead you are **driving** a board or page that already publishes one, you want the `.app`
sections of [Boards](./boards.md) and [Browser automation](./browser.md). This page is the other
half: how to make `.app` exist.

## What the other agent gets

A published model appears at **`pages[pageId].editor.app`** — a live subtree of Persephone's own
`call` tree, with the same behavior as a built-in node:

```text
call  pages["<id>"].editor.app                 -> your summarize() output + a hint listing members
call  pages["<id>"].editor.app.$help           -> your help text
call  pages["<id>"].editor.app.items[2].title  -> a live value
call  pages["<id>"].editor.app.addItem  args ["Buy milk"]
call  pages["<id>"].editor.app.highlight  args ["save", "Press this to save"]
```

Without a model, the inside of your app is reachable only as `snapshot()` text plus opaque refs.
That is the right surface for an arbitrary web page and a poor one for an app you wrote yourself:
snapshot text has no types, no methods, no writable properties, and no stable names.

**The engine stays on the host.** You publish a *data contract* — a description of your object's
shape plus the functions behind it — and Persephone runs the resolver, the hints, the argument
validation and `helpSearch` over it. So the paths in hints are correct by construction, and there
is nothing to keep in sync on your side.

## Boards

### You do not install anything

Persephone inlines its shim into every board frame, so `window.persephone.aiVision` is already
there and always matches the host. **Never add `ai-vision` to a board's dependencies** — a
vendored copy would drift from the host's. Two entry points:

| Call | Purpose |
|---|---|
| `persephone.aiVision.expose(root)` | Publish `root` as the board's model; returns the remote handle. |
| `persephone.aiVision.createElements(declarations)` | Wire curated on-screen controls; returns `{ members, provide }`. |

Guard both so the board still runs when opened outside Persephone, and so it survives an older
app build:

```js
const P = window.persephone;
const aiVision = P && P.aiVision;
if (aiVision) { /* everything below */ }
```

### 1. Describe an ordinary object

There is no class to extend and no registration API. Take the object your UI already drives, and
add an `aiVision` descriptor to it. Reflection is never used — the `members` list is an allow-list,
and anything you do not declare is invisible.

```js
const app = {
    aiVision: {
        kind: "TodoApp",
        summary: "The Todo board's live object model for the open .todo.json file.",
        overview: "Read items for the filtered view.\nSet selectedList or searchText to change it.",
        help: "Longer prose: what this app is, what the ids mean, what is immediate and unconfirmed.",
        members: [
            { name: "fileName", kind: "property", summary: "Name of the open file, or an empty string." },
            { name: "items", kind: "property", node: true, indexable: true, summary: "The filtered, ordered items." },
            { name: "searchText", kind: "property", writable: true, summary: "Free-text filter over titles and comments." },
            { name: "addItem", kind: "method", signature: "addItem(title: string, list?: string)",
              summary: "Add an item and return its id. The optional list must already exist." },
            { name: "deleteItem", kind: "method", signature: "deleteItem(id: string)",
              summary: "Remove an item by id.",
              caution: "Deletes immediately — no confirmation and no undo." },
        ],
        summarize: () => ({ kind: "TodoApp", fileName, items: data.items.length }),
    },
    get fileName() { return fileName; },
    get items() { return itemsNode; },
    get searchText() { return sel.searchText; },
    set searchText(value) { setSearchText(value == null ? "" : String(value)); },
    addItem, deleteItem,
};
```

Descriptor fields worth knowing (the full contract is in the `ai-vision` package README):

| Field | Meaning |
|---|---|
| `kind` | Stable type name; the host deduplicates repeated member hints by it. |
| `summary` | One sentence, shown wherever the node is listed. |
| `members` | The allow-list. Nothing outside it resolves. |
| `overview` | Compact first-step map shown on the node's hint and `$help`. |
| `help` | Long-form text (or a sync function returning it) for `<path>.$help`. |
| `summarize` | Sync or async JSON-able instance summary — what a bare read of the node returns. |
| `index` | Sync lookup behind `items[3]` / `items["id"]`; `undefined` means no such item. |
| `children` | Optional live child listing; must be cheap and side-effect free. |
| `elements` | Declarations for curated on-screen controls (below). |
| `restricted` | Sync gate returning text; the whole subtree then stops resolving. |

Member fields: `name`, `kind` (`property` | `method`), `summary`, and optionally `signature`,
`caution`, `writable` (allows assignment), `node: true` (the value is another described node, so
search may follow it), `indexable`.

Three rules pay off later:

- **Write the summaries for someone who cannot see your UI.** They are the entire interface. Say
  what an id is, what a name must already exist, what is a filter and what is a write.
- **Put `caution` on anything immediate and destructive.** It prints alongside the member.
- **Nest with `node: true`.** A collection node with its own `index` and item descriptor is what
  makes `items[0].title` resolve and `helpSearch` reach inside.

### 2. Expose it — from the main view only

```js
const remote = aiVision.expose(app);
```

Registration is posted to the host **only from the board's main view** (`persephone.view === "main"`).
Calling `expose()` in a secondary-view frame is harmless and is in fact what you want when that
frame declares elements (below), but it does not publish a second model — a board has exactly one.

Exposing replaces any previous registration: call it once, after your DOM is wired.

### 3. `refresh()` — the gotcha that actually bites

`expose()` derives the shape of an indexed item by probing `index(0)` **once**. If your
collections are still empty at that moment — an async file load, a fresh board with no data —
the item shape is empty, and `items[0]` will not resolve for an agent no matter how many items
appear later.

Call `remote.refresh()` when a collection first becomes non-empty (or empty again):

```js
const collectionShape = () => [data.lists.length > 0, data.items.length > 0].join();
let lastShape = null;

function refreshAiVision() {
    if (persephone.view !== "main" || !remote) return;
    const next = collectionShape();
    if (next === lastShape) return;
    lastShape = next;
    remote.refresh();          // republishes the shape and tells the host to re-read
}
```

Call it from wherever you re-render. Comparing an empty/non-empty signature keeps it cheap: a
`refresh()` on every keystroke is wasted work, and the host logs a `shape-changed` event each time
telling the agent to re-read `pages[id].editor.app`.

### 4. Point at controls: `createElements`

`elements` and `highlight` give the agent a curated, named inventory of your UI — the controls a
user would be told to click. Declare them once and concatenate the generated members:

```js
const declarations = [
    { name: "quick-add-input", view: "main",
      purpose: "The box that adds an item: type a title and press Enter.",
      where: "Under the header in the main list." },
    { name: "add-list", view: "lists",
      purpose: "The \"New list…\" box and its + button.",
      where: "Top of the \"Lists & Tags\" sidebar panel." },
];
const elementParts = aiVision.createElements(declarations);

// in the descriptor:
members: [ ...yourMembers, ...elementParts.members ],
elements: declarations,
provide: elementParts.provide,
```

- A declaration resolves to `[data-name="<name>"]` in the DOM by default; pass `selector` to
  override, and `where` to tell the agent where to look on screen.
- **`view` names the frame that owns the control** — `"main"` or a declared secondary view id.
  Highlighting an element in a secondary view opens that board panel and draws the callout there.
- **Every frame calls `createElements` with the same full declaration list.** Each frame registers
  its own provider and serves element and highlight requests for the controls it actually renders.
  One complete set per frame; duplicate names throw.
- `highlight(name, message)` draws a fixed accent ring and message. The palette is deliberately
  recognisable so the user can always tell an agent placed the callout.

### 5. `notify(text)` — one line to the agent

```js
remote.notify("The import finished.");
```

A short board-authored message that reaches the agent through the event log, labelled as written
by the board. Trusted boards only, at most 512 characters, five per rolling minute. This is not
`persephone.notify(text, type)`, which shows a toast to the user.

### Rules that will bite you

- **Never let an agent-facing method wait on an in-board dialog.** A `confirm()` or a custom
  modal blocks until a human clicks, and there is no human on that call path. Split every
  confirmed action into an interactive half and an immediate `…Core` half, and let the model call
  only the `…Core` one. Say so in the member's `caution`. (The Force Graph board in the catalog is
  the worked example of this convention.)
- **Trust is the user's.** An untrusted board's whole subtree is restricted until the user answers
  the Trust-this-Board dialog; `.app` is absent until then. Nothing your board does grants trust.
- **Validate in the setter and throw a readable error.** A rejected assignment should say what
  the legal values are — "Unknown list 'Groceries'; lists are …" — because that message is the
  agent's only feedback.
- **Keep discovery synchronous.** `members`, `index`, `provide` and `restricted` are called
  synchronously; `children` and `summarize` may be async. Property reads and method calls are
  awaited, so they can return promises.
- **Mind the timeout.** A remote call is bounded by, in order: the caller's `timeoutMs`, the
  member's declared `timeoutMs`, the session knob `boards.callTimeoutMs`, then a 30-second
  fallback. A long-running action should start work and return, not block.
- **Results are shaped and bounded.** A read goes through the host's result shaping (20,000
  characters by default), with `truncated`/`shown`/`total` metadata. Return summaries, not dumps.

## Web pages in the browser editor

A page the user opens in Persephone's browser can publish the same way. Here the page **does**
depend on the package:

```js
import { expose } from "ai-vision/remote";

const remote = expose(root);   // publishes window.__aiVision
```

Everything about the descriptor is identical. The differences are on the host side:

- **Discovery is a probe, not a handshake.** Persephone looks for `window.__aiVision` after a
  completed navigation. Publish it as part of page startup rather than behind a user action.
- **The model may change without navigation.** `remote.version` starts at 1 and increments on
  every `refresh()`. The host revalidates before each request; on a version change it rejects the
  stale proxy, logs a `shape-changed` event naming `pages[id].editor.app`, and re-probes in the
  background.
- **Page-authored content is untrusted.** Node kinds are prefixed `page:` so a hint shows whose
  content it is, everything is confined to `.app`, and it cannot shadow the browser facade, the
  page, or the root. A private (Incognito/Tor) browser page is refused before Persephone probes it.
- Element highlighting runs in the owning page frame.

## Checklist

1. The object has an `aiVision` descriptor with `kind`, `summary`, `members`, and `summarize`.
2. Summaries explain ids, preconditions, and what writes vs. filters. Destructive members carry
   `caution`.
3. Collections are `node: true` + `indexable`, with an item descriptor of their own.
4. `expose()` runs once after the DOM is wired; `refresh()` fires when a collection changes
   empty/non-empty state.
5. Element declarations carry `purpose` and `where`; every frame calls `createElements` with the
   full list; `view` names the owning frame.
6. No agent-facing method blocks on a dialog.
7. Verified from the other side: `call pages["<id>"].editor.app.$help`, read a value, index into a
   collection (`items[0]`), call one method, and run `highlight` on one element.

Step 7 is the real test. A model that describes itself perfectly and cannot be indexed is the
common failure, and it shows up immediately.

## Worked examples

The board catalog ships three, in increasing order of size: **PDF Viewer** (small, single view),
**Todo** (lists, tags, indexed items, a secondary view, the `refresh()` pattern), and
**Force Graph** (large surface, and the `…Core` no-blocking-dialog convention). Install one and
read its source — it is a folder of plain files on disk.

The `ai-vision` package README is the contract reference: the full descriptor and member tables,
`helpSearch`, the remote wire protocol, result shaping, and versioning.
