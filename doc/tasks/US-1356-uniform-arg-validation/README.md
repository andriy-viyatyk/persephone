# US-1356: Extract the argument validator and end the silent no-op class

**Status:** Completed 2026-09-07 (reviewed at epic close)

Epic: [EPIC-091](../../epics/EPIC-091.md), report section 2 (all twelve rows) plus the missed
deleteRows site.

## Goal

Extract one process-neutral argument-validation module, then apply it to the thirteen confirmed
silent or misleading call sites. Every rejected value must be named with its actual type, the valid
values or their authoritative path must be available, and the message must include a copy-paste
example. This task does not rewrite the eight sites whose validation already works.

## Background

The report's premise is corrected: there is no existing shared argument validator.
addEditorPage constructs messages inline (src/renderer/api/pages/PagesLifecycleModel.ts:264-280),
openUrl has its own URL-specific module
(src/renderer/api/pages/open-url-validation.ts:11-16,23-30,77-101), and highlight uses the
createElements unknown-name hook (src/renderer/scripting/ai-vision/elements.ts:99-145). The
report's supposed deleteRows standard does not exist: GridEditorFacade.deleteRows delegates
straight to the editor (src/renderer/scripting/api-wrapper/GridEditorFacade.ts:185-187), and
GridEditor.deleteRows filters unknown keys away
(src/renderer/editors/grid/GridEditor.ts:715-723).

The new module belongs in src/shared/ai-vision/. The shared resolver is explicitly process-neutral
and resolves both the main-process tree and renderer tree
(src/shared/ai-vision/resolver.ts:7-20). The main process resolves its local root and forwards
renderer paths (src/main/mcp/tools/call-tools.ts:132-152), while the renderer enters the same
resolver through src/renderer/scripting/ai-vision/call.ts:16-35. A renderer-only helper would split
a contract that crosses that boundary.

The closest implementation model is normalizeUiPushEntry: it defines structured specifications
with usage strings (src/renderer/api/mcp/ui-push-validation.ts:4-40), computes valid entries from
the same sources used for validation (src/renderer/api/mcp/ui-push-validation.ts:51-60), and
emits actionable errors with examples
(src/renderer/api/mcp/ui-push-validation.ts:90-108). The new module generalises that pattern; it
does not copy the Log View validator or alter it.

The resolver currently applies raw args directly to methods
(src/shared/ai-vision/resolver.ts:134-155). Therefore AiRoot.helpSearch coerces every non-string
query before search (src/renderer/scripting/ai-vision/root.ts:173-175), ToolsNode.search turns
non-strings into an empty query for selection but forwards the raw value
(src/renderer/scripting/ai-vision/namespaces/tools.ts:184-200), and version is read even when
args is supplied because it is a property
(src/shared/ai-vision/resolver.ts:141-155).

helpSearch's core accepts a string and uses limit only at slice(0, limit)
(src/shared/ai-vision/help-search.ts:24-26,63-65). This task validates limit's type but does not
clamp or otherwise bound it; limit clamping belongs to US-1357 and must not edit that line in
both tasks.

## Review correction (2026-09-07)

The independent review found that the first shared-validator implementation checked an
`arrayOfChoicesRule` value against the choices as one array, so the valid call
`grid.deleteRows(["0"])` was rejected. The validator now checks the array element type and compares
each element with the live choices, naming the failing index in an error. Valid row-key arrays pass
through to the existing grid mutation; the eight pre-existing validation sites remain outside this
module by decision.

## Implementation Plan

### Half 1 — extract the shared validator first

