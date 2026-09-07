# US-1358 — Language validation, returned-object identity, and grid row keys

**Status:** Completed 2026-09-07 (reviewed at epic close)

## Goal

Plan the fixes for report items 1.4, 1.5, and 3.2:

1. Reject an unknown language as an argument error while preserving Monaco fallback
   for a real language that the selected editor does not support.
2. Make hints for methods that return objects describe the returned object rather
   than the call expression that produced it.
3. Keep grid rows as JSON data while exposing their actual row keys through a
   separate read path.

This task is linked to [EPIC-091](../../epics/EPIC-091.md:1), with decisions 7, 9,
and 10 governing the behavior below.

## Background

### Part A — language validation

The editor registry currently treats an unknown language and an unsupported
language identically. For a non-Monaco editor, validateForLanguage returns Monaco
when its matcher rejects the language, and an unknown language is accepted by no
matcher. The relevant branch is
[editorRegistry.ts:201-208](../../../src/renderer/editors/base/editorRegistry.ts:201).
Monaco itself is the exception because its matcher accepts every language in
[editor-matchers.ts:40-47](../../../src/renderer/editors/base/editor-matchers.ts:40).

The real language-id inventory is a static module-level catalog in
[monaco-languages.ts:3-29](../../../src/renderer/core/utils/monaco-languages.ts:3)
and is exported as monacoLanguages at
[monaco-languages.ts:1081-1084](../../../src/renderer/core/utils/monaco-languages.ts:1081).
It is composed synchronously from the built-in Monaco catalog and the five custom
entries reg, csv, mermaid, jsonl, and log. configure-monaco separately registers
those same five custom IDs during initMonaco at
[configure-monaco.ts:216-231](../../../src/renderer/api/setup/configure-monaco.ts:216);
it does not append to or mutate monacoLanguages. The two sources therefore agree
on the current custom IDs, and the static monacoLanguages export is safe to read
before Monaco initialization. editors.languages should expose that complete
catalog, with a future custom registration requiring a corresponding catalog
entry, rather than introducing a second runtime list.

The addEditorPage flow validates the editor id and content host, stores the
requested language, and then resolves the editor at
[PagesLifecycleModel.ts:259-291](../../../src/renderer/api/pages/PagesLifecycleModel.ts:259).
The well-known-page path calls the same resolver again at
[PagesLifecycleModel.ts:303-315](../../../src/renderer/api/pages/PagesLifecycleModel.ts:303).
The facade is intentionally only a pass-through at
[PageCollectionWrapper.ts:215-222](../../../src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:215),
so validation belongs in the shared registry boundary and in the writable page
property path.

The page language setter currently only suppresses changes for a no-language page
and otherwise forwards any string to changeLanguage at
[PageWrapper.ts:190-194](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:190).
TextEditorModel and other internal paths continue to use the fallback-only
validateForLanguage behavior, including its existing optional-language
normalization at
[TextEditorModel.ts:150-155](../../../src/renderer/editors/text/TextEditorModel.ts:150).
They must not call the new throwing argument validator.

#### Current → planned behavior

~~~ts
// editorRegistry.ts
if (def?.match?.validForLanguage?.(language) === false) return "monaco";
return editor;
~~~

~~~ts
// editorRegistry.ts — throwing argument check, separate from resolution
assertKnownLanguage(language: string | undefined): void {
    if (language !== undefined && !monacoLanguages.some(item => item.id === language)) {
        throw new Error(
            'Unknown language "' + language + '". Read ' +
            `editors.languages` for the valid ids.',
        );
    }
}

// validateForLanguage remains fallback-only
if (def?.match?.validForLanguage?.(language) === false) return "monaco";
return editor;
~~~

The implementation should expose the inventory as editors.languages through the
Editors API and its AI-vision descriptor. Add a shared assertKnownLanguage
operation to editorRegistry, but call it only at the addEditorPage argument check
beside the existing editor-id validation and in the page.language setter before
changeLanguage. validateForLanguage keeps its current fallback behavior and gains
no throw: it remains the path used by well-known-page resolution, restore,
file-open, and other internal editor resolution. Unknown public strings,
including the empty string, are argument errors; undefined remains an allowed
absence where the addEditorPage API already permits it. A known language rejected
by an editor matcher must still resolve to Monaco.

