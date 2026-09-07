# US-1359 — Surface documentation and consistency

## Goal

Plan the documentation and narrowly scoped runtime fixes for report items 3.1, 3.3, 3.4, 3.5, 3.6,
and 3.7 of [EPIC-091](../../epics/EPIC-091.md:1). The task restores the fourth `addEditorPage`
argument that the scripting wrapper silently drops, makes the live AiVision descriptions and
copy-paste examples agree with the implementation, and clarifies the script-error contract. It
does not unify mutation return values: EPIC-091 decision 5 requires those values to remain
unchanged and be documented instead.

## Background

AiVision member summaries and `$help` text are the live MCP surface. The renderer scripting
wrappers own most of those descriptions, while the public declaration files under
`src/renderer/api/types/` describe the same scripting API. The resolver returns `{ ok: true }` for
writable-property assignments at [resolver.ts:123-131](../../../src/shared/ai-vision/resolver.ts:123),
so a property assignment's runtime result is not the TypeScript setter's `void` return type.

The six report items are independent but all concern what a caller is told: one wrapper-dropped
argument, four escaped examples, one misleading settings example, five deliberately different
mutation results, two script-failure channels, and renderer-owned stack frames. Decision 5 declines
the report's uniform `{ ok: true }` recommendation; decision 8 requires renderer stack filtering in
every build, while retaining user frames from the submitted script. The dropped fourth argument is
an additional silent no-op — the fourteenth in the epic's accounting — that the outside report did
not find, because following its own four-argument example reports success while losing the content.
No implementation, tests, test harnesses, commit, or dashboard entry is part of this planning task.

## Ordering and overlap

This task lands last among EPIC-091's code tasks. Rebase it onto the preceding tasks in commit
order, preserving their changes and applying only the disjoint hunks below:

- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`: US-1356 lands `closePage`
  validation first. This task then changes only the `addEditorPage` descriptor at line 31 and the
  wrapper method at lines 215-222; those edits are disjoint, so rebase onto US-1356 rather than
  against it.
- `src/renderer/api/mcp/ui-push-validation.ts`: US-1354 changes the `undefined`-return branch in
  `normalizeUiPushEntry`; this task edits only the four `output.grid` message literals at lines
  131, 136, 148, and 153. Keep the changes disjoint within the same file.
- `src/renderer/scripting/ai-vision/root.ts`: US-1356 changes the `helpSearch` wrapper at lines
  173-175; this task edits the root overview at lines 99-105 for item 3.4 and the
  `script.execute` contract help at lines 70-97 for item 3.6 (and its stack wording for 3.7).
- `src/renderer/scripting/ScriptRunner.ts` and
  `src/renderer/scripting/script-utils.ts`: this task alone owns the 3.7 stack-trimming behavior.
  The implementation belongs in `script-utils.ts`; `ScriptRunner.ts` is retained as the caller
  audit and does not need a code change.

## Implementation Plan

### Report item 3.1 — `addEditorPage` signature

#### Findings

The fourth argument is a silent no-op at the scripting boundary, not merely a documentation
disagreement. The descriptor currently advertises only three arguments at
[PageCollectionWrapper.ts:18-32](../../../src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:18),
and the wrapper method accepts and forwards only those three at
[PageCollectionWrapper.ts:215-222](../../../src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:215).
Thus the arity error's own copy-paste example,
`addEditorPage("monaco", "plaintext", "My Page", "content")`, returns a successful page while
silently dropping `content`. This is the fourteenth silent no-op in EPIC-091's accounting, and the
report did not find it because its probe followed the surface's three-argument descriptor rather
than the four-argument error example.

The lifecycle model already implements the fourth optional argument at
[PagesLifecycleModel.ts:259-264](../../../src/renderer/api/pages/PagesLifecycleModel.ts:259): it
creates an empty text model, then applies truthy `content` through `changeContent` at
[PagesLifecycleModel.ts:281-289](../../../src/renderer/api/pages/PagesLifecycleModel.ts:281).
The empty-string case is verified from that control flow: `if (content)` does not call
`changeContent` for `""`, so omitted content, `undefined`, and an empty-string fourth argument all
leave the newly created model empty. They are indistinguishable by design because the model starts
empty; every non-empty string is applied.
The arity error already names `(editor, language, title, content?)` and supplies a four-argument
example at [PagesLifecycleModel.ts:265-268](../../../src/renderer/api/pages/PagesLifecycleModel.ts:265).
The source declaration already agrees at
[src/renderer/api/types/pages.d.ts:69-73](../../../src/renderer/api/types/pages.d.ts:69).

Therefore restore the dropped argument in the scripting wrapper, then make its descriptor agree.
Do not add a duplicate lifecycle implementation or alter the already-correct declaration and
arity error.

#### Before → after

`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:31`

~~~ts
// Before
{ name: "addEditorPage", kind: "method", signature: "addEditorPage(editor, language, title)", summary: "New page with a given editor id (monaco, grid-json, md-view, …) and language; returns it." },

// After
{ name: "addEditorPage", kind: "method", signature: "addEditorPage(editor, language, title, content?)", summary: "New page with a given editor id (monaco, grid-json, md-view, …) and language; optionally initializes its content; returns it." },
~~~

`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:215-222`

~~~ts
// Before
addEditorPage(
    editor: EditorView,
    language: string,
    title: string,
): PageWrapper {
    const page = this.pages.addEditorPage(editor, language, title);
    return this.wrap(page);
}

// After
addEditorPage(
    editor: EditorView,
    language: string,
    title: string,
    content?: string,
): PageWrapper {
    const page = this.pages.addEditorPage(editor, language, title, content);
    return this.wrap(page);
}
~~~

No before/after edit is needed for [PagesLifecycleModel.ts:259-291](../../../src/renderer/api/pages/PagesLifecycleModel.ts:259),
the arity error at [PagesLifecycleModel.ts:265-268](../../../src/renderer/api/pages/PagesLifecycleModel.ts:265),
or [src/renderer/api/types/pages.d.ts:69-73](../../../src/renderer/api/types/pages.d.ts:69): all three
already describe the implemented four-argument contract.

Manual live acceptance for the silent-no-op regression: call
`pages.addEditorPage("monaco", "plaintext", "US-1359 content", "supplied text")` through MCP,
take the returned page id, read `pages["<returned-id>"].content`, and require exactly
`"supplied text"`; then call `pages.closePage("<returned-id>")` and require the documented close
result. This must exercise the four-argument `call` path, not only the TypeScript wrapper.

### Report item 3.3 — `output.grid` example quoting

#### Findings

The four error messages at
[ui-push-validation.ts:131-153](../../../src/renderer/api/mcp/ui-push-validation.ts:131) are
template literals. In a template literal, source `\"` evaluates to a bare quote, so the current
runtime message contains `content: "[{"name":"A","value":1}]"`; the inner JSON string is not
valid copy-pasteable JavaScript or JSON. The six `DIALOG_SPECS.usage` literals at
[ui-push-validation.ts:10-38](../../../src/renderer/api/mcp/ui-push-validation.ts:10) are
single-quoted literals and are already correct; do not touch them.

#### Before → after

In each of the four template literals at source lines 131, 136, 148, and 153, change the embedded
quote escapes as follows:

~~~ts
// Before source: one backslash before each embedded quote
`... content: "[{\"name\":\"A\",\"value\":1}]" ...`

// After source: two backslashes encode the literal backslash and the third escapes the quote,
// leaving \" in the runtime text
`... content: "[{\\\"name\\\":\\\"A\\\",\\\"value\\\":1}]" ...`
~~~

The exact four affected messages are `output.grid requires 'content'`, `content must be a string`,
`content is not valid JSON`, and `content must be a JSON array`; their full current text is at
[ui-push-validation.ts:127-155](../../../src/renderer/api/mcp/ui-push-validation.ts:127). After the
change, the emitted example is exactly `content: "[{\"name\":\"A\",\"value\":1}]"`, so the
outer object literal and its JSON-array string can be copied without the quotes collapsing. The
validation logic and the `DIALOG_SPECS` examples remain unchanged.

### Report item 3.4 — writable settings example

#### Findings

The root overview currently points callers at the read-only property `settings.theme` at
[root.ts:99-105](../../../src/renderer/scripting/ai-vision/root.ts:99). The root member itself
already accurately says `Application settings (read/write)` at
[root.ts:37-43](../../../src/renderer/scripting/ai-vision/root.ts:37). The underlying settings
object exposes `theme` only through a getter at [settings.ts:181-201](../../../src/renderer/api/settings.ts:181),
while `set(key, value)` persists a setting at [settings.ts:203-216](../../../src/renderer/api/settings.ts:203).
The scripting settings namespace also marks `theme` readonly and separately exposes `set` at
[namespaces/settings.ts:240-248](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts:240).
Its settings-element validation configuration is at
[namespaces/settings.ts:234-238](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts:234),
and its provided `set` path delegates to `settings.set` at
[namespaces/settings.ts:260-274](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts:260).

