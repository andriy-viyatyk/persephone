# US-1404: Board object model — cross-editor page creation, graph color tokens, manifest content detection

**Epic:** [EPIC-100](../../epics/EPIC-100.md) — Move the Force Graph editor out of the app into a board
**Investigation:** [EPIC-100-investigation-notes.md](../../epics/EPIC-100-investigation-notes.md) §3.5, §4.3, §4.5, §4.7, §5.1, §5.7, §5.15

## Goal

Close the three board object-model gaps EPIC-100 D1 names — cross-editor page creation, a graph
color palette, and manifest content detection — additively in the app, so **any** board (and the
forthcoming Force Graph board in particular) can do what the built-in `graph-view` editor does.

Nothing in `src/renderer/editors/graph/` is touched; its removal is US-1405, gated on owner testing.

## Background

### Gap 1 — cross-editor page creation (§5.7)

`src/renderer/editors/graph/` calls `pagesModel.addEditorPage(editorId, language, title, content)`
in five places (`GraphMutationModel.ts:108/120/166`, `GraphTooltipView.ts:246`, `graph/index.ts:212`)
to create **in-memory, untitled** pages in `md-view`, `grid-json`, `graph-view` and `draw-view`.

A board has only `persephone.openRawLink(href, { editor })`, which opens a **href**, not content,
and `persephone.call(path)`, which is deliberately rooted at the board's own hosting page and so
cannot reach `pages.addEditorPage`.

`PagesLifecycleModel.addEditorPage` (`src/renderer/api/pages/PagesLifecycleModel.ts:259`) already
performs every validation this needs:
- non-string `editor` → throw;
- `editorRegistry.assertKnownLanguage(language)` → throw on an unknown language id;
- unregistered editor id → throw (this is what rejects a `board-editor:<root>` id for free);
- `!editorDef.hasContentHost` → throw ("standalone editor…").

It returns a `PageModel`; `page.id` is the page id the bridge contract promises.

### The two board transports

`src/ipc/board-bridge-channels.ts` defines two independent channels:

1. **board ↔ main over the per-board `MessagePort`** — `{kind:"rpc"}` (awaited),
   `{kind:"fire"}` (`openRawLink`, `notify`), `{kind:"call"}`. Everything here is routed by
   `src/main/board-bridge.ts` and reaches the renderer through
   `RendererEventsService`, i.e. it is **window-scoped, not page-scoped**.
2. **board → HOST FRAME via `window.parent.postMessage`** — the `BoardToHostMsg` union, handled in
   `BoardWebview.handleMessage` (`src/renderer/editors/board/BoardWebview.ts:307`). Two members are
   already request/reply with a `reqId`: `board:filePath` → `filePath:result`
   (`BoardWebview.resolveFilePath`, 500) and `board:var` → `var:result`
   (`BoardWebview.resolveVariable`, 519, delegating to
   `src/renderer/api/board-vars/board-vars-bridge.ts`).

Channel 2 is the correct home for `openContent`: the handler runs in the board's **own**
`BoardEditorModel` / `BoardWebview`, in the board's own window, under the same origin + source-frame
gate every other host message passes, and it can re-check trust. The shim side already has the
`filePathRpc` / `varRpc` pending-map idiom to copy (`src/board-shim.ts:316–355`, replies at 657–681).

### Gap 2 — graph color tokens (§3.5 / §5.1 / §4.7)

`src/renderer/theme/color.ts:95–110` defines a `graph` group of **14** tokens, and all ten themes in
`src/renderer/theme/themes/` define the source `--color-graph-*` vars (verified: `abyss`,
`default-dark`, `light-modern`, `monokai`, `quiet-light`, `red`, `solarized-dark`,
`solarized-light`, `tomorrow-night-blue`):