Audit result: the new throwing assertKnownLanguage has exactly two planned
callers, [PagesLifecycleModel.ts:264-280](../../../src/renderer/api/pages/PagesLifecycleModel.ts:264)
and [PageWrapper.ts:190-194](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:190).
Existing validateForLanguage callers at
[PagesLifecycleModel.ts:303-315](../../../src/renderer/api/pages/PagesLifecycleModel.ts:303),
[PagesLifecycleModel.ts:336](../../../src/renderer/api/pages/PagesLifecycleModel.ts:336),
[TextEditorModel.ts:150-155](../../../src/renderer/editors/text/TextEditorModel.ts:150),
and [TextEditorModel.ts:285](../../../src/renderer/editors/text/TextEditorModel.ts:285)
remain non-throwing. No restore, file-open, suggested-language, or persisted-state
path calls the new argument validator.
The descriptor and type changes belong in
[editors.ts:13-35](../../../src/renderer/api/editors.ts:13),
[editors.d.ts:44-66](../../../src/renderer/api/types/editors.d.ts:44), and
[editors namespace:4-20](../../../src/renderer/scripting/ai-vision/namespaces/editors.ts:4).

The error text must be exactly:

~~~text
Unknown language "nonexistent-language". Read `editors.languages` for the valid ids.
~~~

### Part B — returned-object identity in hints

The resolver appends the call segment to walked before building the result hint at
[resolver.ts:134-172](../../../src/shared/ai-vision/resolver.ts:134). As a result,
the hint path for a method result is rendered as a call expression by
[path-parser.ts:39-58](../../../src/shared/ai-vision/path-parser.ts:39), and child
paths are built beneath that dead call path by
[hint.ts:15-21](../../../src/shared/ai-vision/hint.ts:15). For example, the
returned page from pages.addEditorPage is addressable as
pages["<new page id>"], but the current child hint points below
pages.addEditorPage(). The returned page exposes editor and grouped children in
[PageWrapper.ts:225-259](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:225);
the same returned-node shape is used by
[PageCollectionWrapper.ts:117-134](../../../src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:117)
and the root wrappers at
[root.ts:210-219](../../../src/renderer/scripting/ai-vision/root.ts:210).

#### Current → planned behavior

~~~ts
const hint = nodeHint(formatPath(walked), current, settings, false);
~~~

~~~ts
const hint = nodeHint(
    descriptor?.identity?.() ?? (walkedContainsCall ? undefined : formatPath(walked)),
    current,
    settings,
    walkedContainsCall,
);
~~~

Add an optional identity callback to
[IAiVisionDescriptor](../../../src/shared/ai-vision/types.ts:57), with the
signature identity?: () => string | undefined. The callback returns the canonical
renderer-relative path to the returned node. PageWrapper can provide a callback
returning pages[JSON.stringify(this.id)] because a page has a stable id available
through its model and existing id getter at
[PageWrapper.ts:164-177](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:164).
The resolver should invoke and prefer that identity whenever a descriptor supplies
one, so the value is live for future returned-node types.

If a returned node has no addressable identity, the hint must omit both the
children path prefix and path-specific Details/$help text rather than advertise a
path that cannot resolve. It must still emit the children segment names under an
explicit relative header, for example Children (relative to this object): with
.editor and .grouped entries. Existing non-call resolution keeps its current path
behavior. The hint builder currently always formats children and path-specific
details in
[hint.ts:42-59](../../../src/shared/ai-vision/hint.ts:42); add an explicit
relative-children mode there instead of passing an empty or fabricated path. The
explicit help resolver remains responsible for directly requested paths at
[hint.ts:62-72](../../../src/shared/ai-vision/hint.ts:62).

The resolver’s forceMembers error branch at
[resolver.ts:199-218](../../../src/shared/ai-vision/resolver.ts:199) must use the
same safe identity selection once the adjacent US-1355 hint-economics work is
integrated. US-1355 owns the forceMembers/error-hint and deduplication policy;
this task supplies the returned-node identity rule without duplicating that
policy. Forwarded window hints also need the canonical returned-object path
prefixed by
[call-tools.ts:70-83](../../../src/main/mcp/tools/call-tools.ts:70), so identity
paths remain valid after cross-window routing.

### Part C — grid row keys

