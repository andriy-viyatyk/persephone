# 13 — MCP integration

Status: Done (2026-05-20). Tier 4 cross-cutting walkthrough — closes Tier 4. Zero mockup adjustments.

## What exists today

**Files**
- `src/renderer/api/mcp-handler.ts` — the renderer-side IPC dispatcher. Receives `MCP_EXECUTE` from the main process and dispatches to per-method handlers; replies with `MCP_RESULT`.
- `src/main/mcp-http-server.ts` — the main-process HTTP transport (Streamable HTTP / SSE). MCP clients (Claude Code, Anthropic Console, etc.) speak JSON-RPC over HTTP; the server forwards each request to the renderer via `MCP_EXECUTE`.
- `src/renderer/api/pages/well-known-pages.ts` — declares `mcp-ui-log` and `mcp-server-log` as well-known pages with `editor: "log-view"`.

**Method surface (`handleCommand` in `mcp-handler.ts`)**
- `execute_script` — runs a script with optional `pageId` anchor; returns captured output.
- `get_pages` — flat list with `{ id, title, type, editor, language, filePath, modified, pinned, active }`.
- `get_page_content` — `{ pageId }` → `{ id, title, content }`. Gates on `isTextFileModel(editor)`.
- `get_active_page` — same flat shape as `get_pages` row, plus `content`.
- `create_page` — `{ content, language, editor, title }` → creates a page via `pagesModel.addEditorPage`. Rejects `editorDef.category === "standalone"` with per-editor hints.
- `set_page_content` — `{ pageId, content }`. Gates on `isTextFileModel(editor)` then calls `editor.changeContent(content)`.
- `get_app_info` — `{ version, pageCount, activePageId }`.
- `open_url` — delegates to `pagesModel.openUrlInBrowserTab`.
- `ui_push` — appends LogView entries to `mcp-ui-log`; awaits user response for `input.*` dialog entries.
- `browser_*` (Playwright-compatible) — delegates to `automation/commands.ts`.

**Today's load-bearing patterns**
1. **Flat editor-state read in three sites** (`getPages`, `getActivePage`, plus `getPages`-equivalent inlined in `get_active_page`): `editor.state.get()` exposes `type`, `editor`, `language`, `filePath` directly because today's `IEditorState` is a flat shape on TextEditorModel.
2. **`isTextFileModel(editor)` gate in two sites** (`getPageContent`, `setPageContent`): today's content-bearing predicate.
3. **`acquireViewModelSync("log-view")` in three sites** (`getOrCreateMcpLogViewModel`, `logIncomingRequest`, `showMcpRequestLog`): MCP creates the well-known log page as a TextFileModel with `state.editor = "log-view"`, then sync-acquires the `LogViewModel` content view to call `addEntry` / `addDialogEntry`. This is the canonical `ContentViewModelHost` flow — a TextFileModel host with a swappable content view-model on top.
4. **Standalone-editor filter in `createPage`** (`editorDef.category === "standalone"`): rejects browser-view / pdf-view / image-view / mcp-view / about-view / settings-view with per-editor `execute_script` hints. The category field is registry metadata.
5. **`scriptRunner.runWithCapture(script, pageModel?.mainEditor ?? undefined, language)`** in `executeScript`: passes the main editor as a context anchor for the `page` object inside the script.
6. **In-process IPC** — the renderer is the model layer; main-process HTTP just shuttles JSON.

## What the new architecture needs to support

