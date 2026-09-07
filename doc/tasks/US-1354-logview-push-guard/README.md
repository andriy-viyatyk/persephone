# US-1354 — Guard `logView.push` against a non-array argument

**Status:** Completed 2026-09-07 (reviewed at epic close) · **Epic:** [EPIC-091 — `call` surface hardening](../../epics/EPIC-091.md)

## Goal

Make `pages.logView.push("done")` append exactly one `log.info` entry, while preserving
batch behavior and the existing entry validation. The runtime fix is the explicit
`Array.isArray(entries) ? entries : [entries]` normalization at the `push` boundary; the
public type and discovery text must describe that both one entry and an entry array are
accepted.

## Background

EPIC-091 decision 1 assigns this task the epic's only correctness bug, report item 1.1:
`push("not-an-array")` currently returns one id per character, and the reproduction table
records twelve ids for a twelve-character string (`doc/epics/EPIC-091.md:27-31,87-90`).
The starting source facts are confirmed:

- `LogViewEditorFacade.push` declares an array-only parameter at
  `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:120`; its loop iterates
  `entries` directly at line 125, then passes each value to `normalizeUiPushEntry` at line
  128. A string is iterable, so each character becomes a separate raw value.
- `normalizeUiPushEntry` deliberately turns a string into `{ type: "log.info", text: raw }`
  at `src/renderer/api/mcp/ui-push-validation.ts:76-85`; therefore each character is a
  valid shorthand entry rather than an immediate validation failure.
- The facade's member descriptor is at `LogViewEditorFacade.ts:29-40`, and its long-form
  help says that push supports string shorthand and returns `entryIds`/`dialogIds` at
  lines 42-50. Neither currently says that the whole argument may be one scalar entry.
- The public script declaration repeats the array-only contract at
  `src/renderer/api/types/log-view-editor.d.ts:8-30`. `ILogPushEntry` already represents
  a plain string or a flat object with a `type`, so the needed type change is the method
  parameter union, not a new entry type.

### Existing normalization behavior and the legacy route

The guard must wrap only the outer argument. `normalizeUiPushEntry` remains the shared
validator/normalizer, but its invalid-shape result must be hardened for the strict
`pages.logView.push` caller. Its current strict type checks, dialog checks, and grid checks
are at `src/renderer/api/mcp/ui-push-validation.ts:90-171`.

The comment about a “legacy output route” at
`src/renderer/api/mcp/ui-push-validation.ts:63-74` refers to the former `ui_push` handler:
that handler called the normalizer without `strictTypes`, skipped an `undefined` result, and
was removed with the retired MCP tools. The current renderer command registry contains only
`call` and the internal `board_call` at `src/renderer/api/mcp/command-registry.ts:5-11`, and
the repository has no current second caller of `normalizeUiPushEntry` besides
`LogViewEditorFacade.ts:10,128`. Preserve the former lenient behavior for any compatibility
caller by making the new malformed-shape throw conditional on `strictTypes`; the facade
passes `strictTypes: true` and therefore must never silently skip an invalid raw value.

| Caller input | Value seen by the loop after the guard | Required result after the fix |
| --- | --- | --- |
| `"done"` | `["done"]` | One `log.info` entry, because string shorthand is normalized at `ui-push-validation.ts:80-81`. |
| `{ type: "log.info", text: "done" }` | `[entry]` | One ordinary entry, because non-array objects are accepted at `ui-push-validation.ts:82-88`. This is the other common single-entry mistake and must work. |
| `123` | `[123]` | Strict normalization throws `UiPushValidationError` naming `123`, its `number` type, the accepted shapes, and an example; no entry is written. The current `undefined` path at `ui-push-validation.ts:82-85` must become this strict error. |
| `null` | `[null]` | Strict normalization throws the same actionable shape error naming `null` and its `null` type; no entry is written. The former lenient caller remains allowed to receive `undefined` when `strictTypes` is false. |
| `undefined` or omitted argument | `[undefined]` | Strict normalization throws the same actionable shape error naming `undefined` and its `undefined` type; no entry is written. This is a runtime behavior; the typed method still requires one `ILogPushEntry` or an array. |
| `{}` or `{ type: 7 }` | `[object]` | Strict normalization throws an actionable shape error naming the object and its malformed/missing `type`; no entry is written. A valid flat object remains accepted. |

The strict path therefore removes the silent-success class for every malformed raw entry,
not just strings. The error must name the rejected value and its actual runtime type, state
that the accepted shapes are a plain string or a flat object with a `type`, and include a
copy-paste example. Keep the existing unknown-type error for a string-valued but unsupported
`type` at `ui-push-validation.ts:90-97`; the new malformed-shape error covers values that
never reach that branch. The lenient legacy behavior is retained only when `strictTypes` is
false, as documented by the normalizer's current option comment at `ui-push-validation.ts:66-67`.