Row identity is deliberately stored outside row payloads in the WeakMap at
[grid-utils.ts:98-125](../../../src/renderer/editors/grid/utils/grid-utils.ts:98).
getRows returns the live row objects at
[GridEditor.ts:229-237](../../../src/renderer/editors/grid/GridEditor.ts:229), so
reading or JSON-parsing rows cannot reveal their keys. The facade currently
exposes rows, columns, rowCount, and selection, but no row-key read member, as
shown by
[GridEditorFacade.ts:24-47](../../../src/renderer/scripting/api-wrapper/GridEditorFacade.ts:24)
and
[grid-editor.d.ts:12-55](../../../src/renderer/api/types/grid-editor.d.ts:12).
Mutation methods consume keys through editCell and deleteRows at
[GridEditorFacade.ts:177-187](../../../src/renderer/scripting/api-wrapper/GridEditorFacade.ts:177).

There are two key minting paths. Parsed/live rows are registered with the
index-string form String(startIndex + i) at
[grid-utils.ts:103-107](../../../src/renderer/editors/grid/utils/grid-utils.ts:103),
while an unregistered object receives the fallback r<N> form at
[grid-utils.ts:110-125](../../../src/renderer/editors/grid/utils/grid-utils.ts:110).
GridEditor.newRow registers normal added rows with the numeric form at
[GridEditor.ts:650-654](../../../src/renderer/editors/grid/GridEditor.ts:650).
Thus the documented contract for rows reachable through this editor is
index-string keys; r<N> is only the defensive fallback for an object that was
never registered. A read member must return keys in the same current live-row
order as rows, so callers can pair rows[i] with rowKeys[i], including after
sorting, filtering, or other view changes. The existing selection rowKeyStart and
rowKeyEnd exposure confirms that keys are already surface-level identifiers at
[GridEditorFacade.ts:136-149](../../../src/renderer/scripting/api-wrapper/GridEditorFacade.ts:136).

#### Current → planned behavior

~~~ts
// GridEditorFacade.ts
get rows(): any[] {
    return this.editor.getRows();
}
~~~

~~~ts
// GridEditorFacade.ts
get rows(): any[] {
    return this.editor.getRows();
}

get rowKeys(): string[] {
    return this.editor.getRowKeys();
}
~~~

Add GridEditor.getRowKeys(), implemented as getRowKey over the current live rows,
then expose it as GridEditorFacade.rowKeys, an AI-vision member, and the public
IGridEditor type. Add help stating that rows remain the JSON data payload and
rowKeys is the parallel read path; document the index-string format and explain
that keys must be passed to editCell and deleteRows. Keep the operation in
GridEditor so the facade does not duplicate WeakMap access.

The report’s sparse-row observation is intentional, not a defect. GridEditor.newRow
creates an empty object at
[GridEditor.ts:650-654](../../../src/renderer/editors/grid/GridEditor.ts:650),
whereas the empty-page bootstrap supplies its initial column-bearing placeholder
at
[GridEditor.ts:502-519](../../../src/renderer/editors/grid/GridEditor.ts:502).
The grid formatter treats absent and null values as empty display cells at
[grid-utils.ts:158-174](../../../src/renderer/editors/grid/utils/grid-utils.ts:158).
Consequently addRows(2) returning two {} payloads is the intended sparse
representation; do not materialize declared columns with null values.

## Implementation Plan

### Part A

1. Extend editorRegistry with a language inventory/read operation and a shared
   throwing argument validator backed by monacoLanguages. Call it only from the
   addEditorPage argument check and page.language setter; never from
   validateForLanguage. Keep unknown strings out of matcher fallback while
   emitting the exact decision-7 message naming editors.languages.
2. Expose the same inventory as editors.languages through the Editors API,
   IEditorRegistry declaration, and the editors AI-vision namespace descriptor.
   Do not create a second list.
3. Call the argument validator from PageWrapper.language before changeLanguage and
   from the addEditorPage argument validation beside editor-id validation. Leave
   the well-known-page, restore, file-open, and persisted-state paths on the
   existing fallback-only validateForLanguage behavior.
4. Confirm that both addEditorPage and page.language reject unknown strings while a
   known-but-unsupported language falls back to Monaco.

### Part B

1. Add an optional descriptor identity field and define it as a canonical,
   renderer-relative, addressable path callback returning string | undefined.
2. Populate page descriptors with an identity callback returning
   pages[JSON.stringify(pageId)].
3. Update resolver hint construction to use descriptor identity for returned
   objects. For returned nodes without identity, emit children as relative segment
   names under an explicit relative header and suppress path-specific help/details;
   retain normal paths for non-call resolutions.