Functional requirements (no regressions vs. today):
- `create_page` must produce the same observable page shapes as today (Monaco, Grid, Markdown, Mermaid, Notebook, Todo, etc.).
- `get_pages` / `get_active_page` must surface enough page metadata to drive MCP clients — at minimum `editor` (registry id) and `language` for text-bearing pages.
- `set_page_content` must mutate content for any page whose host is `TextFileModel` (matches today's `isTextFileModel` gate semantics).
- `ui_push` must continue to write to the same well-known `mcp-ui-log` page; dialog entries return a `Promise<LogEntry>` resolved when the user clicks a button.
- `mcp-server-log` request log continues to receive each MCP request via `logIncomingRequest`.

New under EPIC-028:
- `IEditorState.type` retires (S10); host-owned fields (`language`, `filePath`) move to the host (P4 + C1 + GK2).
- `isTextFileModel(editor)` retires (S10); replaced by `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` (GK2 / T2).
- `ContentViewModelHost` + `acquireViewModelSync` retires (SF2); each EditorModel IS its own viewmodel. LogView becomes an `EditorModel` subclass directly (`LogViewEditorModel`), and well-known pages with `editor: "log-view"` produce that class as `page.mainEditor` (per EW3).
- `EditorDefinition.category` retires (registry mockup line 244); replaced by `hasContentHost: boolean` (line 93).

## How the foundation mockups handle this

| Today (mcp-handler.ts) | After EPIC-028 |
|---|---|
| `editor.state.get().type` | gone (S10) — drop from wire; if a discriminator is ever needed, use `editor.editorId` |
| `editor.state.get().editor` | `editor.editorId` (S10) |
| `editor.state.get().language` | `editor.contentHost?.state.get().language` (P4) |
| `editor.state.get().filePath` | `pagesModel.query.getTextFileHost(p.id)?.state.get().filePath` (GK2 / T2) |
| `isTextFileModel(editor)` | `pagesModel.query.getTextFileHost(pageId)` truthy check (GK2 / T2) |
| `editor.changeContent(content)` | `host.changeContent(content)` (IContentHost contract; host comes from the GK2 helper) |
| `editorDef.category === "standalone"` | `!editorDef.hasContentHost` (registry mockup line 93) |
| `pagesModel.addEditorPage(editor, language, title, content)` | Same signature — EW2 rewrites internals to `createEditor + applyRestoreData + restore`, MCP layer is a thin caller. |
| `editor.acquireViewModelSync("log-view") as LogViewModel` | `if (editor instanceof LogViewEditorModel)` direct access — page mainEditor IS the LogView editor model under EPIC-028 (no TextFileModel host underneath for log pages). |

## Concerns

### MI1 — `get_pages` / `get_active_page` wire-shape under host split — RESOLVED 2026-05-20

Today's response rows expose `{ id, title, type, editor, language, filePath, modified, pinned, active }`. After EPIC-028:
- `type` field has no source (the `IEditorState.type` discriminator retires per S10). MCP is an external API — external consumers may have written code against `type`.
- `editor` field maps cleanly to `editor.editorId`.
- `language` and `filePath` move from editor state to host state (P4 + C1).

Options:
- **(a) Drop `type`; keep `editor` + host-sourced `language`/`filePath`.** Matches the script API decision in walkthrough 12 / SF5 (`page.type` dropped from scripts because zero consumers). MCP is a thinner surface — same external consumers will see the same change.
- **(b) Preserve `type` for wire compat by deriving** — `type: "textFile"` when `editor.contentHost instanceof TextFileModel` else `editor.editorId`. Two-shape field; awkward.
- **(c) Drop the entire flat-row shape; redesign to `{ editor: { id, ... }, host: { kind, language, filePath, ... } | null, ... }`.** Cleaner but breaking; ripples through MCP clients (the read shape is `notepad://guides/pages` material).

Recommendation: **(a)**. Drop `type`. The script-API mirror (SF5) found zero consumers; MCP's external surface is small and the field is non-load-bearing for any documented flow (read `notepad://guides/pages` — it doesn't reference `type`). Update the `get_pages` / `get_active_page` row to: `{ id, title, editor, language, filePath, modified, pinned, active }`. Field source mapping below.

**Field mapping (after (a)):**

```typescript
// mcp-handler.ts — getPages() after EPIC-028
function getPages(): any[] {
    const pages = pagesModel.state.get().pages;
    return pages.map((p) => {
        const editor = p.mainEditor;
        const host = pagesModel.query.getTextFileHost(p.id);  // TextFileModel | null (GK2 / T2)
        return {
            id: p.id,
            title: p.title,
            editor: editor?.editorId,                          // S10
            language: editor?.contentHost?.state.get().language,  // P4
            filePath: host?.state.get().filePath,              // GK2-typed host
            modified: p.modified,
            pinned: p.pinned,
            active: p === pagesModel.activePage,
        };
    });
}
```

`getActivePage` follows the same shape with `content` appended (sourced from `host?.state.get().content`).