1. Add src/shared/ai-vision/argument-validation.ts. Keep it independent of Electron, renderer
   facades, MCP transport, and editor models. Export one small validation contract, an
   ArgumentValidationError, and the helpers needed by the listed sites:

   - positional arity validation, including required versus optional parameters and a maximum;
   - required/optional type validation with real type labels (null and arrays must not be reported
     only as JavaScript's object);
   - numeric minimum validation for grid.addRows(count), without adding a minimum to
     helpSearch(limit);
   - dynamic choice validation whose valid values can be supplied by a live callback, with an
     optional validValuesPath for long lists; and
   - a no-arguments warning formatter for properties.

   Every rule carries the argument name and a copy-paste usage string. Choice errors quote the
   rejected value, report its type, enumerate current choices when short, and otherwise name the
   path that lists them.

2. In src/shared/ai-vision/resolver.ts, add warning?: string to ICallResult and make supplied
   request.args on a declared property produce a warning while returning the property value
   unchanged. Use the shared no-arguments formatter so version with args: ["unexpected"] is
   non-fatal: the MCP result contains the version and a warning, and isError remains false.
   Keep the existing args/value mutual-exclusion early return unchanged
   (src/shared/ai-vision/resolver.ts:63-68).

3. In src/main/mcp/tools/call-tools.ts, carry warning through ICallEnvelope and render it as a
   Warning: text block in toCallResult, alongside the normal result and before any hint. Do not
   turn it into error or isError: true; the current formatter makes that distinction at
   src/main/mcp/tools/call-tools.ts:239-265. The renderer-forwarding check is verified: handleCall
   awaits aiCall and returns { result } without enumerating ICallResult fields
   (src/renderer/api/mcp/call-command.ts:9-19). The field-enumerating main-side ICallEnvelope is
   at src/main/mcp/tools/call-tools.ts:194-204, so warning must be added there and rendered by
   toCallResult; call-command itself needs no edit.

### Half 2 — apply it to the thirteen sites, in this order

The snippets below are the implementation contract. The exact helper names may follow the module's
final export names, but the checks and ordering are fixed.

#### 1. helpSearch with args: [] — required query

Before, AiRoot.helpSearch accepts the missing value and turns it into an empty query
(src/renderer/scripting/ai-vision/root.ts:173-175):

~~~ts
helpSearch(query: string, limit?: number): Promise<IHelpSearchHit[]> {
    return helpSearch(this, String(query ?? ""), limit);
}
~~~

After, receive the raw positional list and validate it before calling the search core:

~~~ts
helpSearch(...args: unknown[]): Promise<IHelpSearchHit[]> {
    const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS);
    return searchHelp(this, query, limit);
}
~~~

args: [] must throw an argument error saying query is required and showing an example such as
helpSearch("grid"). A valid query that matches nothing remains a legitimate [] result
(src/shared/ai-vision/help-search.ts:24-26).

#### 2. helpSearch(123) — query type

Before, the same coercion hides the number (src/renderer/scripting/ai-vision/root.ts:173-175):

~~~ts
return helpSearch(this, String(query ?? ""), limit);
~~~

After, the shared rule rejects the raw first positional value before coercion:

~~~ts
const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS);
return searchHelp(this, query, limit);
~~~

The error names 123, reports number, says query must be a string, and gives a copy-paste
helpSearch("grid") example. String(query ?? "") is removed from this path.

#### 3. helpSearch(null) — missing query

Before, null is also converted to an empty string
(src/renderer/scripting/ai-vision/root.ts:173-175):

~~~ts
return helpSearch(this, String(query ?? ""), limit);
~~~

After, the same raw-argument validator distinguishes null/undefined from a present wrong type:

~~~ts
const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS);
return searchHelp(this, query, limit);
~~~

null produces the required-query error, not a string-type error and not [].

#### 4. helpSearch({ query: "grid" }) — positional arguments

Before, the object is coerced to "[object Object]" and reaches the empty-result path
(src/renderer/scripting/ai-vision/root.ts:173-175;
src/shared/ai-vision/help-search.ts:24-26):

~~~ts
return helpSearch(this, String(query ?? ""), limit);
~~~

After, the validator rejects an object supplied as the positional query value:

~~~ts
const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS);
return searchHelp(this, query, limit);
~~~