Use the existing writable `set` operation with the existing `theme` key, rather than implying that
the `theme` property itself can be assigned.

#### Before → after

`src/renderer/scripting/ai-vision/root.ts:104`

~~~text
Before: settings - read or persist application configuration; e.g. settings.theme
After:  settings - read or persist application configuration; e.g. settings.set("theme", "monokai")
~~~

Keep the root member summary, the readonly `theme` descriptor, and the settings implementation
unchanged. The example is intentionally a real write example, so its existing configuration-change
caution remains discoverable through `settings.set` at
[namespaces/settings.ts:242-244](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts:242).

### Report item 3.5 — document, do not unify mutation return shapes

#### Findings

The current results are not interchangeable and must not be changed:

| Surface | Current runtime result | Source evidence |
|---|---|---|
| `page.language = value` | `{ ok: true }` | Resolver assignment envelope at [resolver.ts:123-131](../../../src/shared/ai-vision/resolver.ts:123) and writable member at [PageWrapper.ts:124-125](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:124). |
| `pages.closePage(id)` | `true`/`false` | Wrapper return type and pass-through at [PageCollectionWrapper.ts:27,190-191](../../../src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:27). US-1356 owns the unknown-id behavior change; this task does not. |
| `pages.logView.clear()` | `null` at the call surface | Void facade method at [LogViewEditorFacade.ts:36-39,153-156](../../../src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:36). |
| `page.editor.editCell(...)` | `null` at the call surface | Void facade method at [GridEditorFacade.ts:38,177-179](../../../src/renderer/scripting/api-wrapper/GridEditorFacade.ts:38). |
| `dialogs[0].click(...)` on a boolean-closing dialog | `true`/`false` | `closeWithResult` returns `Promise<boolean>` at [dialogs/shared.ts:37-43](../../../src/renderer/scripting/ai-vision/dialogs/shared.ts:37), used by the confirmation adapter at [dialogs/confirmation.ts:22-28](../../../src/renderer/scripting/ai-vision/dialogs/confirmation.ts:22). |

Decision 5 rejects a uniform `{ ok: true }`: changing every void member across the seven epics
would affect roughly sixty QA scenarios, and boolean results carry refusal information. The plan
therefore changes only member summaries and node help, never a return statement or public behavior.

#### Before → after

`src/renderer/scripting/api-wrapper/PageWrapper.ts:125`

~~~ts
// Before
{ name: "language", kind: "property", writable: true, summary: "Language id. Assigning changes it; use page.tab.highlight(\"tab-language\") when the user asks where it is changed." },

// After
{ name: "language", kind: "property", writable: true, summary: "Language id. Assigning changes it and returns { ok: true }; use page.tab.highlight(\"tab-language\") when the user asks where it is changed." },
~~~

`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:27`

~~~ts
// Before
{ name: "closePage", kind: "method", signature: "closePage(pageId: string)", summary: "Close a page.", caution: "unsaved changes prompt the user; a discarded page is gone" },

// After
{ name: "closePage", kind: "method", signature: "closePage(pageId: string)", summary: "Close a page; returns true when closed and false when closing is refused, such as cancelling an unsaved-changes prompt.", caution: "unsaved changes prompt the user; a discarded page is gone" },
~~~

`src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:38` and
`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:38`

~~~ts
// Before
summary: "Remove all Log View entries."
summary: "Edit a single cell value."

// After
summary: "Remove all Log View entries; returns null after clearing."
summary: "Edit a single cell value; returns null after the edit."
~~~

For the boolean-closing dialog adapters, update the `click` member summary from
`Click an exact visible response button.` to state that it returns the boolean close result. Apply
that wording to the adapters that call `closeWithResult`: `confirmation.ts:5-14`, `input.ts:5-13`,
`namespace-collision.ts:5-13`, `register-toolset.ts:5-13`, `text.ts:5-14`, and
`trust-board.ts:5-13`. Add the corresponding general rule to
[dialogs/index.ts:69-77](../../../src/renderer/scripting/ai-vision/dialogs/index.ts:69): adapters
whose action closes with a result expose that boolean, while action-specific adapters may return
`undefined`. This keeps the dynamic `dialogs[i]` contract honest without claiming that every dialog
click has the same shape.