| `color.ts` key | source var |
|---|---|
| `background` | `--color-graph-bg` |
| `nodeDefault` | `--color-graph-node-default` |
| `nodeHighlight` | `--color-graph-node-highlight` |
| `nodeSelected` | `--color-graph-node-selected` |
| `nodeBorderDefault` | `--color-graph-border-default` |
| `nodeBorderHighlight` | `--color-graph-border-highlight` |
| `nodeBorderSelected` | `--color-graph-border-selected` |
| `linkDefault` | `--color-graph-link-default` |
| `linkSelected` | `--color-graph-link-selected` |
| `labelBackground` | `--color-graph-label-bg` |
| `labelText` | `--color-graph-label-text` |
| `groupBorder` | `--color-graph-group-border` |
| `nodeSpecial` | `--color-graph-node-special` |
| `borderSpecial` | `--color-graph-border-special` |

The board palette contract is `P_VAR_SOURCES` (`src/renderer/theme/p-vars.ts:21`), consumed twice:
- `installPVarBridge()` writes a `:root` stylesheet of `--p-x: var(--color-y)` indirections (host
  document, for av-grid);
- `computeBoardThemePalette()` (`src/renderer/editors/board/board-theme.ts:27`) resolves the same map
  to concrete hex with `resolveColor()` and ships it as `BoardThemePalette.vars`.

`BOARD_TOKEN_VARS` in the same file is **metrics only** (spacing/gap/radius/size/font) and is
theme-independent, so the graph family belongs in `P_VAR_SOURCES`, not there.

Delivery is already generic end-to-end: `board-protocol-service.ts:93` writes every
`design.theme.vars` entry into the injected `:root{}` style; `board-shim.ts:483 applyVars()`
re-applies every entry on a theme push; `ensureBoardThemeSubscription()` re-pushes on every switch.
So adding the names to `P_VAR_SOURCES` is enough for the **CSS** half, including `onThemeChange`.

The **JS** half (a `<canvas>` cannot consume `var(...)`) needs the values reachable as a shaped
object. The `boards-assets/chart-theme.js` / `mermaid-theme.js` precedent is a *downloadable JS
adapter that maps `--p-*` into a library's option object* — it exists because Chart.js and Mermaid
have their own config shapes. There is no third-party library here, so no adapter is warranted: the
values simply ride the palette the board already receives.

### Gap 3 — manifest content detection (§5.15)

`EDITOR_MATCHERS["graph-view"].detectsContent` (`src/renderer/editors/base/editor-matchers.ts:133`)
fires on `language === "json"` + `"type":"force-graph"` + `"nodes"`. `makeAccepts` (same file, 171)
only consults `detectsContent` when an `input.host` is supplied, reading
`host.state.get().content`, and scores it **60**. The host-bearing caller is
`editorRegistry.findEditorsAccepting(host)` — i.e. the **editor-switch widget only**;
`resolveForFile` / `resolve` pass no host, so content detection never changes which editor *opens a
file*. The board feature must have exactly that scope.

Board switch options are merged in `getEditorSwitchOptions`
(`src/renderer/editors/base/editor-switch-options.ts:17`): built-ins from
`model.findCompatibleEditors()`, boards from `customEditorRegistry.getBoardsForFile(fileName)` where
`fileName = filePath ?? hostState.title ?? editorState.title`. For an untitled page that is
`"untitled"` — which no `fileMask` matches, which is precisely the regression §5.15 describes.

`getBoardEditorAssociation` (`board-manifest.ts:300`) returns `null` when `fileMasks` is empty, so a
board declaring only `contentMasks` is not registered at all today.

### Files that need NO changes

`src/renderer/editors/graph/**` (US-1405 owns it) · `src/main/board-bridge.ts` (the port channel is
not used by any of the three additions) · `src/main/board-protocol-service.ts` (var injection is
already generic) · `src/renderer/theme/themes/*.ts` (all 14 source vars exist in all 10 themes) ·
`src/renderer/theme/color.ts` · `src/renderer/content/resolvers.ts` and
`PagesLifecycleModel.newEditorModel` (content detection must NOT reach file-open resolution) ·
`src/renderer/components/icons/language-icon-resolver.ts` (icons are path-keyed; content masks have
no path).