The error says helpSearch expects positional arguments, reports object, and shows
helpSearch("grid", 20). No object-to-string coercion is allowed.

#### 5. helpSearch("grid", "not-a-number") — limit type

Before, the wrapper passes the second value through and the core uses it as the slice limit
(src/renderer/scripting/ai-vision/root.ts:173-175;
src/shared/ai-vision/help-search.ts:24,63-65):

~~~ts
return helpSearch(this, String(query ?? ""), limit);
~~~

After, validate only that a supplied limit is a number, then pass it unchanged:

~~~ts
const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS);
return searchHelp(this, query, limit);
~~~

The error names "not-a-number", reports string, and shows helpSearch("grid", 20). Do not add
limit >= 1 or clamping here; US-1357 owns that behavior.

#### 6. helpSearch("grid", "x", "extra", "more") — excess arguments

Before, JavaScript accepts extra arguments because the wrapper declares parameters but does not
inspect raw argument count (src/renderer/scripting/ai-vision/root.ts:173-175):

~~~ts
helpSearch(query: string, limit?: number): Promise<IHelpSearchHit[]> {
    return helpSearch(this, String(query ?? ""), limit);
}
~~~

After, the rest-parameter form lets the shared arity rule see all four values:

~~~ts
helpSearch(...args: unknown[]): Promise<IHelpSearchHit[]> {
    const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS, { maxArgs: 2 });
    return searchHelp(this, query, limit);
}
~~~

Throw an argument error with the received count/values and a valid two-argument example. Excess
arguments to a method are always an error. A method has a signature the caller has evidently
misread, and an extra positional value may be a real argument in the wrong slot; returning a
result computed from a signature the caller does not believe in is how a wrong answer gets
reported as a right one. This differs from the property rule in section 12: a property takes no
arguments at all and its value is unambiguous, so the read succeeds and the caller is warned. The
call must not search.

#### 7. grid.addRows("five") — count type

Before, the facade passes the string to GridEditor.addRows, whose Array.from length operation
produces no rows rather than an argument error
(src/renderer/scripting/api-wrapper/GridEditorFacade.ts:181-183;
src/renderer/editors/grid/GridEditor.ts:700-713):

~~~ts
addRows(count = 1, insertIndex?: number): unknown[] {
    return this.editor.addRows(count, insertIndex);
}
~~~

After, validate the first raw argument in the facade and retain the editor implementation:

~~~ts
addRows(count: unknown = 1, insertIndex?: unknown): unknown[] {
    const [validCount] = validateCallArguments("grid.addRows", [count], GRID_ADD_ROWS_ARGUMENTS);
    return this.editor.addRows(validCount, insertIndex as number | undefined);
}
~~~

The error names "five", reports string, requires numeric count, and shows grid.addRows(1). Do not
move the check into GridEditor; the facade is the call-surface boundary.

#### 8. grid.addRows(-3) — count range

Before, the negative length yields the silent empty result through the same two methods
(src/renderer/scripting/api-wrapper/GridEditorFacade.ts:181-183;
src/renderer/editors/grid/GridEditor.ts:700-713):

~~~ts
addRows(count = 1, insertIndex?: number): unknown[] {
    return this.editor.addRows(count, insertIndex);
}
~~~

After, use the same rule with minimum: 1:

~~~ts
const [validCount] = validateCallArguments("grid.addRows", [count], GRID_ADD_ROWS_ARGUMENTS);
return this.editor.addRows(validCount, insertIndex as number | undefined);
~~~

The error names -3, reports number, states count must be at least 1, and shows grid.addRows(1).

#### 9. grid.editCell("nocol", "norow", "x") — column and row keys

Before, the facade delegates directly (src/renderer/scripting/api-wrapper/GridEditorFacade.ts:177-179),
and GridEditor.editRow returns when no row matches (src/renderer/editors/grid/GridEditor.ts:692-698):

~~~ts
editCell(columnKey: string, rowKey: string, value: unknown): void {
    this.editor.editRow(columnKey, rowKey, value);
}
~~~