**Resolution: 2026-05-20** — Option **(a)** confirmed. Drop `type` field from `get_pages` and `get_active_page` response rows. `editor` field maps to `editor.editorId`; `language` reads from `editor.contentHost?.state.get().language`; `filePath` and `content` read through the GK2 / T2 `getTextFileHost(pageId)` helper. External MCP consumers see the same surface as script-API consumers post-SF5 (no `type` field). `notepad://guides/pages` documentation gets a minor refresh to drop the `type` field reference; the existing `editor` field semantics carry over verbatim (it was already the registry id under today's mapping). No mockup change required.

### MI2 — `setPageContent` / `getPageContent` gate translation — RESOLVED 2026-05-20

Today: `isTextFileModel(editor)` then `editor.state.get().content` (read) / `editor.changeContent(content)` (write). The function-form predicate retires per S10.

Options:
- **(a)** Inline `editor.contentHost instanceof TextFileModel`. Scattered predicate; one site per check.
- **(b)** Use the GK2 / T2 helper `pagesModel.query.getTextFileHost(pageId): TextFileModel | null`. One canonical helper, two callsites in `mcp-handler.ts`. Same pattern as PageTab (14 callsites — T2) and `requireGroupedText` (GK2).

Recommendation: **(b)**. Consistency with the rest of the codebase; the helper exists for exactly this reason.

```typescript
// mcp-handler.ts — getPageContent / setPageContent after EPIC-028
function getPageContent(params: any): McpResponse {
    const pageId = params?.pageId;
    if (!pageId) return { error: { code: -32602, message: "Missing 'pageId' parameter" } };

    const page = pagesModel.findPage(pageId);
    if (!page) return { error: { code: -32602, message: `Page not found: ${pageId}` } };

    const host = pagesModel.query.getTextFileHost(pageId);
    const content = host?.state.get().content ?? "";

    return { result: { id: page.id, title: page.title, content } };
}

function setPageContent(params: any): McpResponse {
    const pageId = params?.pageId;
    const content = params?.content;
    if (!pageId) return { error: { code: -32602, message: "Missing 'pageId' parameter" } };
    if (content == null || typeof content !== "string") {
        return { error: { code: -32602, message: "Missing or invalid 'content' parameter" } };
    }

    const page = pagesModel.findPage(pageId);
    if (!page) return { error: { code: -32602, message: `Page not found: ${pageId}` } };

    const host = pagesModel.query.getTextFileHost(pageId);
    if (!host) {
        return {
            error: {
                code: -32602,
                message: "Page is not a text-based page. Use execute_script with page facades (asGrid, asNotebook, etc.) for structured editors.",
            },
        };
    }

    host.changeContent(content);
    return { result: { id: page.id, title: page.title, contentLength: content.length } };
}
```

**Resolution: 2026-05-20** — Option **(b)** confirmed. Reuse `pagesModel.query.getTextFileHost(pageId)` helper from GK2 / T2. Both `getPageContent` (read) and `setPageContent` (write) gate through the typed host. Error message in `setPageContent` unchanged (still routes users to `execute_script` with `asX` facades for structured editors). No mockup change required.

### MI3 — `create_page` "standalone" filter under registry simplification — RESOLVED 2026-05-20

Today: `editorDef.category === "standalone"` rejects browser-view / pdf-view / image-view / mcp-view / about-view / settings-view. The registry mockup explicitly removes the `category` field (line 244) and adds `hasContentHost: boolean` (line 93). 

Are these the same gate? Today's "standalone" set under EPIC-028:
- `browser-view` → no host (Browser is direct-model per SF8); `hasContentHost: false`.
- `pdf-view` → no host; `hasContentHost: false`.
- `image-view` → no host; `hasContentHost: false`.
- `mcp-view` → no host (McpInspector direct-model per SF8); `hasContentHost: false`.
- `about-view` → no host (about is its own EditorModel — walkthrough 30); `hasContentHost: false`.
- `settings-view` → no host; `hasContentHost: false`.

So **`!editorDef.hasContentHost`** is exactly today's "standalone" filter. The gate flips mechanically.

What about edge cases:
- `compare` (CompareEditor) — not registered in the main registry per CK2 (stays a React component). `editorRegistry.getById("compare")` returns `undefined` → already filtered by the today's missing-editor branch.
- `explorer` — secondary-only editor, not registered in the main registry. Same: `getById("explorer")` returns `undefined`.
- `log-view` — `hasContentHost: false` (log-view IS its own EditorModel under EPIC-028, no TextFileModel host underneath). Today's standalone hint table has no `log-view` entry; under EPIC-028 it joins the rejection path. **This is a behavior change**: today, `create_page({ editor: "log-view" })` succeeds (creates a TextFileModel with `state.editor = "log-view"`); after EPIC-028, it fails with a "standalone editor" rejection.

Is this a regression? Looking at usage: nothing in the codebase calls `create_page({ editor: "log-view" })` (the well-known pages use `requireWellKnownPage`); external clients can use `ui_push` to write to the canonical log page. Likely safe — but worth flagging.

Options:
- **(a)** Accept the behavior change. Add a `"log-view"` entry to the hint table: `"Use ui_push to write entries to the MCP log page, or execute_script with: await app.pages.requireWellKnownPage(\"mcp-ui-log\")"`.
- **(b)** Special-case log-view as create_page-able — instantiate with empty state. Lets external clients create custom log pages.
- **(c)** Add a registry field `createPageable: boolean` (orthogonal to `hasContentHost`). Future-proof for log-view-like editors. Three fields where one might do.

Recommendation: **(a)**. The today's "standalone" rejection set was determined by `category` field; under EPIC-028 the same set is determined by `hasContentHost`. log-view is currently the only edge case (its `category` is `"content-view"` today because of the acquireViewModelSync flow; under EPIC-028 it's `hasContentHost: false`). The hint table already has the right shape — just add a `log-view` entry.