## Implementation plan

### Step 1 — `--p-graph-*` in the palette contract

**`src/renderer/theme/p-vars.ts`** — append to `P_VAR_SOURCES`, after `--p-shadow`, with a short
comment block:

```ts
    // Graph family (EPIC-100 / US-1404) — the 14 dedicated force-graph colors. A board
    // drawing a graph on a <canvas> cannot consume `var(...)`, so these also arrive as
    // concrete values on `persephone.getTheme().graph` (derived from the `--p-graph-*`
    // entries of `vars` by the board shim).
    "--p-graph-bg": "--color-graph-bg",
    "--p-graph-node-default": "--color-graph-node-default",
    "--p-graph-node-highlight": "--color-graph-node-highlight",
    "--p-graph-node-selected": "--color-graph-node-selected",
    "--p-graph-node-special": "--color-graph-node-special",
    "--p-graph-border-default": "--color-graph-border-default",
    "--p-graph-border-highlight": "--color-graph-border-highlight",
    "--p-graph-border-selected": "--color-graph-border-selected",
    "--p-graph-border-special": "--color-graph-border-special",
    "--p-graph-link-default": "--color-graph-link-default",
    "--p-graph-link-selected": "--color-graph-link-selected",
    "--p-graph-label-bg": "--color-graph-label-bg",
    "--p-graph-label-text": "--color-graph-label-text",
    "--p-graph-group-border": "--color-graph-group-border",
```

No other app change is needed: `installPVarBridge`, `computeBoardThemePalette`, the injected boot
style and `applyVars` all iterate the map.

### Step 2 — `getTheme().graph`

**`src/ipc/board-bridge-channels.ts`** — extend `BoardThemePalette`:

```ts
    /** The `--p-graph-*` family as concrete values, keyed by the camelCased suffix
     *  (`--p-graph-node-default` → `nodeDefault`). A canvas cannot consume `var(...)`.
     *  Optional on the wire: the renderer ships only `vars`, and the board SHIM derives
     *  this field, so it is always present on the palette a board actually sees. */
    graph?: Record<string, string>;
```

**`src/board-shim.ts`** —

- default boot literal (line ~63) stays as is (`graph` is optional);
- add, next to `applyVars`:

```ts
const P_GRAPH_PREFIX = "--p-graph-";

/** Derive `palette.graph` from the `--p-graph-*` entries of `vars`: the suffix, camelCased. */
function withGraphPalette(palette: BoardThemePalette): BoardThemePalette {
    const graph: Record<string, string> = {};
    for (const [name, value] of Object.entries(palette.vars || {})) {
        if (!name.startsWith(P_GRAPH_PREFIX)) continue;
        const key = name.slice(P_GRAPH_PREFIX.length)
            .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        graph[key] = value;
    }
    return { ...palette, graph };
}
```

- `let currentTheme: BoardThemePalette = withGraphPalette(boot.theme);`
- in `onPortMessage`, the `data.kind === "theme"` branch: `currentTheme = withGraphPalette(data.palette);`
  then `applyVars(currentTheme.vars)` and notify `themeCbs` with `currentTheme` (so `onThemeChange`
  fires with the graph family too).

Resulting keys: `bg`, `nodeDefault`, `nodeHighlight`, `nodeSelected`, `nodeSpecial`,
`borderDefault`, `borderHighlight`, `borderSelected`, `borderSpecial`, `linkDefault`,
`linkSelected`, `labelBg`, `labelText`, `groupBorder`.

**`src/renderer/editors/board/board-api.d.ts`** — add `PersephoneGraphPalette` (14 named keys) and
`graph: PersephoneGraphPalette` on `PersephoneThemePalette` (non-optional: the shim always fills it).

### Step 3 — `persephone.openContent(...)`

