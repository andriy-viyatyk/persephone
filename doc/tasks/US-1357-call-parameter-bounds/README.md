# US-1357: `call` parameter bounds — `limit`, `maxLength`, `windowIndex`

**Status:** Implemented (unreviewed — epic close runs the completion skills)

Epic: [EPIC-091](../../epics/EPIC-091.md), decision 6; report items 1.3, 1.6 and 1.7.

## Goal

Make the `call` bounds explicit and useful: reject invalid `maxLength` and `windowIndex` values at
the MCP boundary, prevent non-positive `helpSearch` limits from changing `slice()` semantics, and
bound top-level array/object results by complete JSON entries. A structured result must remain valid
JSON and must report how many entries were shown versus how many were available.

## Background

### Current parameter flow

The advertised `call` schema currently declares `maxLength` as an unconstrained integer at
`src/main/mcp/tools/call-tools.ts:124-130`; `windowIndex` is supplied by the shared context as
another unconstrained integer at `src/main/mcp/tools/params.ts:5-11`. The reported JSON Schema
minimum of `-9007199254740991` is therefore Zod's integer range leaking through, not an intended
application bound. The handler separately narrows `path`, `args`, and `maxLength` at
`src/main/mcp/tools/call-tools.ts:132-147`; those runtime coercions are not the validation contract
and must not be confused with the schema edit.