### All-or-nothing batch mutation

The current loop normalizes and writes each item in one pass at
`src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:125-140`. Consequently, a bad
item after valid earlier items can leave a partially applied batch in the Log View before
the call reports an error. The implementation must use two passes: first wrap the outer
argument and normalize every raw item into a local `NormalizedUiPushEntry[]`, throwing on
the first invalid item; then, only after normalization succeeds for the whole batch, run
the existing dialog/non-dialog write branches. No entry from the failing batch may be
written before the error. The model's writes occur only through `addEntry` and
`addDialogEntryNonBlocking` (`src/renderer/editors/log-view/LogViewEditor.ts:329-373,390-399`).

### `dialogIds` and the model path

No dialog bookkeeping change is needed. The facade currently allocates both arrays at
`LogViewEditorFacade.ts:122-123`; a non-dialog entry adds only its model id to
`entryIds` at lines 137-139, while a dialog adds the same non-blocking entry id to both
arrays at lines 130-136. The model method returns the generated id from
`addDialogEntryNonBlocking` at `src/renderer/editors/log-view/LogViewEditor.ts:390-399`.
After wrapping, one scalar dialog must therefore produce one `entryIds` value and the same
one `dialogIds` value; one scalar log/string must produce one `entryIds` value and
`dialogIds: []`; an invalid scalar must throw before either array is returned. The fresh
array return at `LogViewEditorFacade.ts:142` remains unchanged.

### Scope audit: no `main` twin hole

Repository search finds `normalizeUiPushEntry` defined only at
`src/renderer/api/mcp/ui-push-validation.ts:76-172` and called only by
`LogViewEditorFacade.ts:10,128`; there is no second caller to patch. The renderer script
`UiFacade` is a separate API: its logging methods call `LogViewEditor.addEntry` directly at
`src/renderer/scripting/api-wrapper/UiFacade.ts:43-57`, and its dialog/output methods also
write directly through the editor at lines 70-150. It does not iterate a `push` argument or
call the normalizer.

The `main` twin is not a Log View writer. `main.script.execute` supplies only
`electron`, `openWindows`, services, `boardProtocol`, `networkLogger`, and `console` in
`src/main/mcp/ai-vision/main-script.ts:114-133`; its public help lists the same main-process
scope and result contract at `src/main/mcp/ai-vision/main-services.ts:79-93`. The renderer
help explicitly distinguishes `script.execute` from the separate `main.script.execute`
path at `src/renderer/scripting/ai-vision/root.ts:88-96`. No main-side guard or normalizer
change is warranted.

## Implementation Plan

1. **Normalize the outer argument in `LogViewEditorFacade.push`.** In
   `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts`, keep `requireAttached`,
   the two id accumulators, the strict normalizer call, the dialog/non-dialog branches,
   and the return shape intact. Add a local collection immediately before the loop:

   ```ts
   const rawEntries = Array.isArray(entries) ? entries : [entries];
   const normalizedEntries: NormalizedUiPushEntry[] = [];
   for (const raw of rawEntries) {
       const normalized = normalizeUiPushEntry(raw, { strictTypes: true });
       if (!normalized) throw invalidUiPushEntryError(raw);
       normalizedEntries.push(normalized);
   }
   for (const normalized of normalizedEntries) {
       // existing dialog/non-dialog handling writes only in this second pass
   }
   ```

   The before → after change is:

   ```ts
   // Before — LogViewEditorFacade.ts:120-128
   push(entries: ILogPushEntry[]): ILogPushResult {
       this.requireAttached("push");
       const entryIds: string[] = [];
       const dialogIds: string[] = [];
       for (const raw of entries) {
           const normalized = normalizeUiPushEntry(raw, { strictTypes: true });
   ```

   ```ts
   // After — normalize the scalar and the whole batch before any write
   push(entries: ILogPushEntry | ILogPushEntry[]): ILogPushResult {
       this.requireAttached("push");
       const entryIds: string[] = [];
       const dialogIds: string[] = [];
       const rawEntries = Array.isArray(entries) ? entries : [entries];
       const normalizedEntries: NormalizedUiPushEntry[] = [];
       for (const raw of rawEntries) {
           const normalized = normalizeUiPushEntry(raw, { strictTypes: true });
           if (!normalized) throw invalidUiPushEntryError(raw);
           normalizedEntries.push(normalized);
       }
       for (const normalized of normalizedEntries) {
           // existing dialog/non-dialog handling follows
   ```

2. **Align the canonical public declaration.** Change only the `push` method parameter in
   `src/renderer/api/types/log-view-editor.d.ts:22-33` from
   `ILogPushEntry[]` to `ILogPushEntry | ILogPushEntry[]`. Keep `ILogPushEntry`'s string or
   flat typed-object union unchanged (`log-view-editor.d.ts:8-11`) and do not hand-edit the
   generated copy. The before → after declaration is:

   ```ts
   // Before
   push(entries: ILogPushEntry[]): ILogPushResult;

   // After
   push(entries: ILogPushEntry | ILogPushEntry[]): ILogPushResult;
   ```