**`src/ipc/board-bridge-channels.ts`**

```ts
export interface BoardOpenContentRequest {
    editor?: string;
    language?: string;
    title?: string;
    content?: string;
}

export interface BoardOpenContentResultMsg {
    __persephone: "openContent:result";
    reqId: number;
    pageId?: string;
    error?: string;
}
```

Add `"board:openContent"` to the `BoardToHostMsg.__persephone` union plus an
`openContent?: BoardOpenContentRequest` field (documented next to `varArgs`).

**`src/renderer/editors/board/board-open-content.ts`** (new, modelled on `board-vars-bridge.ts`):

```ts
export interface BoardOpenContentReply { pageId?: string; error?: string }

/** Max content a board may push through `openContent` in one call (characters). */
const MAX_OPEN_CONTENT_CHARS = 16 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;

export function resolveBoardOpenContent(
    request: BoardOpenContentRequest,
): BoardOpenContentReply
```

Rules (each returning `{ error }`, never throwing):
- `editor` must be a non-empty string; reject any id starting with `BOARD_EDITOR_ID_PREFIX`
  ("A board cannot open another board with openContent().") — an explicit message instead of
  `addEditorPage`'s generic "not registered";
- `content` must be a string when present, and `≤ MAX_OPEN_CONTENT_CHARS`;
- `title` trimmed, truncated to `MAX_TITLE_CHARS`, empty → `"untitled"`;
- `language` defaults to `"plaintext"`;
- everything else is delegated to `pagesModel.addEditorPage(...)` inside a `try` / `catch (error)`
  → `{ error: errMessage(error) }` (`src/shared/utils.ts`), so registry / language / standalone-editor
  rejections reach the board verbatim;
- success → `{ pageId: page.id }`.

**`src/renderer/editors/board/BoardWebview.ts`**
- `legacy` cast gains `openContent?: BoardOpenContentRequest`;
- `case "board:openContent":` → `if (typeof legacy.reqId === "number") this.resolveOpenContent(...)`;
- `private resolveOpenContent(reqId, request, host, frame)`: **trust re-check**
  (`boardTrust.isTrusted(this.props.boardRoot)` — already imported for AiVision registration) →
  `{ error: "This board is not trusted." }`, else `resolveBoardOpenContent(request)`; reply with
  `BoardOpenContentResultMsg` to `frame.contentWindow` at `board://${host}` behind the same
  `this.live` / `generation` / `frame` liveness guard the other two resolvers use.

**`src/board-shim.ts`**
- `pendingOpenContent` map + `openContentReqId`, `openContentRpc(request)` mirroring `varRpc`;
- an `onHostMessage` handler for `"openContent:result"` mirroring `"var:result"`;
- public method on the bridge object:

```ts
    openContent(options: {
        editor: string; language?: string; title?: string; content?: string;
    }): Promise<string> { … }
```

**Security note to record in the code comment:** `openContent` is a *create-only* verb. It cannot
read, enumerate, navigate, close or mutate any existing page; the only handle it returns is the id of
a page the board itself just created (usable with `persephone.call` only if that page is the board's
own host page, which it never is). It runs on the page-scoped host-frame channel behind the board's
origin + source-frame gate and a live trust check, and it creates the page in the board's own window.
`persephone.call` therefore stays scoped exactly as before — `openContent` widens the surface by one
constructor, not by a page-model handle.

### Step 4 — `contentMasks`

**`src/renderer/editors/board/board-manifest.ts`**
- `BoardManifest.contentMasks?: string[]` — regex *sources* (JavaScript syntax), tested
  case-insensitively against the page's text content;
- `normalizeContentMasks(raw: unknown): string[]` — keep non-empty strings, de-duplicate, **drop any
  entry that does not compile** (`new RegExp(mask, "i")` inside try/catch) and any entry longer than
  `MAX_CONTENT_MASK_CHARS = 500`; non-array → `[]`;