After, build live choices at the facade boundary and validate both key arguments before mutation:

~~~ts
editCell(columnKey: unknown, rowKey: unknown, value: unknown): void {
    const rows = this.editor.getRows();
    validateCallArguments("grid.editCell", [columnKey, rowKey, value], [
        columnKeyRule(this.columns.map(column => column.key)),
        rowKeyRule(rows.map(row => getRowKey(row))),
        valueRule(),
    ]);
    this.editor.editRow(columnKey as string, rowKey as string, value);
}
~~~

The helper reports rejected key values and string types, lists current column and row keys (or
none), and shows a valid three-argument grid.editCell("<column-key>", "<row-key>", value) example.
getRows returns a copy while preserving row object identity
(src/renderer/editors/grid/GridEditor.ts:229-237). getRowKey is the authoritative key function,
but it is not a pure read: an unregistered row gets r<N> minted and stored in the WeakMap
(src/renderer/editors/grid/utils/grid-utils.ts:98-125). Registered rows can instead carry the
index-string form String(startIndex + i) from registerRows
(src/renderer/editors/grid/utils/grid-utils.ts:103-107). The valid-key list is therefore
idempotent after first enumeration but not side-effect-free; it is safe at this facade validation
boundary because a minted key is stable, and must not be moved into a hotter model/render path.
List whatever getRowKey actually returns, in both formats when both are present. Do not call these
keys row indices in the error; US-1358 owns the $help wording for both mint paths.

#### 10. grid.deleteRows(<unknown keys>) — missed report site

Before, the facade and editor accept the array and silently filter away keys that do not match
(src/renderer/scripting/api-wrapper/GridEditorFacade.ts:185-187;
src/renderer/editors/grid/GridEditor.ts:715-723):

~~~ts
deleteRows(rowKeys: string[]): void {
    this.editor.deleteRows(rowKeys);
}
~~~

After, validate the array, each string element, and each live key before delegating:

~~~ts
deleteRows(rowKeys: unknown): void {
    const validKeys = this.editor.getRows().map(row => getRowKey(row));
    const [keys] = validateCallArguments("grid.deleteRows", [rowKeys], [
        arrayOfChoicesRule("rowKeys", validKeys, 'grid.deleteRows(["<row-key>"])'),
    ]);
    this.editor.deleteRows(keys);
}
~~~

The error names unknown key values, reports array/element type problems, lists the current values
returned by getRowKey (including registered index strings and fallback r<N> keys, or none), and
provides a copy-paste grid.deleteRows(["<row-key>"]) example using one of those exact values. Do
not describe keys as row indices; US-1358 owns the $help wording for both key formats. The valid
key enumeration is idempotent once keys have been minted but not side-effect-free on its first
pass for an unregistered row, so keep it at this facade boundary
(src/renderer/editors/grid/utils/grid-utils.ts:103-125). Do not preserve or recreate the
nonexistent quoted report message; use the new shared contract.

#### 11. tools.search(12345) — query type

Before, ToolsNode.search normalizes non-strings to "" and handleSearchTools treats empty query as
return all tools (src/renderer/scripting/ai-vision/namespaces/tools.ts:184-200;
src/renderer/api/mcp/tool-commands.ts:33-43):

~~~ts
async search(query?: string, maxResults?: number): Promise<unknown> {
    requireInitialized();
    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    // ...
    if (query !== undefined) params.query = query;
    return cloneWithoutUndefined(unwrapResponse(await handleSearchTools(params))) as unknown;
}
~~~

After, validate the query before normalization and retain existing select/catalogue logic for
valid strings:

~~~ts
async search(query?: unknown, maxResults?: unknown): Promise<unknown> {
    const [validQuery] = validateCallArguments("tools.search", [query], TOOLS_SEARCH_ARGUMENTS);
    requireInitialized();
    const normalizedQuery = validQuery?.trim() ?? "";
    // existing select:/forwarding logic, using validQuery
}
~~~