**Resolution: 2026-05-20** — Option **(a)** confirmed. Flip `editorDef.category === "standalone"` to `!editorDef.hasContentHost` (registry mockup line 93). The new gate matches the today "standalone" set verbatim across six editors (`browser-view`, `pdf-view`, `image-view`, `mcp-view`, `about-view`, `settings-view`), plus picks up `log-view` as a new addition (today's `category: "content-view"` was an artifact of the acquireViewModelSync flow that retires under SF2). Add a `log-view` entry to the standalone hints table: `"Use ui_push to write entries to the MCP log page, or execute_script with: await app.pages.requireWellKnownPage(\"mcp-ui-log\")"`. Behavior change documented but non-regressing — zero today-callers of `create_page({ editor: "log-view" })`. Rejected (b) special-case log-view as create_page-able (no concrete use case) and (c) new `createPageable` registry field (three fields where one does the work). No mockup change required.

### MI4 — Log View VM acquisition retirement — RESOLVED 2026-05-20

Today: `editor.acquireViewModelSync("log-view") as LogViewModel | undefined` at three sites (`getOrCreateMcpLogViewModel`, `logIncomingRequest`, `showMcpRequestLog`). Under SF2 the whole `acquireViewModelSync` machinery retires; each EditorModel IS its own viewmodel.

Under EPIC-028, `LogViewModel` (today an `extends ContentViewModel<LogViewState>`) becomes a direct `EditorModel<LogViewState>` subclass — call it `LogViewEditorModel` (final name finalized in walkthrough 23). The well-known def `{ id: "mcp-ui-log", editor: "log-view", ... }` produces a page whose `mainEditor` is an instance of that class. No TextFileModel underneath. The class still exposes `addEntry(type, fields)` and `addDialogEntry(type, fields)` (these are the data-mutation methods, not viewmodel-acquisition methods).

The three MCP sites flip mechanically:

```typescript
// getOrCreateMcpLogViewModel — after EPIC-028
async function getOrCreateMcpLogViewModel(): Promise<LogViewEditorModel> {
    const page = await pagesModel.requireWellKnownPage(MCP_UI_LOG_ID);
    const editor = page.mainEditor;
    if (!(editor instanceof LogViewEditorModel)) {
        throw new Error("MCP log page is not a LogView editor");
    }
    return editor;
}
```

```typescript
// logIncomingRequest — after EPIC-028
const logPage = pagesModel.findPage("mcp-server-log");
const logEditor = logPage?.mainEditor;
if (logEditor instanceof LogViewEditorModel) {
    logEditor.addEntry("output.mcp-request", requestHistory[requestHistory.length - 1]);
}
```

```typescript
// showMcpRequestLog — after EPIC-028
export async function showMcpRequestLog(): Promise<void> {
    const page = await pagesModel.requireWellKnownPage("mcp-server-log");
    const editor = page.mainEditor;
    if (!(editor instanceof LogViewEditorModel)) return;

    if (editor.state.get().entries.length === 0 && requestHistory.length > 0) {
        for (const entry of requestHistory) {
            editor.addEntry("output.mcp-request", entry);
        }
    }
}
```

The `isTextFileModel(editor)` guard that wrapped the today's `acquireViewModelSync` call **goes away** at all three sites — under EPIC-028 the log-view page's `mainEditor` is the LogView editor itself, never a TextFileModel.

Options:
- **(a)** Direct `instanceof LogViewEditorModel` checks at all three sites (as shown above).
- **(b)** A helper `pagesModel.query.getLogViewEditor(pageId): LogViewEditorModel | null` mirroring the GK2 / T2 `getTextFileHost` pattern. Three callsites — same threshold as GK2 / T2 (a few callsites is enough to centralize).

Recommendation: **(a)**. Only one editor class consumes this gate (LogViewEditorModel); the predicate has one shape; the three callsites are all in one file (`mcp-handler.ts`). GK2 / T2's helper paid off across two files and 15 callsites; here the cost/benefit doesn't justify the helper. If a fourth callsite ever appears, promote to (b).

**Resolution: 2026-05-20** — Option **(a)** confirmed. Three callsites in `mcp-handler.ts` (`getOrCreateMcpLogViewModel`, `logIncomingRequest`, `showMcpRequestLog`) flip from `isTextFileModel(editor) && editor.acquireViewModelSync("log-view") as LogViewModel | undefined` to direct `editor instanceof LogViewEditorModel` checks. The `isTextFileModel(editor)` guard that wrapped today's `acquireViewModelSync` call goes away at all three sites — under EPIC-028 the log-view page's `mainEditor` is the LogView editor itself, never a TextFileModel. No helper; cost/benefit doesn't justify centralization for one class at three sites in one file (GK2 / T2's helper paid off across two files and 15 callsites). LogView's final class name (`LogViewEditorModel` placeholder used here) finalized in walkthrough 23. SF2 already retires the `acquireViewModelSync` machinery; this walkthrough applies the consequence at three new sites. No mockup change required.