Do not change `src/renderer/api/types/pages.d.ts:53-57`,
`src/renderer/api/types/grid-editor.d.ts:48-52`, or
`src/renderer/api/types/log-view-editor.d.ts:30-33`: their TypeScript `boolean`/`void` declarations
remain the source API types, while the AiVision summaries document the call-surface serialization.

### Report item 3.6 — make `script.execute` failure channels explicit

#### Findings

`ScriptRunner.runWithCapture` sets `isError` from `result instanceof Error` and returns it beside
`text`, `language`, and `consoleLogs` at [ScriptRunner.ts:30-43](../../../src/renderer/scripting/ScriptRunner.ts:30).
The existing contract help says errors return `isError: true`, but does not say that this is still a
successful MCP tool result, nor distinguish a bad argument type from an exception inside valid code,
at [root.ts:70-97](../../../src/renderer/scripting/ai-vision/root.ts:70). The distinction to document
is: a non-string `code` parameter is an MCP/tool error; syntax or runtime failure inside a string is
returned in the normal envelope with `isError: true`, preserving `consoleLogs`.

#### Before → after

`src/renderer/scripting/ai-vision/root.ts:67,77-80`

~~~ts
// Before
{ name: "execute", kind: "method", signature: "execute(code, pageId?, language?)", summary: "Execute JavaScript or TypeScript in the renderer and return the result with captured console logs.", caution: SCRIPT_EXECUTION_CAUTION },

The last expression is returned as text. The result always contains text, language, isError, and
consoleLogs. console.log, console.info, console.warn, and console.error are captured in consoleLogs.
Errors return isError: true and include the error message and stack text. Side effects performed
before an error or timeout remain performed.

// After
{ name: "execute", kind: "method", signature: "execute(code, pageId?, language?)", summary: "Execute JavaScript or TypeScript in the renderer and return text with captured console logs; failures inside code set isError: true.", caution: SCRIPT_EXECUTION_CAUTION },

The last expression is returned as text. `code` must be a string: a wrong code-parameter type is an
MCP/tool error. A syntax or runtime error thrown by a string of code is not an MCP/tool error; the
call succeeds with `isError: true`, error text, and any consoleLogs captured before the failure.
The result always contains text, language, isError, and consoleLogs. Side effects performed before
an error or timeout remain performed.
~~~

Retain the existing timeout, privilege, and pending-dialog wording in
[root.ts:82-96](../../../src/renderer/scripting/ai-vision/root.ts:82). The help must not tell a
caller to inspect only the MCP tool-level error flag to detect a thrown script exception.

### Report item 3.7 — trim renderer-internal stack frames in every build

#### Findings

`convertToText` currently appends the complete `Error.stack` to `result.text` at
[script-utils.ts:4-11](../../../src/renderer/scripting/script-utils.ts:4). The renderer error reaches
that function through `ScriptRunner.ts:33-43` and the resolver path; the leaked frames are
Persephone's `ScriptRunnerBase.ts`, `ScriptRunner.ts`, and `resolver.ts` call machinery. Decision 8
requires removing those internal frames in development and packaged builds alike, while preserving
all user frames from the submitted script.

The main-process twin already returns `errMessage(outcome.error)` without a stack at
[main-script.ts:153-168](../../../src/main/mcp/ai-vision/main-script.ts:153). The renderer cannot be
made byte-for-byte identical without discarding useful submitted-script frames; the intended
alignment is therefore: main failures have the error message only, while renderer failures have the
error message plus only the user's remaining frames.

#### Before → after

`src/renderer/scripting/script-utils.ts:6-11`

~~~ts
// Before
if (value instanceof Error) {
    let errorText = `Error: ${value.message}\n`;
    if (value.stack) {
        errorText += `\nStack trace:\n${value.stack}`;
    }
    return { text: errorText, language: "plaintext" };
}

// After — helper names are implementation guidance; the filtering contract is mandatory
if (value instanceof Error) {
    let errorText = `Error: ${value.message}\n`;
    const userStack = filterRendererInternalFrames(value.stack);
    if (userStack) {
        errorText += `\nStack trace:\n${userStack}`;
    }
    return { text: errorText, language: "plaintext" };
}
~~~