4. Apply the same path-selection rule to forceMembers/error hints under US-1355’s
   hint policy, and update cross-window hint prefixing for canonical identity
   paths.
5. Verify pages.addEditorPage.editor resolves through the new page-id path and
   that no dead pages.addEditorPage() child path is advertised.

### Part C

1. Add GridEditor.getRowKeys() over the same live-row sequence returned by
   getRows().
2. Expose rowKeys in GridEditorFacade, IGridEditor, the AI-vision descriptor, and
   GridEditor help. State the index-string contract, the parallel ordering, and
   the r<N> defensive fallback without changing rows.
3. Leave sparse new-row payloads unchanged and verify that mutations continue to
   consume the returned keys.

## Ordering and overlap

This task lands after US-1355, US-1356, and US-1357 in EPIC-091’s commit order.
The implementation must rebase onto those tasks’ landed shapes rather than the
current pre-task source shown in some citations above.

- In [resolver.ts](../../../src/shared/ai-vision/resolver.ts), US-1355 owns
  errorAt and the hint gate/dedupe, US-1356 owns the property-with-args warning,
  and US-1357 owns the shaping call. US-1358 owns only returned-object identity at
  the nodeHint call near line 171; it must preserve the other tasks’ changes.
- In [hint.ts](../../../src/shared/ai-vision/hint.ts), US-1355 adds the
  error-hint builder. US-1358 adds the no-address relative-children mode in the
  buildHint neighborhood and must compose with that builder rather than replace
  or duplicate its policy.
- In [GridEditorFacade.ts](../../../src/renderer/scripting/api-wrapper/GridEditorFacade.ts),
  US-1356 lands validation on addRows, editCell, and deleteRows first. US-1358
  adds rowKeys on top of that shape. US-1356’s key-bearing error messages and
  GridEditor help must use the same index-string and r<N> format contract that
  this task documents.

## Concerns

- The language inventory must remain aligned with Monaco’s actual language ids.
  monacoLanguages is static and already contains the five IDs separately
  registered by configure-monaco. The public API should return a stable
  read-only-shaped list rather than expose mutable registry state. Any future
  custom registration must update the catalog as well.
  Sources: [monaco-languages.ts:3-29](../../../src/renderer/core/utils/monaco-languages.ts:3),
  [monaco-languages.ts:1081-1084](../../../src/renderer/core/utils/monaco-languages.ts:1081).
- The throwing validator is an argument-boundary check: undefined is allowed only
  where addEditorPage already permits an absent language, while every public
  language string not in the catalog is rejected. Internal resolution must keep
  using non-throwing validateForLanguage. This boundary is required by
  [PagesLifecycleModel.ts:264-280](../../../src/renderer/api/pages/PagesLifecycleModel.ts:264)
  and [PageWrapper.ts:190-194](../../../src/renderer/scripting/api-wrapper/PageWrapper.ts:190).
- Identity is optional because some returned nodes have no stable address. A hint
  without identity must still retain its children list, but only as relative
  segment names under an explicit relative header. It must not fabricate an
  addressable path. Window and Windows descriptors are examples of wrappers that
  currently have members but no returned-object identity at
  [main-root.ts:111-153](../../../src/main/mcp/ai-vision/main-root.ts:111).
- Identity paths must survive main-process forwarding. The prefix helper currently
  recognizes only relativeRoot and path prefixes at
  [call-tools.ts:70-83](../../../src/main/mcp/tools/call-tools.ts:70).
- Grid keys are not row fields by design. Adding keys into rows would break the
  JSON payload contract and would not fix the separate index-versus-r<N> fallback
  behavior. Sources: [grid-utils.ts:78-125](../../../src/renderer/editors/grid/utils/grid-utils.ts:78)
  and [GridEditor.ts:229-237](../../../src/renderer/editors/grid/GridEditor.ts:229).
- The generated editor-types asset is derived from source configuration at
  [vite.renderer.config.ts:7-23](../../../vite.renderer.config.ts:7), so source
  declarations are the change point.

## Acceptance Criteria

- Unknown language strings passed to addEditorPage or page.language throw an
  argument error with the exact message: Unknown language "nonexistent-language".
  Read `editors.languages` for the valid ids.
- editors.languages is sourced from the Monaco language inventory and exposes all
  valid ids without a duplicate hand-maintained list.
- A real language that the selected editor does not support still falls back to
  Monaco; supported languages and the internal undefined no-language state remain
  valid.