### MI5 — `create_page` content/language pipeline under EW2 — RESOLVED 2026-05-20

Today: `pagesModel.addEditorPage(editor, language, title, content)` creates a TextFileModel with `state.editor = editor` and `state.content = content`. Under EPIC-028 / EW2, `addEditorPage` rewrites to `createEditor(editorId) + applyRestoreData({title, host: {kind: "textFile", state: {content, language}}}) + restore()`.

Does the MCP `create_page` flow need any change beyond the call site? It already passes through `pagesModel.addEditorPage(editor, language, title, content || undefined)`. The signature stays the same. EW2 covers the internals.

Wait — the return shape today reads `page.mainEditor?.state.get()` for `editor` and `language` fields:

```typescript
const s = page.mainEditor?.state.get();
return {
    result: {
        id: page.id,
        title: page.title,
        editor: s?.editor,        // S10 retires this
        language: s?.language,    // P4 — host-owned
    },
};
```

Same translation as MI1 (drop `s?.type`, source `editor` from `editorId`, source `language` from host).

```typescript
// createPage return shape after EPIC-028
return {
    result: {
        id: page.id,
        title: page.title,
        editor: page.mainEditor?.editorId,
        language: page.mainEditor?.contentHost?.state.get().language,
    },
};
```

Options:
- **(a)** Apply the same field-mapping as MI1 (mechanical translation).
- **(b)** Wait until EW2's real-code implementation lands and confirm field availability at that point.

Recommendation: **(a)**. The translation is mechanical and covered by upstream resolutions (S10 + P4). Confirmation only.

**Resolution: 2026-05-20** — Option **(a)** confirmed. `createPage` return shape applies the same MI1 field-mapping: `editor: page.mainEditor?.editorId` (S10), `language: page.mainEditor?.contentHost?.state.get().language` (P4). `addEditorPage(editor, language, title, content)` signature unchanged per EW2; internals rewrite to the `createEditor + applyRestoreData + restore` three-phase lifecycle. No mockup change required.