The optional query rule accepts omitted/undefined query, rejects 12345 as number, and shows
tools.search("grid"). This task does not validate tools.search's maxResults; the existing
handleSearchTools guard continues to accept only a positive number and otherwise defaults to 5
(src/renderer/api/mcp/tool-commands.ts:37-40). A valid empty tools.search() remains a catalogue
request, and a valid keyword with no match remains a legitimate empty search
(qa/surfaces/tools.md:28-57).

#### 12. version with args: ["unexpected"] — property warning

Before, version is a property (src/renderer/scripting/ai-vision/root.ts:40-41,177), and the
resolver reads it without checking request.args (src/shared/ai-vision/resolver.ts:134-155):

~~~ts
get version() { return this.app.version; }
// resolver: property value is read even when request.args is present
~~~

After, the shared resolver records a warning while preserving the value:

~~~ts
// resolver, after reading a declared property value:
if (isLast && request.args && member?.kind === "property") {
    argumentWarning = noArgumentsWarning(name, request.args, "Read the version property without args");
}
// final result retains the shaped property value and includes warning when present
~~~

The MCP output says the property takes no arguments, names the received array/value and type, and
shows the copy-paste path version without args. It still returns the version and remains non-error,
so the dialog-attention scenarios that read version continue to receive the value
(qa/surfaces/dialogs.md:60-71,92-108).

#### 13. pages.closePage("no-such-page-id") — live page-id choice

Before, the wrapper delegates directly (src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:190-192),
and the lifecycle returns false for an unknown page before calling page.close()
(src/renderer/api/pages/PagesModel.ts:237-240; src/renderer/api/pages/PagesLifecycleModel.ts:482-486):

~~~ts
closePage(pageId: string): Promise<boolean> {
    return this.pages.closePage(pageId);
}
~~~

After, validate against current open IDs in the wrapper, immediately before delegation:

~~~ts
closePage(pageId: unknown): Promise<boolean> {
    const openPageIds = this.all.map(page => page.id);
    validateCallArguments("pages.closePage", [pageId], [
        choiceRule("pageId", openPageIds, 'pages.closePage("<open-page-id>")'),
    ]);
    return this.pages.closePage(pageId as string);
}
~~~

The error names the rejected ID and lists open page IDs, with none when appropriate, plus a
copy-paste call using an open ID. The message should match the useful shape of showPage's live
list (src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:311-323), while adding the
new contract's type/example details.

The validation boundary is deliberately before this.pages.closePage(pageId) in the wrapper, not
inside PagesLifecycleModel.closePage and not inside PageModel.close(). A known ID continues through
PagesModel.closePage (src/renderer/api/pages/PagesModel.ts:239), the unchanged lifecycle delegation
(src/renderer/api/pages/PagesLifecycleModel.ts:482-486), and the unchanged page.close confirmation
flow (src/renderer/api/pages/PageModel.ts:689-710). The renderer attention race that converts a
newly opened blocking dialog into pending remains outside this argument check
(src/renderer/scripting/ai-vision/attention.ts:76-99). An unsaved-changes close is not an
argument error and must keep its current pending result, attention text, and follow-up behavior
exactly.

## Ordering and overlap

EPIC-091 lands these tasks one at a time in numeric order (doc/epics/EPIC-091.md:146-164).
US-1356 owns the following function boundaries and lands first where files overlap; later tasks
rebase onto this task's committed shape and preserve these changes rather than reverting them:

- src/shared/ai-vision/resolver.ts: US-1355 owns errorAt and the hint gate
  (src/shared/ai-vision/resolver.ts:199-218); US-1358 owns returned-object identity at the
  nodeHint call around line 171 (src/shared/ai-vision/resolver.ts:163-172); US-1356 owns the
  property-with-args warning in the member-read path (src/shared/ai-vision/resolver.ts:142-146).
  These are disjoint edits in one file.