3. **Harden malformed raw-entry validation in the shared normalizer.** Update
   `src/renderer/api/mcp/ui-push-validation.ts:76-88` with a small error-construction helper
   that safely formats the rejected raw value, reports its actual runtime type (including
   `null`), states “plain string or flat object with a `type`”, and includes a copy-paste
   example. When `strictTypes` is true, both the no-entry-shape branch and the non-string
   `type` branch must throw `UiPushValidationError` through that helper instead of returning
   `undefined`; when it is false, retain the former `undefined` return for the removed
   legacy `ui_push` compatibility path. Do not alter the existing unsupported-string-type
   error at `ui-push-validation.ts:90-97`.

4. **Make the Log View member descriptor and `$help` precise.** Update
   `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:36,42-50` so the member
   signature and help explicitly say: one plain string, one valid flat entry object, or an
   array of either; a plain string is one `log.info` line. Keep the existing supported type
   list, grid rules, non-blocking dialog warning, and result explanation. The descriptor
   change should follow this shape:

   ```ts
   // Before
   { name: "push", kind: "method", signature: "push(entries): ILogPushResult",
     summary: "Append or upsert Log View entries and return their ids immediately.", ... }

   // After
   { name: "push", kind: "method", signature: "push(entries): ILogPushResult",
     summary: "Append one string or flat entry object, or an array of them, and return ids immediately.", ... }
   ```

5. **Align parent discovery text.** Update the `logView` member summary and the relevant
   `PAGES_HELP` sentence in `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:18-36,55-80`.
   It currently teaches `push([...])` as a batch call but does not state that a scalar is
   legal. Retain the array example while adding the scalar forms and the one-string
   `log.info` shorthand. The root overview's array example at
   `src/renderer/scripting/ai-vision/root.ts:99-140` remains a valid example and needs no
   wording change.

6. **Align the MCP resource.** Update `assets/mcp-res-ui-push.md:1-19,69-78` so its
   entry-format and string-shorthand wording says that `push` accepts one entry or an array,
   and add concise scalar string and scalar object examples. Keep the existing array
   examples, schemas, dialog guidance, and error guidance unchanged. This resource is read
   from the asset path declared by `src/main/mcp/manifest.ts:42-54`; it is not a second
   runtime implementation.

7. **Refresh generated editor types only through the normal build path.** The Vite renderer
   plugin copies `src/renderer/api/types/*.d.ts` into `assets/editor-types/` during build and
   dev startup at `vite.renderer.config.ts:7-24,42-55`. Do not hand-edit
   `assets/editor-types/log-view-editor.d.ts`; the generated copy should reflect the source
   declaration after the implementation is built.

8. **Verify without adding tests or harnesses.** Use the existing project checks
   `npm run typecheck`, `npm run lint`, and `npm run build-prod` declared in
   `package.json:7-15`. If a live MCP check is available, verify scalar string, scalar valid
   object, scalar dialog, normal batches, and the invalid scalar cases against the returned
   ids and Log View entries. Do not add unit tests, test harnesses, QA scenarios, a dashboard
   entry, or a commit; the dashboard link already exists at `doc/active-work.md:11-19`.

## Files that need no changes

- `src/renderer/api/mcp/command-registry.ts` — the current renderer command registry has no
  legacy `ui_push` handler; it dispatches only `call` and `board_call` (`:5-11`).
- `src/renderer/scripting/api-wrapper/UiFacade.ts` — global script `ui` logging/dialog/output
  methods write directly to `LogViewEditor`, with no `push`-like iterable argument
  (`:43-57,70-150`).
- `src/renderer/api/mcp/log-view-access.ts` — it only resolves or creates the fixed Log View
  editor; it does not normalize entries (`:1-28`).
- `src/renderer/editors/log-view/LogViewEditor.ts` — existing entry creation, upsert, and
  non-blocking dialog id behavior are reused (`:329-373,390-399`).
- `src/main/mcp/ai-vision/main-script.ts` and `src/main/mcp/ai-vision/main-services.ts` —
  the main-process twin has no `pages`, `ui`, or Log View push surface
  (`main-script.ts:114-133`; `main-services.ts:79-93`).
- `src/renderer/editors/register-editors.ts` — its `log-view` hint only points to
  `pages.logView.push` and `dialogResult`; it does not claim an accepted argument shape
  (`:149-153`).
- `src/renderer/scripting/ai-vision/root.ts` — its array call is still valid and is only a
  general overview example (`:99-140`).