Implement `filterRendererInternalFrames` in the same module or a directly owned utility. Split the
stack into lines, retain the error header and every user frame, and remove only frames whose source
paths identify `src/renderer/scripting/ScriptRunnerBase.ts`,
`src/renderer/scripting/ScriptRunner.ts`, or `src/shared/ai-vision/resolver.ts`. Match the path
segments rather than the dev-server origin, so the rule works for both `http://localhost:5273/`
stacks and packaged paths. If no user frame remains, omit the stack section rather than emitting an
empty heading. Do not gate this on `import.meta.env.DEV` or package status, and do not rewrite or
truncate user frames.

Update the `script.execute` help text from “include the error message and stack text” to say that
renderer failures include the error message and submitted-script frames after Persephone's internal
frames are removed. Keep the main-process help and `main-script.ts` behavior unchanged; its no-stack
result is the closest common contract available without losing renderer diagnostics.

#### `convertToText` caller audit

The only direct callers are both in
[ScriptRunner.ts:33-43,54-68](../../../src/renderer/scripting/ScriptRunner.ts:33):
`runWithCapture` feeds the MCP `script.execute` result, and `runWithResult` feeds the user-facing
UI path. `runWithResult` is reached from page `runScript()` at
[PageWrapper.ts:278-283](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:278), text-editor
actions at [TextFileActionsModel.ts:47-70](../../../src/renderer/editors/text/TextFileActionsModel.ts:47),
and notebook note execution at
[NoteItemEditModel.ts:298-304](../../../src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts:298).
Its error text is either shown in the Script Error dialog or written to the grouped page at
[ScriptRunner.ts:60-67](../../../src/renderer/scripting/ScriptRunner.ts:60), not used by a
Persephone-internal diagnostics path. No caller treats internal frames as the point of the result,
so filtering in `convertToText` is safe; moving the filter to the MCP boundary is unnecessary.

## Concerns

- The `content` parameter is already used by the lifecycle model and by `addDrawPage` at
  [PagesLifecycleModel.ts:319-323](../../../src/renderer/api/pages/PagesLifecycleModel.ts:319), so
  changing only the scripting wrapper avoids a second implementation and keeps the existing
  arity-error example authoritative.
- The grid fix must be checked against the runtime string, not just source appearance: one source
  backslash before a quote collapses; the corrected source must emit a backslash-plus-quote pair.
  The six single-quoted `DIALOG_SPECS.usage` values are a separate, correct escaping context.
- The settings example performs a real persisted write. Its key and value are already valid in
  [settings.ts:92-96](../../../src/renderer/api/settings.ts:92); the existing `set` caution and
  self-severing-key guard at [namespaces/settings.ts:168-176](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts:168)
  remain in force.
- Return values are documentation-only in this task. In particular, do not alter resolver
  assignment envelopes, `closePage`, Log View clearing, grid edits, or dialog close behavior; the
  close-page behavior change belongs to US-1356 per EPIC-091 decision 4.
- Stack filtering must be path-specific, build-independent, and preserve user frames. Filtering all
  localhost frames would incorrectly remove a user's local script frame; adding main-process stack
  frames would move the two execution paths farther apart.
- No unit tests, test harnesses, QA surface files, generated editor declarations, dashboard entries,
  or commits are required or permitted by this task request. Manual source/runtime verification can
  be performed when implementation begins.

## Acceptance Criteria

- `pages.addEditorPage`'s descriptor, wrapper method, lifecycle signature, arity error, and
  `src/renderer/api/types/pages.d.ts` all agree on
  `addEditorPage(editor, language, title, content?)`; a four-argument call initializes content and
  does not require a second content write.
- The four `output.grid` errors emit the runtime example
  `content: "[{\"name\":\"A\",\"value\":1}]"`, which is valid copy-pasteable JavaScript and
  valid JSON string content. The six `DIALOG_SPECS.usage` strings at lines 14, 18, 23, 28, 33, and
  38 remain byte-for-byte unchanged.
- The root settings overview shows a writable operation, `settings.set("theme", "monokai")`,
  while `settings.theme` remains correctly readonly and the root member remains read/write.