The MCP SDK validates a registered tool's input with `safeParseAsync` before invoking the handler
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:166-180`). A failed parse becomes
an `InvalidParams` error with the prefix `Input validation error: Invalid arguments for tool call:`
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:174-178`), and the request handler
returns it to the caller as an `isError: true` text result
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:100-142`). The current installed
Zod locale formats these minimum failures as `Too small: expected number to be >=1` or `>=0`
(`node_modules/zod/v4/locales/en.js:73-75`), which names the violated bound and is actionable
enough; no project-specific error wrapper is planned for these two schema-only failures.

The standing rule from EPIC-091 is to validate guessed input and throw an actionable error
(`doc/epics/EPIC-091.md:64-70`). Decision 6 specifically chooses clamping for a numeric
`helpSearch` limit (`doc/epics/EPIC-091.md:236-247`). US-1356 owns the type/arity validation of
raw `helpSearch` arguments in `src/renderer/scripting/ai-vision/root.ts:173-175`; US-1357 owns
only the numeric lower-bound normalization in the shared search implementation. The two tasks must
not both edit the wrapper line or duplicate the type check.

### Current `helpSearch` behavior

`helpSearch(root, query, limit = 20)` tokenizes the query and walks independently capped by
`MAX_NODES = 300` and `MAX_DEPTH = 5` (`src/shared/ai-vision/help-search.ts:21-32`). After sorting,
it deduplicates and uses the supplied limit only in `dedupe(hits).slice(0, limit)`
(`src/shared/ai-vision/help-search.ts:64-65`). JavaScript's negative `slice` index removes entries
from the end, which is the complete cause of report item 1.3. The root advertises this method as
`helpSearch(query: string, limit = 20)` (`src/renderer/scripting/ai-vision/root.ts:37-41`) and
passes its arguments to the core (`src/renderer/scripting/ai-vision/root.ts:173-175`).

The decision is to clamp every numeric limit below 1 to `1` immediately before the final slice.
This is a deliberately narrow exception to the guessed-input rule: a correctly typed numeric limit
has an unambiguous intent (“return at least one hit”), while the current negative value has a
surprising implementation-defined effect. Wrong types, missing required query, and excess
arguments remain US-1356 validation errors; this task does not make those values silently usable.

Before:

~~~ts
export async function helpSearch(root: unknown, query: string, limit = 20): Promise<IHelpSearchHit[]> {
    // ... traversal and sorting ...
    return dedupe(hits).slice(0, limit);
}
~~~

After:

~~~ts
export async function helpSearch(root: unknown, query: string, limit = 20): Promise<IHelpSearchHit[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, limit) : 20;
    // ... traversal and sorting ...
    return dedupe(hits).slice(0, boundedLimit);
}
~~~

`Number.isFinite` is intentional: `NaN`, `Infinity`, and `-Infinity` use the default `20` rather
than becoming `NaN` or an empty result through `slice(0, NaN)`. The exact local variable name may
follow the implementation style, but the guard and clamp belong at
`src/shared/ai-vision/help-search.ts:24-65`; `src/renderer/scripting/ai-vision/root.ts:173-175`
belongs to US-1356 for raw argument validation and remains outside this task's implementation.

### Current result shaping and the structured-result gap

The shared shaper keeps the default at `DEFAULT_MAX_LENGTH = 20_000`
(`src/shared/ai-vision/result-shaper.ts:10`) and currently applies that limit to a top-level string,
returning `{ result: slice, truncated: true, totalLength }`
(`src/shared/ai-vision/result-shaper.ts:30-35`). Nested strings receive an inline suffix instead
(`src/shared/ai-vision/result-shaper.ts:37-41`). Arrays are shaped element-wise, capped at
`MAX_ARRAY_ITEMS = 500`, and receive an existing `{ kind: "truncated", note }` marker beyond that
cap (`src/shared/ai-vision/result-shaper.ts:21-22,52-63`). Plain objects currently include every
non-function property (`src/shared/ai-vision/result-shaper.ts:69-75`).

The resolver takes `request.maxLength` or the unchanged 20,000 default and shapes the final value
at `src/shared/ai-vision/resolver.ts:53-65,163-172`. It exposes only string truncation metadata in
`ICallResult` today (`src/shared/ai-vision/resolver.ts:35-48`). The main call adapter mirrors that
envelope and renders JSON with `JSON.stringify(..., null, 2)` at
`src/main/mcp/tools/call-tools.ts:194-204,239-265`; its current truncation message assumes
`result` is a string at line 262. This is why structured results can exceed a caller's requested
`maxLength` without a `truncated` flag (the reproduction is recorded at
`doc/epics/EPIC-091.md:86-89`).

Decision 6 requires the structured check to operate on the serialized JSON of the already shaped
top-level array or object, while preserving the unchanged depth boundary
`MAX_DEPTH = 8` (`src/shared/ai-vision/result-shaper.ts:12-22`). The depth cap is not an output-size
substitute and must not be changed: it protects plain, user-authored data, while descriptor-owned
call input schemas must remain visible at the existing depth (`src/shared/ai-vision/result-shaper.ts:12-19`).

The proposed structured envelope keeps the original collection type inside `result` and adds
metadata beside it:

~~~json
{
  "path": "helpSearch",
  "result": [{"path": "pages", "kind": "Pages"}],
  "truncated": true,
  "shown": 1,
  "total": 3
}
~~~

For an array, `shown` is the number of complete array elements retained and `total` is the
original top-level array length. For an object, the result remains an object containing a prefix of
complete own enumerable key/value entries; `shown` is the number of retained properties and `total`
is the number of shaped top-level properties. For example:

~~~json
{
  "path": "someObject",
  "result": {"first": "value"},
  "truncated": true,
  "shown": 1,
  "total": 3
}
~~~

The metadata is part of `ICallResult`/`ICallEnvelope`, not inserted into the returned array or
object, so an existing consumer can still recognize the collection type. String results retain
their current `totalLength` contract; `shown`/`total` are for structured entry counts and are not a
replacement for string character counts.

### Interaction with the existing array cap

The two limits compose in this order:

1. `shapeValue` keeps the existing `MAX_ARRAY_ITEMS = 500` cap and its marker for a collection that
   fits within the requested serialized size. This preserves the current independent safety bound.
2. The new top-level structured-size pass measures the shaped JSON using the same two-space JSON
   serialization the MCP adapter emits (`src/main/mcp/tools/call-tools.ts:253-260`). If it exceeds
   `maxLength`, it selects the largest prefix of complete shaped array elements or object entries
   that fits. The size pass can therefore reduce the visible count below 500, but it never raises or
   replaces the 500-item cap.
3. When the size pass truncates an array that also exceeded 500 items, it omits the old synthetic
   marker from the returned prefix and reports the actual original element count in `total`; the
   new `shown`/`total` metadata is the authoritative truncation signal for that response. If the
   shaped 500-item result plus its existing marker fits, the old marker behavior remains unchanged.

The selection must be prefix-based and greedy in source order, without serializing the growing
prefix. Serialize each shaped array element once with `JSON.stringify(element, null, 2)`. Let
`embeddedLength(text, 2)` be `text.length + 2 * (1 + count of newline characters in text)`, which
accounts for the two-space indentation applied to every line when that element is inside the
top-level array. For a non-empty array prefix of `k` elements, accumulate
`4 + sum(embeddedLength(elementText, 2)) + 2 * (k - 1)`: the `4` is the opening/closing bracket
newlines and each `2` is the `,\n` separator. The empty array is length `2`.

For an object, serialize each shaped value once and serialize each property key once with
`JSON.stringify(key)`. The entry contribution is
`2 + keyText.length + 2 + embeddedLength(valueText, 2)`, covering the property indentation and
`: ` after the key. For a non-empty object prefix of `k` properties, use
`4 + sum(entryContribution) + 2 * (k - 1)`; again, `4` is the wrapper's newlines and each `2` is
the `,\n` separator. Stop before the first accumulated prefix length over `maxLength`. These rules
measure the same two-space JSON form emitted by
`src/main/mcp/tools/call-tools.ts:253-260`, while doing only O(n) string building instead of
re-serializing an O(n)-sized prefix for every candidate.

The accumulated lengths are only a selection aid. Keep the selected array/object as real values and
produce the final result through one actual `JSON.stringify` of that selected prefix at the output
boundary; never return the accumulated text as the result. If no single entry fits, return `{}` or
`[]` of the same collection kind with `shown: 0`; never splice a stringified candidate. The
smallest valid JSON collection is two characters, so `maxLength: 1` can legitimately produce an
empty collection of length two while still satisfying the more important valid-JSON guarantee.

## Implementation Plan

### 1. Clamp the validated `helpSearch` limit

- In `src/shared/ai-vision/help-search.ts:24-65`, normalize the numeric `limit` to at least `1`
  immediately before the final `slice`. Keep the default `20`, traversal caps, sort order, and
  deduplication unchanged.
- Do not edit `src/renderer/scripting/ai-vision/root.ts:173-175` for this behavior. US-1356 is
  changing that wrapper to inspect raw positional arguments and own the query/limit type and arity
  errors. After that change, a valid numeric `-5` reaches this core and returns at most the first
  hit rather than dropping five hits from the end.
- Keep the behavior of a valid query with no matches as `[]`; only the non-positive numeric limit is
  normalized.

### 2. Add MCP schema minimums and update the parameter description

- In `src/main/mcp/tools/call-tools.ts:124-130`, change `maxLength` to
  `z.number().int().min(1).optional()` and update its description from string-only output to
  string/structured output, naming `truncated`, `totalLength` for strings, and `shown`/`total` for
  collections. Do not change the handler's type narrowing at `:132-147`; the schema is the
  pre-handler boundary and the handler still needs its runtime shape.
- In `src/main/mcp/tools/params.ts:9-11`, change `windowIndex` to
  `z.number().int().min(0).optional()`, retaining its existing description and optionality.
- Verify through the MCP request path that `maxLength: 0`, `maxLength: -1`, and
  `windowIndex: -1` fail before `call-tools.ts`'s handler executes. The returned tool result must
  be `isError: true` and identify the tool, the invalid argument class, and the applicable bound;
  the SDK/Zod path cited above already supplies that message, so do not add a second resolver error
  envelope.
- Keep `windowIndex` routing behavior itself unchanged. Valid non-negative values continue through
  `routeCallPath` (`src/main/mcp/tools/call-tools.ts:35-64`).

Before:

~~~ts
maxLength: z.number().int().optional().describe("Cut string results longer than this (default 20000); the response then carries truncated: true and totalLength."),
windowIndex: z.number().int().optional().describe(/* existing text */),
~~~

After:

~~~ts
maxLength: z.number().int().min(1).optional().describe(
    "Bound string or structured results (default 20000); strings report totalLength, collections report shown/total when truncated.",
),
windowIndex: z.number().int().min(0).optional().describe(/* existing text */),
~~~

### 3. Bound structured results in the shared shaper

- In `src/shared/ai-vision/result-shaper.ts:24-35`, extend the shaped-result contract with optional
  `shown` and `total` fields while retaining `truncated` and `totalLength` for strings.
- Preserve the current top-level string branch exactly, including its character slicing and
  `totalLength`; preserve nested-string suffixes, cycle handling, descriptor summaries, dates,
  errors, maps/sets, and function omission. The new logic begins only after a top-level value has
  been shaped and is an array or object collection.
- Serialize the shaped collection with the same pretty JSON settings used by the MCP renderer,
  `JSON.stringify(value, null, 2)` (`src/main/mcp/tools/call-tools.ts:259-260`). If its serialized
  length is within `maxLength`, return the existing shaped collection and no new metadata.
- If it exceeds the bound, serialize each shaped top-level element or property value once, accumulate
  the exact pretty-JSON contribution using the array/object formulas above, and stop before the first
  prefix that would exceed the bound. Do not serialize the growing prefix once per candidate. Build a
  fresh array or plain object from the accepted values in original order, then let the output boundary
  perform one real `JSON.stringify` of that selected prefix. Do not use `slice()` on a serialized
  string, do not append an ellipsis to JSON, and do not include the old array marker in a new
  size-truncated prefix.
- Set `truncated: true`, `shown`, and `total` only for this structured-size branch. For arrays,
  calculate `total` from the original top-level array length before the 500-item cap; for objects,
  calculate it from the shaped object's own enumerable entries. Keep the existing 500-item marker
  when the structured-size branch is not needed.
- Leave `MAX_DEPTH = 8` unchanged at `src/shared/ai-vision/result-shaper.ts:21`; no change may make
  `call` schemas disappear because of the depth cap.

Before:

~~~ts
export interface IShapedResult {
    result: unknown;
    truncated?: boolean;
    totalLength?: number;
}

export function shapeResult(value: unknown, maxLength = DEFAULT_MAX_LENGTH): IShapedResult {
    if (typeof value === "string" && value.length > maxLength) {
        return { result: value.slice(0, maxLength), truncated: true, totalLength: value.length };
    }
    return { result: shapeValue(value, 0, new WeakSet(), maxLength) };
}
~~~

After (contract and control flow):

~~~ts
export interface IShapedResult {
    result: unknown;
    truncated?: boolean;
    totalLength?: number; // top-level string character count
    shown?: number;       // top-level structured entries retained
    total?: number;       // top-level structured entries available
}

export function shapeResult(value: unknown, maxLength = DEFAULT_MAX_LENGTH): IShapedResult {
    if (typeof value === "string" && value.length > maxLength) {
        return { result: value.slice(0, maxLength), truncated: true, totalLength: value.length };
    }
    const shaped = shapeValue(value, 0, new WeakSet(), maxLength);
    return isStructuredCollection(shaped)
        ? truncateStructuredResult(shaped, maxLength, value)
        : { result: shaped };
}
~~~

The helper names above are implementation guidance, not an API requirement. The implementation must
make `truncateStructuredResult` operate on shaped values and must preserve the original array count
before the existing cap as described above. Any serialization failure must return the existing safe
fallback rather than a malformed partial string; descriptor summaries are required to be JSON-able
by `src/shared/ai-vision/types.ts:81-87`.

### 4. Carry and render structured truncation metadata

- In `src/shared/ai-vision/resolver.ts:35-48`, add optional `shown` and `total` to `ICallResult` and
  spread the extended `shapeResult` result unchanged at the existing success/error shaping sites
  (`src/shared/ai-vision/resolver.ts:78-82,163-172`). No resolver depth or routing behavior
  changes are needed.
- In `src/main/mcp/tools/call-tools.ts:194-204`, mirror `shown` and `total` in `ICallEnvelope`.
- In `src/main/mcp/tools/call-tools.ts:239-265`, retain the existing string message when
  `totalLength` is present, and add a structured message when `shown` and `total` are present, for
  example `[truncated: showing 3 of 12 items — raise maxLength or read a narrower path]`. Render
  the already valid JSON body first, then the metadata text block. Do not read `.length` from a
  structured `result` and do not put the metadata inside the collection itself.
- Update the `maxLength` JSDoc in `src/renderer/api/types/app.d.ts:72-84,190-198` from
  string-only wording to explain that the same shared resolver now bounds structured values. The
  existing `AppWrapper.call()` already forwards `options.maxLength` to `resolveCall`
  (`src/renderer/scripting/api-wrapper/AppWrapper.ts:142-154`), so it needs no code change.

Before:

~~~ts
if (rest.truncated) {
    content.push({ type: "text", text: `[truncated: showing ${(rest.result as string).length} of ${rest.totalLength} chars …]` });
}
~~~

After:

~~~ts
if (rest.truncated) {
    const text = rest.shown !== undefined && rest.total !== undefined
        ? `[truncated: showing ${rest.shown} of ${rest.total} items — raise maxLength or read a narrower path]`
        : `[truncated: showing ${(rest.result as string).length} of ${rest.totalLength} chars — raise maxLength or read a narrower path]`;
    content.push({ type: "text", text });
}
~~~

## Ordering and overlap

This task is the third relevant change in the epic's numeric sequence. It must be implemented after
US-1356 and on top of that task's result-envelope changes, not against the pre-US-1356 source.

- **`src/main/mcp/tools/call-tools.ts`:** US-1356 lands first and adds `warning` to
  `ICallResult`/`ICallEnvelope` plus the non-fatal `Warning:` block in `toCallResult`. US-1357 adds
  `shown`/`total` to the same envelope and rewrites the truncation branch at line 262, whose current
  `(rest.result as string).length` assumption is the exact line both tasks care about. Preserve
  US-1356's warning field, rendering order, and `isError` behavior while adding the string-versus-
  structured truncation branch. US-1358 separately edits the cross-window hint-prefix helper at
  `src/main/mcp/tools/call-tools.ts:70-83`; do not fold that change into this task.
- **`src/shared/ai-vision/resolver.ts`:** US-1355 owns `errorAt` and its hint gate
  (`src/shared/ai-vision/resolver.ts:199-219`); US-1356 owns the property-with-args warning near
  the property-read path (`src/shared/ai-vision/resolver.ts:134-155`); and US-1358 owns returned-
  object identity near the final hint construction (`src/shared/ai-vision/resolver.ts:160-172`).
  US-1357 touches only the `maxLength`/shaping flow at
  `src/shared/ai-vision/resolver.ts:53-65,163-172` and adds the `shown`/`total` type fields beside
  the existing truncation fields. Resolve any merge manually so none of the sibling behavior is
  dropped.
- **`src/shared/ai-vision/help-search.ts`:** US-1357 owns the final slice at line 65, including
  the finite-limit guard and lower-bound clamp. US-1356 owns the raw argument validation in
  `src/renderer/scripting/ai-vision/root.ts:173-175` and must not edit this shared search file.
  Keep the two edits disjoint: the wrapper rejects wrong types/arity, while this exported core
  remains safe for direct callers and treats non-finite numeric limits as the default 20.

## Concerns

### Resolved decisions

- **Clamp versus reject:** clamp numeric limits below one to one, as required by EPIC-091 decision 6.
  Type/arity mistakes remain actionable US-1356 errors. This prevents the silent tail-dropping bug
  without changing `helpSearch`'s valid empty-match result.
- **`MAX_ARRAY_ITEMS` versus `maxLength`:** compose them, with the existing 500-item cap first and
  the serialized-size prefix second. `maxLength` can reduce the visible count but cannot expand the
  existing cap or replace its behavior when the size limit is not reached.
- **Object envelope:** retain an object result containing whole properties and put `truncated`,
  `shown`, and `total` beside `result` in the resolver/MCP envelope. This avoids array/object type
  changes and avoids collisions with user property names.
- **Depth:** no change to `MAX_DEPTH`; the standing rule and its rationale are recorded at
  `src/shared/ai-vision/result-shaper.ts:12-22`.
- **Invalid JSON:** this is an abort criterion, not a tradeoff. If any structured value or boundary
  case can only be bounded by cutting a token, ship the schema minimums and limit clamp, and move
  report item 1.6 to EPIC-091's not-acted-on table as directed by
  `doc/epics/EPIC-091.md:261-264`.

### QA coverage found

No current `qa/surfaces/` scenario asserts `call`'s `maxLength`, the `truncated` flag,
`totalLength`, structured `shown`/`total`, JSON validity after truncation, or a serialized result
length. The closest existing result-size/count assertions are:

| Scenario | Existing assertion | Relevance to US-1357 |
|---|---|---|
| [`qa/surfaces/tools.md:28-41`](../../../qa/surfaces/tools.md:28) — T.2 | Empty search is a cheap listing; `select:` returns one complete definition and a readable full `inputSchema`. | Regression check that default structured shaping does not hide tool arguments. |
| [`qa/surfaces/editors/boards.md:9-23`](../../../qa/surfaces/editors/boards.md:9) — B.1 | `boards.list()` returns one record per board root. | Regression check for collection element preservation and counts. |
| [`qa/surfaces/panels.md:57-68`](../../../qa/surfaces/panels.md:57) — P.4 | Folder View exposes a copied, facade-capped item list and a count; empty is `[]`. | Separate facade cap; not `call.maxLength`, but checks collection shape and size metadata. |
| [`qa/surfaces/panels.md:70-83`](../../../qa/surfaces/panels.md:70) — P.5 | Git commits are a bounded page with a loaded count, never an unbounded history dump. | Separate pagination bound; useful regression surface for bounded structured output. |
| [`qa/surfaces/editors/data.md:27-40`](../../../qa/surfaces/editors/data.md:27) — D.2 | Empty grid properties return real `[]` and `0`, not `undefined`. | Ensures an empty structured result remains its original type. |
| [`qa/surfaces/editors/data.md:129-142`](../../../qa/surfaces/editors/data.md:129) — D.8 | Archive listing contains path, size and directory flag for each entry. | Whole-entry preservation check for object-array results. |
| [`qa/surfaces/editors/data.md:145-158`](../../../qa/surfaces/editors/data.md:145) — D.9 | Log View push returns all five `entryIds`, and all five render. | Existing exact result-size assertion; no `maxLength` is supplied. |
| [`qa/surfaces/windows.md:24-31`](../../../qa/surfaces/windows.md:24) — W.1 | Reports the window count and each window's page count. | Count/result regression check; no truncation assertion. |
| [`qa/surfaces/gate.md:150-170`](../../../qa/surfaces/gate.md:150) — G.5 | Refresh and search expose the registry envelope and definitions. | Closest gate coverage for a potentially large structured `tools` result. |

The implementation should manually probe a large `helpSearch` array and a plain object returned by
`script.execute`, using a `maxLength` below, at, and above the serialized boundary, and inspect the
MCP text body plus `shown`/`total`. This is a manual acceptance activity, not a new unit test or test
harness; no `qa/surfaces/` file is required by this planning task.

## Acceptance Criteria

- `call`'s published schema reports `maxLength.minimum = 1` and `windowIndex.minimum = 0`; the
  default remains 20,000. `maxLength: 0`, a negative `maxLength`, and a negative `windowIndex` are
  rejected by the MCP SDK before the custom handler runs, with `isError: true` and a useful minimum
  message (`src/main/mcp/tools/call-tools.ts:124-130`; SDK path at
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:166-180`).
- A valid numeric `helpSearch` limit of `0` or `-5` returns the first available hit rather than
  dropping results from the end. The traversal caps, sorting, deduplication, default 20, and valid
  no-match `[]` behavior remain unchanged (`src/shared/ai-vision/help-search.ts:21-26,32-65`).