- `assets/editor-types/log-view-editor.d.ts` — generated from the canonical declaration by
  Vite and must not be hand-edited (`vite.renderer.config.ts:7-24`).
- `doc/active-work.md` — US-1354 is already linked under EPIC-091; no dashboard edit is
  authorized or needed (`:11-19`).
- Unit-test files, test harnesses, QA surface files, user documentation, and commit history —
  explicitly outside this task's requested scope.

## Concerns

- **Invalid scalar semantics:** resolved in favor of the epic's no-silent-no-op rule. Number,
  `null`, `undefined`, a bare object, and an object whose `type` is not a string must throw
  `UiPushValidationError` on the strict facade path with value, actual type, accepted shapes,
  and an example. The removed legacy route's lenient skip is retained only behind
  `strictTypes: false` (`ui-push-validation.ts:63-88`; `command-registry.ts:5-11`).
- **Batch atomicity:** resolved by a two-pass facade implementation. All raw entries are
  normalized first, and the existing model writes run only if every item normalized
  successfully (`LogViewEditorFacade.ts:125-140`; `LogViewEditor.ts:329-373,390-399`).
- **Static/runtime contract:** resolved by widening both the facade implementation signature
  and `ILogViewEditor.push`; otherwise `push("done")` would work only through runtime
  untyped dispatch while the canonical script API still rejected it at compile time
  (`LogViewEditorFacade.ts:120`; `log-view-editor.d.ts:22-30`).
- **Dialog ids:** no concern remains after the audit. The guard changes the number of raw
  items, not the existing dialog branch or id correlation (`LogViewEditorFacade.ts:130-142`).
- **Documentation drift:** the scalar contract must appear in the Log View descriptor/help,
  parent pages help, and MCP resource. The editor registry hint and root overview need no
  change because neither states that only arrays are accepted
  (`LogViewEditorFacade.ts:36,42-50`; `PageCollectionWrapper.ts:36,74-80`;
  `assets/mcp-res-ui-push.md:69-78`).

## Acceptance Criteria

- `pages.logView.push("done")` creates exactly one `log.info` entry with text `"done"` and
  returns one `entryIds` value with `dialogIds: []`.
- A lone valid flat object, such as `{ type: "log.info", text: "done" }`, creates exactly
  one entry; a lone valid dialog creates one entry and places its id in both returned arrays.
- Existing array calls preserve ordering, one id per valid entry, and the existing dialog id
  correlation; empty arrays still return empty `entryIds` and `dialogIds`
  (`LogViewEditorFacade.ts:122-142`).
- Runtime number, `null`, and `undefined` inputs are wrapped as one raw item and throw
  `UiPushValidationError` with the rejected value, actual type, accepted shapes, and a
  copy-paste example; they do not produce a successful empty result
  (`ui-push-validation.ts:76-88`).
- A mixed batch with an invalid item throws before any item from that batch is written; valid
  earlier items are not left behind in the Log View (`LogViewEditorFacade.ts:125-140`).
- An object with an unknown entry type still raises `UiPushValidationError` with the existing
  valid-type guidance; the guard does not weaken strict validation
  (`ui-push-validation.ts:90-97`).
- `ILogViewEditor.push`, the facade descriptor, `pages` help, Log View `$help`, and the MCP
  `ui-push` resource consistently describe one string/object or an array of them
  (`log-view-editor.d.ts:22-30`; `LogViewEditorFacade.ts:36,42-50`;
  `PageCollectionWrapper.ts:36,74-80`; `assets/mcp-res-ui-push.md:69-78`).
- No `main`-process, global `ui`, model, generated-type hand-edit, dashboard, unit-test,
  test-harness, QA-scenario, or commit change is made beyond the planned files above.
- `npm run typecheck`, `npm run lint`, and `npm run build-prod` complete successfully
  (`package.json:7-15`).

## Files Changed (summary)

| File | Planned change |
| --- | --- |
| `src/renderer/api/mcp/ui-push-validation.ts` | Throw actionable strict-path errors for malformed raw entries while preserving the removed legacy route's lenient `undefined` behavior when `strictTypes` is false. |
| `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts` | Wrap a scalar entry as a one-item collection; normalize the entire batch before writing; widen the implementation signature; state scalar-or-array input in the member descriptor and `$help`. |
| `src/renderer/api/types/log-view-editor.d.ts` | Widen `ILogViewEditor.push` from `ILogPushEntry[]` to `ILogPushEntry | ILogPushEntry[]`. |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | State scalar-or-array `push` input in the `logView` summary and parent `$help`. |
| `assets/mcp-res-ui-push.md` | Document scalar string/object forms alongside existing array examples. |
| `assets/editor-types/log-view-editor.d.ts` | Generated from the source declaration by Vite; no direct edit. |
| `doc/tasks/US-1354-logview-push-guard/README.md` | This source-verified implementation plan. |