- A returned page hint uses pages[<JSON-quoted page id>] as its base path, and its
  editor/grouped children resolve below that page. A returned node without an
  identity still emits its children as relative names under an explicit relative
  header, without a fabricated path or path-specific help.
- No returned-node hint loses its children list solely because the node has no
  identity.
- IAiVisionDescriptor.identity is a callback returning the current optional
  canonical path, not a captured string.
- Resolver, forceMembers/error hints, and forwarded window hints apply one
  consistent identity rule.
- GridEditor, GridEditorFacade, IGridEditor, and GridEditor AI help expose rowKeys
  as a read-only parallel array matching getRows() order.
- rows remains the original data payload and does not gain a key property.
  Normal registered row keys are index strings; r<N> is documented only as the
  unregistered-object fallback.
- addRows continues to return sparse {} rows where values are absent; no columns
  are materialized with null values.
- QA coverage is identified: [qa/surfaces/gate.md:75-98](../../../qa/surfaces/gate.md:75)
  and [qa/surfaces/dialogs.md:16-32](../../../qa/surfaces/dialogs.md:16) touch
  addEditorPage and returned pages; [qa/surfaces/editors/data.md:10-41](../../../qa/surfaces/editors/data.md:10)
  covers grid setup but currently does not read rows, rowKeys, or call grid
  mutations; [qa/surfaces/page.md:55-68](../../../qa/surfaces/page.md:55) covers
  page identity but no returned-object hint assertion. No existing surface scenario
  directly exercises grid row methods or dead hint paths, so targeted coverage
  should be added during implementation or QA planning, not in this task document.

## Files needing NO changes

- [src/renderer/core/utils/monaco-languages.ts](../../../src/renderer/core/utils/monaco-languages.ts):
  the existing language inventory is the source of truth; it does not need new
  validation logic.
- [src/renderer/editors/base/editor-matchers.ts](../../../src/renderer/editors/base/editor-matchers.ts):
  matcher fallback semantics remain unchanged.
- [src/renderer/editors/grid/utils/grid-utils.ts](../../../src/renderer/editors/grid/utils/grid-utils.ts):
  keep the WeakMap and both existing key-minting paths.
- [src/renderer/editors/grid/GridBodyView.ts](../../../src/renderer/editors/grid/GridBodyView.ts):
  row-key calculation already flows into the view; the new read path belongs on
  GridEditor.
- [src/renderer/editors/text/TextEditorModel.ts](../../../src/renderer/editors/text/TextEditorModel.ts):
  its internal validateForLanguage calls remain on the non-throwing fallback path.
- [assets/editor-types](../../../assets/editor-types):
  generated artifacts are not hand-edited.
- [qa/surfaces/](../../../qa/surfaces/):
  this task records the relevant existing scenarios but does not add tests or
  harnesses.
- [doc/active-work.md](../../active-work.md):
  no dashboard entry is to be added or changed for this task.

## Files Changed Summary

| File | Planned change |
|---|---|
| src/renderer/editors/base/editorRegistry.ts | Expose the static language inventory and add a throwing argument-boundary check without changing editor fallback semantics. |
| src/renderer/api/editors.ts | Expose the language inventory on the Editors API. |
| src/renderer/api/types/editors.d.ts | Declare editors.languages and its registry-facing type. |
| src/renderer/scripting/ai-vision/namespaces/editors.ts | Add the editors.languages AI-vision member and help. |
| src/renderer/api/pages/PagesLifecycleModel.ts | Invoke the argument-boundary language check beside addEditorPage editor-id validation. |
| src/renderer/scripting/api-wrapper/PageWrapper.ts | Validate the writable language setter and provide page identity to hints. |
| src/shared/ai-vision/types.ts | Add optional returned-node identity metadata to descriptors. |
| src/shared/ai-vision/resolver.ts | Select returned-object identity for hints while retaining relative children for identity-less results. |
| src/shared/ai-vision/hint.ts | Support relative children without a fabricated path or path-specific help. |
| src/main/mcp/tools/call-tools.ts | Prefix canonical identity paths when forwarding hints across windows. |
| src/renderer/editors/grid/GridEditor.ts | Provide row keys in current live-row order. |
| src/renderer/scripting/api-wrapper/GridEditorFacade.ts | Expose rowKeys and document its parallel-array contract. |
| src/renderer/api/types/grid-editor.d.ts | Declare the rowKeys read path. |