- src/main/mcp/tools/call-tools.ts: US-1356 owns ICallEnvelope.warning and warning rendering
  in toCallResult (src/main/mcp/tools/call-tools.ts:194-204,239-265); US-1357 owns shown/total
  and the truncation branch (src/main/mcp/tools/call-tools.ts:262); US-1358 owns cross-window
  hint prefixing (src/main/mcp/tools/call-tools.ts:70-83).
- src/renderer/scripting/api-wrapper/GridEditorFacade.ts: US-1356 owns validation in
  addRows, editCell, and deleteRows (src/renderer/scripting/api-wrapper/GridEditorFacade.ts:177-187);
  US-1358 owns the rowKeys read member, not these mutation methods
  (src/renderer/scripting/api-wrapper/GridEditorFacade.ts:24-40).
- src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts: US-1356 owns closePage
  (src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:190-192); US-1359 owns the fourth
  content parameter of addEditorPage (src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:215-222).
  The two wrapper methods are separate.

## QA return-value and regression dependencies

These existing qa/surfaces scenarios assert values or result shapes touched by this task:

- qa/surfaces/dialogs.md:16-32, Test D.1, requires closePage on a modified page to return a pending
  result with Unsaved Changes attention and then be resolved through dialogs[0].click(...). This
  is the hard regression check for close ordering.
- qa/surfaces/dialogs.md:60-71, Test D.3, requires a correct version value plus attention while a
  renderer dialog is open.
- qa/surfaces/dialogs.md:92-108, Test D.5, requires a correct version value plus native attention,
  including the recorded 4.0.24 result.
- qa/surfaces/windows.md:96-107, Test W.7, discovers and verifies the version application fact;
  qa/surfaces/gate.md:50-70, Test G.1, includes the same version read in its application facts and
  window-recovery result.
- qa/surfaces/tools.md:28-41, Test T.2, asserts the three valid tools.search forms and their result
  contents; qa/surfaces/tools.md:46-57, Test T.3, asserts a valid no-match keyword is a genuine
  empty result. qa/surfaces/gate.md:150-169 repeats the valid empty/select search contract.

No qa/surfaces scenario currently asserts the obsolete false result for an unknown closePage ID.
D.1 asserts the distinct pending-dialog path instead (qa/surfaces/dialogs.md:16-32), so the
deliberate false-to-error change has no existing surface assertion to update. No surface scenario
calls grid.addRows, grid.editCell, or grid.deleteRows; the grid file covers inventory and read-state
results (qa/surfaces/editors/data.md:10-41), while its mutating result assertions are for the
separate Log View path (qa/surfaces/editors/data.md:145-178). helpSearch appears in several
scenarios only as an allowed discovery route, not as an assertion of its current [] failure result
(qa/surfaces/gate.md:278-300; qa/surfaces/shell.md:142-150,312-314).

## Concerns

- This task intentionally changes pages.closePage("no-such-page-id") from false to an error, as
  required by EPIC-091 decision 4 (doc/epics/EPIC-091.md:197-216). A caller branching on false
  must now handle an exception, while a real close refusal or unsaved-dialog interception retains
  existing boolean/pending behavior.
- The two halves must remain ordered. Apply call sites only after the shared validator's contract
  can express required values, actual types, dynamic choices, long-list references, ranges, and
  examples (doc/epics/EPIC-091.md:146-160).
- Do not clamp helpSearch.limit; US-1357 owns that behavior. Do not edit
  src/shared/ai-vision/help-search.ts:24 or :65 for this task.
- Do not convert addEditorPage, openUrl, highlight, showPage, or other already-good validators to
  the new module. They are explicitly outside scope
  (doc/epics/EPIC-091.md:162-164). showPage remains the message-pattern reference, not a target.
- Do not change GridEditor's mutation methods or PageModel.close(). Checks belong at the
  script-facing facade boundary so valid actions retain existing model behavior.
- No unit tests, test harnesses, new qa/surfaces scenarios, dashboard entry, or commit are part of
  this task. Use existing surface scenarios and the later EPIC-091 acceptance run.