- US-1356's raw `helpSearch` query/type/arity validation remains the sole owner of
  `src/renderer/scripting/ai-vision/root.ts:173-175`; US-1357 does not duplicate or weaken it.
- A top-level array whose shaped JSON exceeds `maxLength` returns a valid JSON array of complete
  elements, with `truncated: true`, `shown` equal to retained elements, and `total` equal to the
  original array length. No element is cut, and an oversized first element produces `[]`, `shown: 0`.
- A top-level object whose shaped JSON exceeds `maxLength` returns a valid JSON object of complete
  properties, with `truncated: true`, `shown` equal to retained properties, and `total` equal to the
  shaped object's original property count. User properties cannot collide with the metadata because
  the metadata stays beside `result`.
- Structured size truncation composes with `MAX_ARRAY_ITEMS = 500`; it can reduce the visible prefix
  but never increases or replaces that existing cap. `MAX_DEPTH = 8` is byte-for-byte unchanged and
  representative nested tool schemas remain readable (`src/shared/ai-vision/result-shaper.ts:21-22`).
- String results retain their existing `result` slice, `truncated`, `totalLength`, nested-string
  suffix, and MCP character message. Structured results use the new item message; the renderer never
  reads `.length` as though a structured result were a string (`src/main/mcp/tools/call-tools.ts:253-265`).