- `$help`/member summaries state the observed return shape for page-language assignment,
  `closePage`, `logView.clear()`, `editCell`, and boolean-closing `dialogs[i].click()` without
  changing any return value or changing US-1356's `closePage` scope.
- `script.execute` help explicitly distinguishes MCP/tool argument errors from successful tool
  results carrying `isError: true`, and explicitly says that `consoleLogs` survive an in-code
  syntax/runtime failure.
- Renderer error text removes only the Persephone call-machinery frames named in decision 8 in
  every build, retains submitted-script frames in full, and omits an empty stack section. The main
  process continues to return its error message without a stack, as documented.
- `assets/editor-types/*.d.ts` is not hand-edited; it remains generated from
  `src/renderer/api/types/`.

## Files needing NO changes

- [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts:259):
  `content?: string`, its arity error, and its initial-content application are already implemented.
- [src/renderer/api/types/pages.d.ts](../../../src/renderer/api/types/pages.d.ts:69): the public
  `addEditorPage(..., content?: string)` declaration already agrees.
- [src/renderer/api/settings.ts](../../../src/renderer/api/settings.ts:181): the settings getter and
  `set` implementation are correct; only the root example is misleading.
- [src/renderer/scripting/ai-vision/namespaces/settings.ts](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts:240):
  `theme` is correctly readonly and `set` is correctly exposed.
- [src/renderer/api/types/grid-editor.d.ts](../../../src/renderer/api/types/grid-editor.d.ts:48),
  [src/renderer/api/types/log-view-editor.d.ts](../../../src/renderer/api/types/log-view-editor.d.ts:30),
  and [src/renderer/api/types/page.d.ts](../../../src/renderer/api/types/page.d.ts:67): retain the
  TypeScript `void`/property declarations; this task documents runtime call-surface serialization.
- [assets/editor-types](../../../assets/editor-types): generated from
  `src/renderer/api/types/`; never hand-edit generated `*.d.ts` files.
- [src/main/mcp/ai-vision/main-script.ts](../../../src/main/mcp/ai-vision/main-script.ts:153): its
  no-stack error result already supplies the main-process half of the contract.
- [src/renderer/scripting/ScriptRunner.ts](../../../src/renderer/scripting/ScriptRunner.ts:30):
  `isError` and `consoleLogs` are already produced correctly; the renderer stack formatting belongs
  in `script-utils.ts`.
- [src/renderer/api/mcp/ui-push-validation.ts](../../../src/renderer/api/mcp/ui-push-validation.ts:10):
  `DIALOG_SPECS.usage` at lines 14, 18, 23, 28, 33, and 38 is correct and must not be changed.
- [doc/active-work.md](../../active-work.md): do not add or modify a dashboard entry.
- All `qa/` files and test/test-harness files: no tests or harnesses are to be written for this
  documentation task.

## Files Changed

| Path | Planned change |
|---|---|
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Advertise and forward optional initial `content`; document `closePage`'s boolean result. |
| `src/renderer/api/mcp/ui-push-validation.ts` | Escape quotes correctly in the four `output.grid` template-literal examples only. |
| `src/renderer/scripting/ai-vision/root.ts` | Replace the read-only settings example and clarify `script.execute`'s two failure channels and filtered renderer stack contract. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Document `{ ok: true }` from writable `language` assignment. |
| `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts` | Document `clear()`'s `null` call-surface result. |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` | Document `editCell()`'s `null` call-surface result. |
| `src/renderer/scripting/ai-vision/dialogs/index.ts` | Explain boolean versus action-specific dialog click results in the dynamic dialog help. |
| `src/renderer/scripting/ai-vision/dialogs/confirmation.ts` | Document the boolean close result for confirmation `click()`. |
| `src/renderer/scripting/ai-vision/dialogs/input.ts` | Document the boolean close result for input `click()`. |
| `src/renderer/scripting/ai-vision/dialogs/namespace-collision.ts` | Document the boolean close result for namespace-collision `click()`. |
| `src/renderer/scripting/ai-vision/dialogs/register-toolset.ts` | Document the boolean close result for toolset-registration `click()`. |
| `src/renderer/scripting/ai-vision/dialogs/text.ts` | Document the boolean close result for text-dialog `click()`. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Document the boolean close result for trust-board `click()`. |
| `src/renderer/scripting/script-utils.ts` | Filter only renderer-internal stack frames in every build and preserve user frames. |