- `matchesContentMasks(content: string, masks: string[]): boolean` — compile-once module `Map` cache
  keyed by the mask source, tested against the first `CONTENT_MATCH_LIMIT = 64 * 1024` characters
  (a marker-regex convention identical to the built-in `detectsContent`, which is documented as a
  "fast regex, no JSON parse"); `false` for empty masks or empty content;
- `BoardEditorAssociation.contentMasks: string[]`;
- `getBoardEditorAssociation`: compute `contentMasks` first and change the bail-out to
  `if (fileMasks.length === 0 && contentMasks.length === 0) return null;` — a board may now declare
  content detection alone. (`matchesBoardMasks` still requires a file-mask hit, so an empty
  `fileMasks` can never claim a file; and `editorPriority` still only applies on the file path, so a
  content-only board is a switch option, never a default.)

**`src/renderer/editors/board/custom-editor-registry.ts`**
- `CustomEditorMatch.contentMasks: string[]`, filled in `refresh()`;
- new sync getter:

```ts
    /** Boards whose `contentMasks` match this page's CONTENT. Switch-option scope only —
     *  content never decides which editor OPENS a file (mirrors `detectsContent`). */
    getBoardsForContent(content: string): CustomEditorMatch[]
```

**`src/renderer/editors/base/editor-switch-options.ts`**
- read `hostState?.content ?? ""`;
- `const contentMatches = content ? customEditorRegistry.getBoardsForContent(content) : []`;
- merge them into `boardMatches` (de-duplicated by `editorId`) **before** the locality filter, so a
  content match obeys the same `content-host`-only rule for a non-local source;
- `boardNameById` therefore covers them with no further change.

### Step 5 — docs, typings, bridge version

- `src/board-shim.ts` version comment + `version: "1.5.0"`.
- `assets/guides/agents/boards.md` — header version line; `openContent` in the **Integration tier**
  list next to `openRawLink`; the graph family in **Theme: the `--p-*` contract**; `contentMasks` in
  **Manifest, icon, reload**.
- `assets/board-template/CLAUDE.md` — the same four edits (header line 8, §Integration tier,
  §Theme, §Board identity manifest field list).
- `src/renderer/editors/board/board-api.d.ts` — `openContent`, `PersephoneGraphPalette`, and fix the
  stale `openRawLink(href)` signature to carry `options?: { editor?: string }`.

### Step 6 — verification

`npm run typecheck`, `npm run lint`, `npm run build-prod`.

## Concerns / open questions

1. **`getTheme().graph` key naming.** EPIC-100's snippet illustrates
   `{ node1..node5, link, linkHighlight, ... }`, which is a *categorical* palette and does not
   correspond to the 14 semantic tokens the same document mandates. Resolved in favour of the 14
   tokens, keyed by the camelCased CSS suffix, so the CSS and JS halves are one contract with a
   mechanical mapping. Recorded as a deviation.
2. **No JS adapter file in `boards-assets/`.** The `chart-theme.js` precedent exists to translate
   `--p-*` into a third-party library's option object. A force-graph board draws with its own canvas
   code, so the palette object is the whole adapter. Not adding a file keeps the catalog honest.
3. **`contentMasks` are regexes, not globs.** `fileMasks` are globs because they match names;
   content detection in the app is regex (`detectsContent`), and the epic's contract literally
   specifies a regex source. Masks that fail to compile are dropped at normalization, so a typo
   degrades to "no content detection" rather than breaking the registry.
4. **Content-mask cost.** Masks are compiled once and cached, tested against at most 64 KB, and only
   on the switch-options path (toolbar render / `page.editorSwitches`), not per keystroke.
5. **Manifest caching still applies.** Per §4.3, a manifest edit — including a new `contentMasks` —
   needs a trust toggle or an app restart. Unchanged by this task; called out in the guides.
6. **`openContent` content cap** is 16 M characters. Large enough for any realistic extracted
   subgraph, small enough that a runaway board cannot post a gigabyte through the frame boundary.