- With `maxLength` omitted, existing QA-covered result shapes and counts remain unchanged; the
  default constant remains 20,000. The new behavior is observable only when the effective serialized
  structured result exceeds that unchanged bound or when a caller supplies a smaller bound.
- Every boundary case produces parseable JSON. If this cannot be demonstrated for arrays, objects,
  nested shaped values, empty collections, the 500-item interaction, and `maxLength: 1`, item 1.6 is
  not shipped and the task proceeds only with items 1.3 and 1.7, per the epic abort rule.

## Files Changed Summary

| Path | Planned change |
|---|---|
| `src/shared/ai-vision/help-search.ts` | Clamp numeric limits below 1 immediately before the final deduplicated hit slice. |
| `src/shared/ai-vision/result-shaper.ts` | Add JSON-size-aware top-level array/object truncation, whole-entry selection, `shown`/`total`, and safe collection handling; leave `MAX_DEPTH = 8`, the 20,000 default, string behavior, and the existing 500-item cap intact. |
| `src/shared/ai-vision/resolver.ts` | Extend `ICallResult` with structured truncation metadata and pass the shaper envelope through unchanged. |
| `src/main/mcp/tools/call-tools.ts` | Add the `maxLength` schema minimum/description, mirror `shown`/`total`, and render string versus structured truncation messages correctly. |
| `src/main/mcp/tools/params.ts` | Add the `windowIndex` schema minimum of zero. |
| `src/renderer/api/types/app.d.ts` | Document that `app.call`'s shared `maxLength` also bounds structured results and reports collection counts. |
| `doc/tasks/US-1357-call-parameter-bounds/README.md` | This task document. |

Files deliberately requiring NO changes: `src/renderer/scripting/ai-vision/root.ts:173-175`
(US-1356 owns raw `helpSearch` argument/type validation),
`src/renderer/scripting/api-wrapper/AppWrapper.ts:142-154` (already forwards `maxLength`),
`src/renderer/scripting/ai-vision/call.ts:16-35` (delegates to the shared resolver),
`src/shared/ai-vision/types.ts:81-87` (descriptor summaries are already JSON-able),
`src/main/mcp/register-tools.ts:21-31` (generic registration), all existing
`qa/surfaces/` files (their current size/count assertions are recorded above, but no surface
scenario currently covers `maxLength`), and unit-test/test-harness files (explicitly out of scope).