## Acceptance Criteria

- src/shared/ai-vision/argument-validation.ts is the single process-neutral validator for these
  call surfaces; it does not duplicate ui-push-validation.ts or import renderer/main code.
- Validator errors name the rejected value and actual type, provide current choices or their
  authoritative path, and include a copy-paste example. Required, arity, numeric minimum, dynamic
  choice, and no-argument warning cases are covered.
- The six helpSearch probes (missing args, number, null, object, wrong limit type, and excess args)
  fail or warn as specified; a valid query still reaches
  src/shared/ai-vision/help-search.ts:24 and limit is not clamped by this task.
- Both grid.addRows probes fail before GridEditor.addRows; invalid editCell column/row keys and
  unknown deleteRows keys fail before mutation and list live keys, while valid row-key arrays such
  as `["0"]` still reach the existing mutation.
- tools.search(12345) fails before the raw value can become an empty catalogue query; valid
  empty/select/keyword behavior remains unchanged.
- version with unexpected args returns the normal version plus a rendered warning and does not set
  isError: true; a normal version read remains unchanged.
- closePage rejects unknown/non-string IDs with the live open-ID list, while a known ID is delegated
  unchanged and a modified-page close still returns the existing pending attention path.
- addEditorPage, openUrl, highlight, showPage, Log View validation, and all other already-good
  sites retain their existing implementations and messages.
- Existing QA return contracts listed above remain valid, except for the deliberate unknown-ID
  closePage behavior change, which is not currently asserted by qa/surfaces.

## Files Changed Summary

| Path | Planned change |
|---|---|
| src/shared/ai-vision/argument-validation.ts | New process-neutral argument rules, type/value formatting, dynamic choices, arity/range checks, examples, and property-warning formatter. |
| src/shared/ai-vision/resolver.ts | Carry warning, validate arguments supplied to properties without consuming their values, and preserve the existing error/mutual-exclusion envelope. |
| src/main/mcp/tools/call-tools.ts | Carry and render non-fatal property warnings without setting isError. |
| src/renderer/scripting/ai-vision/root.ts | Pass raw helpSearch positional arguments through the shared validator before the core search. |
| src/renderer/scripting/ai-vision/namespaces/tools.ts | Validate the optional tools.search query before selection/catalogue normalization. |
| src/renderer/scripting/api-wrapper/GridEditorFacade.ts | Validate addRows, editCell, and deleteRows at the facade boundary using live columns and row keys. |
| src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts | Validate closePage IDs before delegation; leave showPage unchanged. |
| doc/tasks/US-1356-uniform-arg-validation/README.md | This task document. |

Files deliberately requiring NO changes: src/shared/ai-vision/help-search.ts (US-1357 owns
limit clamping), src/shared/ai-vision/types.ts, src/renderer/scripting/ai-vision/call.ts,
src/renderer/api/mcp/call-command.ts, src/main/mcp/ai-vision/main-root.ts,
src/renderer/api/mcp/ui-push-validation.ts, src/renderer/api/pages/open-url-validation.ts,
src/renderer/scripting/ai-vision/elements.ts, src/renderer/api/pages/PagesLifecycleModel.ts,
src/renderer/api/pages/PagesModel.ts, src/renderer/api/pages/PageModel.ts,
src/renderer/editors/grid/GridEditor.ts, PageCollectionWrapper.showPage, and the already-validated
sites in src/renderer/scripting/ai-vision/namespaces/tools.ts (toolset index/execute),
src/renderer/scripting/ai-vision/namespaces/menu-bar.ts,
src/renderer/scripting/ai-vision/namespaces/settings.ts,
src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts,
src/renderer/scripting/api-wrapper/ToolsHubEditorFacade.ts, and all qa/surfaces/ files. These
are existing behavior or regression surfaces, not additional conversion targets
(doc/epics/EPIC-091.md:111-126,162-164).