## Acceptance criteria

- [x] `persephone.openContent({ editor, language, title, content })` resolves to the new page's id,
      creating an in-memory untitled page in the requested editor in the board's own window.
- [x] It rejects with a readable message for an unknown editor, an unknown language, a standalone
      editor, a `board-editor:` id, oversized content, and an untrusted board.
- [x] It grants no read/enumerate/mutate access to any pre-existing page; `persephone.call` remains
      rooted at the board's hosting page.
- [x] All 14 `--p-graph-*` variables resolve inside a board frame at first paint and re-tint on a
      theme switch, in every one of the 10 themes.
- [x] `persephone.getTheme().graph` returns the 14 concrete values; `onThemeChange` delivers updated
      graph values on every switch.
- [x] A trusted board declaring `"contentMasks": ["\"type\"\\s*:\\s*\"force-graph\""]` appears as an
      editor-switch option on an **untitled** JSON page whose content matches, and does not appear
      when it does not match.
- [x] `contentMasks` never changes which editor opens a file.
- [x] A board may declare `contentMasks` with no `fileMasks` and still register.
- [x] `npm run typecheck`, `npm run lint`, `npm run build-prod` all pass.
- [x] Bridge version is 1.5.0 in `board-shim.ts`, `assets/guides/agents/boards.md` and
      `assets/board-template/CLAUDE.md`; all three additions are documented for board authors and in
      `board-api.d.ts`.
- [x] `src/renderer/editors/graph/**` is untouched.

## Verification

`npm run typecheck`, `npm run lint` and `npm run build-prod` all pass.

Live checks against the running app (`script.execute`):
- `getComputedStyle(document.documentElement).getPropertyValue("--p-graph-node-default")` → `#00bfff`,
  i.e. the new family resolves through `installPVarBridge()` on the host document (and therefore
  through `computeBoardThemePalette()` into a board frame).
- `normalizeContentMasks(['"type"\s*:\s*"force-graph"', '(', ''])` → only the valid mask survives;
  `matchesContentMasks` returns `true` for matching graph JSON and `false` for `"todo-editor"` JSON;
  `getBoardEditorAssociation({ schemaVersion: 1, contentMasks: ["x"] })` now returns an association
  with empty `fileMasks`.

The end-to-end board-frame paths (`persephone.openContent`, `getTheme().graph`, a board offered on
an untitled page by `contentMasks`) are exercised by BT-014/BT-015 in the boards repo, which is the
first consumer.

## Files changed

| File | Change |
|---|---|
| `src/renderer/theme/p-vars.ts` | +14 `--p-graph-*` entries in `P_VAR_SOURCES` |
| `src/ipc/board-bridge-channels.ts` | `BoardThemePalette.graph`; `BoardOpenContentRequest`; `BoardOpenContentResultMsg`; `board:openContent` in `BoardToHostMsg` |
| `src/board-shim.ts` | `withGraphPalette`; `openContent()` + pending map + result handler; version 1.5.0 |
| `src/renderer/editors/board/board-open-content.ts` | **new** — validation + `pagesModel.addEditorPage` |
| `src/renderer/editors/board/BoardWebview.ts` | `board:openContent` case + `resolveOpenContent` |
| `src/renderer/editors/board/board-manifest.ts` | `contentMasks` field, `normalizeContentMasks`, `matchesContentMasks`, association change |
| `src/renderer/editors/board/custom-editor-registry.ts` | `contentMasks` on the match, `getBoardsForContent` |
| `src/renderer/editors/base/editor-switch-options.ts` | merge content-matched boards |
| `src/renderer/editors/board/board-api.d.ts` | `openContent`, `PersephoneGraphPalette`, `openRawLink` options |
| `assets/guides/agents/boards.md` | bridge version, `openContent`, graph palette, `contentMasks` |
| `assets/board-template/CLAUDE.md` | same four edits |