### MI6 — `ui_push` LogViewModel API surface preservation — RESOLVED 2026-05-20

Today: `ui_push` calls `vm.addEntry(type, fields)` and `vm.addDialogEntry(type, fields)` on the acquired `LogViewModel`. The dialog method returns `Promise<LogEntry>` resolved when the user clicks. After SF2 / MI4 the class becomes `LogViewEditorModel`.

Does the API surface preserve? `addEntry` and `addDialogEntry` are data-mutation methods, not viewmodel-acquisition methods. They survive the class rename. Walkthrough 23 (LogView) finalizes the exact signature and `pendingDialogs` Promise registry. MCP's call shape doesn't change beyond the receiver class.

```typescript
// handleUiPush — after EPIC-028
const editor = await getOrCreateMcpLogViewModel();  // returns LogViewEditorModel
// ... validation unchanged ...
dialogPromises.push(editor.addDialogEntry(type, fields));    // same call shape
// ... or ...
editor.addEntry(type, fields);                                // same call shape
```

Recommendation: confirmation. Walkthrough 23 finalizes the method signatures (and validates `pendingDialogs` survives the migration); MCP layer is a thin caller.

**Resolution: 2026-05-20** — Confirmation. `addEntry(type, fields)` and `addDialogEntry(type, fields)` are LogView-internal data mutators; class rename from `LogViewModel` to `LogViewEditorModel` doesn't change call shape. `Promise<LogEntry>` contract on `addDialogEntry` preserved. Walkthrough 23 finalizes the per-class API surface. No mockup change required.

### MI7 — Dialog promise lifecycle under script teardown — RESOLVED 2026-05-20

Today: `dialogPromises.push(vm.addDialogEntry(type, fields))` accumulates promises across all entries in one `ui_push` call, then `await Promise.all(dialogPromises)`. The promises are stored in `vm.pendingDialogs` (a Map keyed by entry id) until the user clicks a button.

Under EPIC-028, what happens if the page is closed before the user responds?
- Today: `LogViewModel` survives because TextFileModel owns its content cache; the VM instance is reused across acquire cycles. Closing the page disposes the editor → the VM's `pendingDialogs` is dropped → MCP awaits forever (or until timeout in the client).
- After EPIC-028: `LogViewEditorModel` is the editor. Closing the page calls `editor.dispose()` → the `pendingDialogs` map is dropped → MCP awaits forever (same behavior).

Is this a regression? No — same observable behavior. The right fix (whenever someone gets to it) is to reject pending dialogs in `LogViewEditorModel.dispose()` with a "page closed before dialog response" error so MCP's `await Promise.all(dialogPromises)` rejects cleanly. This is symmetric with ComponentQueue's `dispose()` rejecting pending requests (SF6 / B1 mockup).

Options:
- **(a)** Defer to walkthrough 23. Same observable behavior as today; the cleanup hook is walkthrough 23's responsibility (it owns the LogView class).
- **(b)** Add the dispose-rejects-pending-dialogs contract here as a forward-pointer to walkthrough 23.

Recommendation: **(b)**. Pin the contract here so walkthrough 23 has a checklist item. Cost is one paragraph.

**Resolution: 2026-05-20** — Option **(a)** selected (correcting the recommendation). Verified — today's `LogViewModel.onDispose()` at `src/renderer/editors/log-view/LogViewModel.ts:72-80` already iterates `pendingDialogs` and resolves each with a sentinel canceled-button entry (`{ type: "", id, timestamp: 0 }` — `button: undefined` reads as canceled at the consumer), then clears the map. The cleanup logic is internal to LogViewModel today; it survives the class rename to `LogViewEditorModel` under EPIC-028 (modulo any `onDispose` → `dispose` method-name reshape walkthrough 23 picks). No new dispose contract needed at the MCP layer or in walkthrough 23 — the cleanup is already in place. The previous `pendingDialogs`-leaks-on-close framing was a misread of today's behavior; today's `await Promise.all(dialogPromises)` in `handleUiPush` resolves cleanly when the log page is closed because each dialog's `resolve` already fires from `onDispose`. Rejected (b) forward-pointer to walkthrough 23 (would document a contract already met by today's code). No mockup change required.

### MI8 — `executeScript` `pageModel.mainEditor` argument under host split — RESOLVED 2026-05-20

Today: `scriptRunner.runWithCapture(script, pageModel?.mainEditor ?? undefined, language)` — the second argument is the main editor used as the `page` anchor inside the script. The script's `page` object is built via `new PageWrapper(mainEditor, ...)` (walkthrough 12).

Under EPIC-028:
- `pageModel.mainEditor` is now an `EditorModel | null` (could be null for empty-with-sidebar pages — EW9). The `?? undefined` already handles the null case.
- PageWrapper construction drops the `releaseList` constructor parameter (SF3). `scriptRunner.runWithCapture` builds the wrapper internally — no MCP-layer change.

Confirmation only.

Recommendation: no change at the MCP layer. Walkthrough 12's PageWrapper rewrite handles the consequence.

**Resolution: 2026-05-20** — Confirmation. `scriptRunner.runWithCapture(script, pageModel?.mainEditor ?? undefined, language)` carries over verbatim. `pageModel.mainEditor` is now `EditorModel | null` (could be null for empty-with-sidebar pages per EW9); the `?? undefined` already handles the null case. PageWrapper construction is scripting-internal per SF3 (no `releaseList` parameter); MCP doesn't see the change. No mockup change required.

### MI9 — `openUrl` browser-tab flow — RESOLVED 2026-05-20

Today: `await pagesModel.openUrlInBrowserTab(url, { profileName, incognito })`. Internal: creates a browser-view EditorModel under EPIC-028 (walkthrough 30 — no-host group). Browser is direct-model (SF8). The `openUrlInBrowserTab` page-level method abstracts the editor creation.

Does the MCP layer need any change? The page-level method's signature stays the same — internals migrate to the new editor creation under EW2's pattern (but for a no-host editor). MCP layer is a thin caller.

Confirmation only.

**Resolution: 2026-05-20** — Confirmation. `pagesModel.openUrlInBrowserTab(url, options)` page-level method unchanged at the MCP call site. Browser editor's internal migration is walkthrough 30's responsibility (no-host group); MCP layer is a thin caller. No mockup change required.

### MI10 — `browser_*` automation command translation — RESOLVED 2026-05-20

Today: `handleBrowserCommand(method, params)` from `automation/commands.ts` handles all `browser_*` methods (Playwright-compatible). The dispatcher in `mcp-handler.ts` delegates with a single dynamic import.

The automation layer reads `pagesModel.activePage?.mainEditor` and gates on browser-view editor type. Under EPIC-028, the gate flips from `state.type === "browserPage"` to `editor instanceof BrowserEditorModel` (per SF8 — same flip applied to BrowserEditorFacade).

Does the MCP dispatcher itself need any change? No — the delegation is by-prefix and the automation layer owns its own gates. `automation/commands.ts` rewrites happen in walkthrough 30 (Browser editor under no-host group).

Confirmation only.

**Resolution: 2026-05-20** — Confirmation. MCP dispatcher's `browser_*` delegation in `mcp-handler.ts` unchanged — by-prefix delegation to `automation/commands.ts` (dynamic import) survives the editor refactor. The automation layer's `state.type === "browserPage"` gate flips to `editor instanceof BrowserEditorModel` per SF8; walkthrough 30 owns that rewrite. No MCP-layer or mockup change required.

## Mockup adjustments

None proposed for walkthrough 13. Every concern collapses to either a mechanical translation of upstream resolutions (S10, P4, GK2 / T2, SF2, SF8, EW2, EW3) or a forward-pointer to walkthrough 23 (LogView's dispose contract per MI7).

The MCP integration is mostly mechanical under EPIC-028:
- Field mapping per S10 + P4: `state.type` → drop, `state.editor` → `editorId`, `state.language` → `contentHost.state.language`.
- Host gate per GK2 / T2: `isTextFileModel(editor)` → `getTextFileHost(pageId)`.
- LogView VM per SF2 + MI4: `acquireViewModelSync("log-view")` → `editor instanceof LogViewEditorModel`.
- Registry filter per registry simplification: `category === "standalone"` → `!hasContentHost`.

## Closure

| Concern | Decision | Source / mechanism |
|---|---|---|
| MI1 | (a) Drop `type` from response rows; map `editor`/`language`/`filePath` to new sources | S10 + P4 + GK2 / T2 |
| MI2 | (b) Reuse `pagesModel.query.getTextFileHost(pageId)` for read/write gates | GK2 / T2 |
| MI3 | (a) Flip standalone filter to `!hasContentHost`; add `log-view` hint | Registry simplification |
| MI4 | (a) Direct `instanceof LogViewEditorModel` at three sites | SF2 + walkthrough 23 |
| MI5 | (a) `createPage` return-shape mapping mechanical | S10 + P4 (mirrors MI1) |
| MI6 | Confirmation — `addEntry` / `addDialogEntry` API surface preserved | Walkthrough 23 |
| MI7 | (a) No new contract — today's `LogViewModel.onDispose` already cancels pending dialogs | LogViewModel.ts:72-80 |
| MI8 | Confirmation — `executeScript` mainEditor arg unchanged | SF3 |
| MI9 | Confirmation — `openUrlInBrowserTab` page-level call unchanged | Walkthrough 30 |
| MI10 | Confirmation — `browser_*` delegation unchanged | Walkthrough 30 |

**Migration scope handed off:**
- `src/renderer/api/mcp-handler.ts` — rewrite:
  - `getPages` row shape: drop `type`, source `editor` from `editorId`, source `language` from `contentHost.state.language`, source `filePath` via `getTextFileHost(p.id)?.state.get().filePath` (MI1).
  - `getActivePage` shape: same as getPages + `content` from `getTextFileHost(pageId)?.state.get().content` (MI1).
  - `getPageContent` + `setPageContent`: use `pagesModel.query.getTextFileHost(pageId)` for the gate and host write (MI2).
  - `createPage`: flip `editorDef.category === "standalone"` to `!editorDef.hasContentHost`; add `log-view` hint entry; return shape uses `editorId` + `contentHost.state.language` (MI3 + MI5).
  - `getOrCreateMcpLogViewModel`, `logIncomingRequest`, `showMcpRequestLog`: replace `isTextFileModel(editor) && editor.acquireViewModelSync("log-view") as LogViewModel | undefined` with `editor instanceof LogViewEditorModel` direct checks (MI4).
- `src/renderer/api/pages/PagesQueryModel.ts` (or equivalent) — `getTextFileHost(pageId): TextFileModel | null` helper already required by GK2 / T2; this walkthrough adds two more callers.
- `src/renderer/editors/log-view/LogViewModel.ts` → `LogViewEditorModel.ts` — rename + migration to direct `EditorModel<LogViewState>` subclass. Walkthrough 23 owns the migration. `addEntry` and `addDialogEntry` method signatures preserved. `dispose()` rejects pending dialog promises (MI7 forward-pointer).
- `src/renderer/editors/registry.ts` — `category` field retires per registry mockup; `hasContentHost: boolean` lands as the new gate. Per-editor registrations update.
- `notepad://guides/pages` documentation — drop `type` field reference; `editor` field semantics unchanged (it was already the registry id).
- `automation/commands.ts` — `state.type === "browserPage"` → `editor instanceof BrowserEditorModel` gate flip (MI10 forward-pointer; walkthrough 30 owns the rewrite).
- `src/main/mcp-http-server.ts` — unchanged. Transport layer is below the renderer-side IEditorState split.

**Net effect:** MCP integration is the smallest Tier 4 walkthrough — every concern collapsed to mechanical translation of upstream resolutions or "today's code already does it" (MI7). No new foundation primitive, no new helper, no mockup change. The wire-shape change (drop `type`) is the only externally-visible delta and mirrors the script-API decision in SF5. Log View VM acquisition retirement (MI4) lands the SF2 consequence at three new sites; LogView's class rename and method signatures finalize in walkthrough 23 with the existing `onDispose` pending-dialog cleanup carrying over unchanged.

**Tier 4 cross-cutting complete.** Walkthroughs 12 (Scripting facades) and 13 (MCP integration) both done; design is stable across both. Tier 5 (per-editor walkthroughs) begins next with walkthrough 20 — Monaco / Text.
