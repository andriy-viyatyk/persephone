# US-1371: `PathSyntaxError` bracket-syntax hint

## Goal

When a `call` path uses a member name containing a character that cannot appear in an
identifier, but can appear in a JSON-string bracket key, make the existing `PathSyntaxError`
actionable by including the parser-valid bracket form. The first required case is a hyphenated
segment such as `guides.mcp-setup` -> `guides["mcp-setup"]`.

This is a shared path-parser change for the `call` surface. It must not change guide data,
the About-page work in [EPIC-093](../../epics/EPIC-093.md), or the existing MCP result envelope.

## Background

### Why this task exists

EPIC-092 recorded this as a deliberate deferral. `IDENTIFIER_PART` in
[`src/shared/ai-vision/path-parser.ts`](../../../src/shared/ai-vision/path-parser.ts) is
`/[A-Za-z0-9_$]/`, so the parser consumes `mcp`, stops at `-`, and raises before the `guides`
node can provide a child hint. EPIC-092 worked around the problem by adding parser-valid `call`
fields to every projected guide tree entry. The completed-epic ledger and the last paragraph of
[`doc/epics/EPIC-092.md`](../../epics/EPIC-092.md) both identify the root parser fix as this
separate task under EPIC-093.

The existing guide projection already proves the intended spelling: `projectNode()` in
`src/main/mcp/ai-vision/guides.ts` adds `callPath(path)`, and `callPath()` uses dotted syntax only
when every path segment passes `isIdentifier()`; otherwise it emits a JSON-string index such as
`guides["agents/ui-editors"]`. This task improves the failure message when a caller has not yet
read that projection or has copied the canonical `path` field instead of `call`.

### Exact parser behavior and available information

The parser grammar in `path-parser.ts` is:

- `parsePath()` trims the input once and returns an empty segment list for an empty path.
- A segment starts with `IDENTIFIER_START` (`[A-Za-z_$]`) and continues with
  `IDENTIFIER_PART` (`[A-Za-z0-9_$]`).
- After a member name, `[` is an integer/JSON-string index and `(` is an inline JSON-arguments
  call. A dot is the member separator.
- Bracket indexes accept a JSON integer or JSON string, so a string key is the available escape
  for a member name containing `-`, `/`, whitespace, or `@`.

`PathSyntaxError` currently stores only `offset` and prefixes the supplied message with
`(at offset N)`. The parser itself has more information at the relevant failure boundary:

| Information | Current owner / value | Example for `guides.mcp-setup` |
|---|---|---|
| Whole normalized input | `PathParser.source`, created from `path.trim()` in `parsePath()` | `guides.mcp-setup` |
| Offending position | `PathParser.position` | the index of `-` |
| Offending character | `source[position]` in `PathParser.parse()` | `-` |
| Consumed identifier | `readIdentifier()` return value and the `start` captured by `parseSegment()` | `mcp` |
| Path already parsed | `segments` passed through `parseSegment()`; the current member is appended before the outer parse loop resumes | `guides`, then `mcp` |
| Invalid-start segment boundary | `readIdentifier()` has its local `start` at the first invalid character; the valid prefix is already represented by `segments` | `3d-view` after `guides.` |
| Original caller spelling | `resolveCall()` retains the untrimmed request `path` in the result envelope | useful for reporting, but not needed to create the normalized correction |

The parser does not have the live node, descriptor, or knowledge of whether the caller intended a
hyphenated key. It can synthesize a syntactically valid alternative only; the resolver must still
validate whether that key exists after the caller retries it.

The relevant current construction is:

```ts
// src/shared/ai-vision/path-parser.ts, PathParser.parse()
if (this.source[this.position] !== ".") {
    throw new PathSyntaxError(`Expected "." or end of path, found "${this.source[this.position]}"`, this.position);
}
```

The identifier has already been consumed by `readIdentifier()`, but no bracket alternative is
currently computed. The constructor currently appends `(at offset N)` itself, so the suggestion
must not be appended to the constructor's message argument. The intended narrow change is an
optional third `suggestion` parameter whose text is appended after the offset suffix:

```ts
// Planned shape; preserve the existing message and offset ordering.
constructor(message: string, readonly offset: number, suggestion?: string) {
    super(`${message} (at offset ${offset})${suggestion ? `. ${suggestion}` : ""}`);
    this.name = "PathSyntaxError";
}

if (this.source[this.position] !== ".") {
    const found = this.source[this.position];
    const suggestion = bracketHintForInvalidMember(/* current member + source boundary */);
    throw new PathSyntaxError(
        `Expected "." or end of path, found "${found}"`,
        this.position,
        suggestion,
    );
}
```

For `guides.mcp-setup`, the emitted parser message must be ordered as
`Expected "." or end of path, found "-" (at offset N). If this was intended as one member
name, use guides["mcp-setup"].` (where `N` is the actual zero-based parser position), not
with the offset parenthetical trailing after the actionable sentence. `resolveCall()` then adds
its existing `Invalid path: ` prefix before the MCP adapter emits `Error: `.

The implementation may move the check into `parseSegment()` so it can use that method's local
`start` and `name`, or return equivalent metadata from `parseSegment()`. It must not guess the
current member from a formatted `PathSegment[]` after suffixes have been consumed: a bracket hint
for a method/index operator would be wrong.

### Which characters should receive a hint

Use a deliberately small, data-backed eligibility set for a **conditional** message such as
`If this was intended as one member name, use guides["mcp-setup"].`:

- `-` is mandatory. The committed guide corpus contains hyphenated page keys including
  `mcp-setup`, `getting-started`, `tabs-and-navigation`, `whats-new`, `agent-tools`, `ui-editors`,
  and `ui-push`. It is also permitted by the published-board id validator in
  `src/main/published-boards-service.ts` and appears in the bundled board component id
  `tom-select`.
- `/` is worth supporting. Guide canonical keys use `/` between nested folders and pages, and
  the current guide projection deliberately emits `guides["agents/ui-editors"]` for such keys.
  Registered Agent Tool ids are also formed as `<toolset-name>/<tool-name>` in
  `src/renderer/api/tools/registered-tools.ts`, although those ids are passed to
  `tools.execute()` as arguments rather than used as ordinary path members.
- Internal whitespace and `@` are legal JSON-string key characters. `@` is a forward-looking
  dynamic-name case: toolset/tool manifest validation requires non-empty strings but does not
  restrict their characters, while no committed guide key or current bundled board/tool id in
  this checkout demonstrates `@`. Whitespace is also speculative/forward-looking: the committed
  guide keys and current bundled ids contain no spaces. Board names and secondary-view ids are
  user-authored and are not reduced to identifier syntax (`normalizeSecondaryViews()` rejects
  only empty ids, `::`, and duplicates), so both characters remain eligible for future/runtime
  names without being presented as data-backed current examples.
- `.` must not receive this hint. It is the path member operator, and the parser cannot distinguish
  `foo.bar.baz` (three members) from an author's intended key named `bar.baz`. A dotted expression
  is already syntactically valid, so wrapping the wrong portion in brackets would be actively
  misleading.
- `(`, `[`, `]`, `)`, quotes, and other path-grammar punctuation must remain owned by their
  existing call/index/balancing errors. A malformed operator is not evidence that the caller meant
  a string key.

The message must remain a suggestion, not a successful lookup or a replacement for the syntax
error. For a genuine typo such as `guides.mcp-setupx`, the parser cannot know that the key is
wrong; it should say the bracket form is conditional, and the normal resolver error on retry will
decide whether the member exists. The raw offending character, offset, and `Invalid path:` error
must remain present.

To synthesize the corrected path, identify the current plain member token from its `start` through
the next path dot or end of input, then replace the separator plus that token with a JSON-string
bracket key while retaining any later `.member` suffix. Examples:

| Input | Corrected path to quote in the error |
|---|---|
| `guides.mcp-setup` | `guides["mcp-setup"]` |
| `guides.mcp-setup.layout` | `guides["mcp-setup"].layout` |
| `guides.agents/ui-editors` | `guides["agents/ui-editors"]` |
| `guides.3d-view` | `guides["3d-view"]` |
| `guides.-foo` | `guides["-foo"]` |
| `guides.some tool` | `guides["some tool"]` |
| `guides.some@tool` | `guides["some@tool"]` |

Use `JSON.stringify()` for the bracket key, then insert the complete corrected path as plain
copy-pasteable path text in the suggestion. Do not hand-escape quotes or backslashes. If the source
around the failure contains another operator, or there is no
valid preceding member to bracket (for example an invalid first segment), omit the suggestion and
keep the existing syntax error. A mid-path invalid-start segment such as `guides.3d-view` does
have a valid preceding `guides` member and is therefore eligible.

### How the error reaches an MCP caller

The path is parsed at two process boundaries:

1. `src/main/mcp/tools/call-tools.ts:routeCallPath()` calls `parsePath()` to decide whether the
   request is local (`main`/`guides`), renderer-forwarded, or a window route. A syntax error is
   caught before the first member can be inspected, so the current code forwards the original path
   to the renderer rather than recognizing `guides` as main-owned.
2. The renderer command path is `src/renderer/api/mcp/call-command.ts:handleCall()` ->
   `src/renderer/scripting/ai-vision/call.ts:aiCall()` -> `resolveCall()`.
3. `resolveCall()` catches `PathSyntaxError`, uses its `.message`, and returns an `ICallResult`
   with `error: "Invalid path: ..."` and `resolvedUpTo: ""`. It asks `nodeHint()` for the root
   hint according to the request's `hints` mode. With a renderer available, this is the renderer's
   `AiRoot` hint, not the main-process `GuidesNode` hint; the live check must treat that process/root
   distinction as expected and must not require a guide-specific member list from this malformed
   path. The parser suggestion must be in the error text, not dependent on that hint.
4. `call-tools.ts:toCallResult()` emits the error as a text content block beginning with
   `Error:`, includes the `resolved up to` suffix when present, and sets `isError: true`. A hint is
   emitted separately only when the resolver returned one.

There is a real reliability hole when no renderer is open. `sendToRenderer()` returns a transport
error (`"No renderer window available"`, or an explicit closed/missing-window error), and the
current `call-tools.ts` forwarding branch then sends that transport error to `toToolResult()`;
the parser message never reaches the caller. The planned decision is to preserve the renderer hint
when a renderer exists but retain the parser message as a main-process fallback when forwarding
cannot produce a response: `routeCallPath()` will carry the parsed `PathSyntaxError.message` as a
`parseError`, and the handler will replace a forwarding transport error with an `ICallResult`
`{ path, error: "Invalid path: ..." }`. This keeps the one benefit of forwarding (the existing
renderer-root hint) without making the fix depend on a window. If no renderer is available, no hint
is emitted; the actionable error is still an MCP `isError` result. The fallback is preferred over
always returning `{ error }` from the route catch because it preserves the existing renderer hint
for live sessions, while the no-window case proves why the fallback is necessary.

The error path is not passed through `shapeResult()` or the `maxLength` result truncation branch,
so the corrected path and its actionable explanation must not be truncated. With `hints: "never"`,
the optional `hint` field is omitted; it must not become `null`, while the parser suggestion
remains in the error.

### Other `PathSyntaxError` sites and scope boundary

All current construction sites are in `path-parser.ts`:

- `parse()` reports a non-dot character after a parsed segment and a path ending in `.`.
- `parseSegment()` reports `$help` followed by more input and a call after a call/index has
  already been consumed.
- `readIdentifier()` reports a missing/invalid member start.
- `readIndex()` reports invalid JSON or a non-integer/non-string index.
- `readArguments()` reports invalid comma-separated JSON arguments.
- `readBalanced()` reports mismatched closing punctuation and unterminated `[`/`(`/balanced
  JSON content.

The post-identifier site and the invalid-start branch in `readIdentifier()` can both have the
required facts for a member-key suggestion. For `readIdentifier()`, extend the check only when the
failure is not at the first segment of the whole path, the prefix already contains a valid member,
and scanning to the next dot/end produces a plain token made only of `IDENTIFIER_PART` characters
plus the eligible `-`, `/`, whitespace, and `@` characters. This covers `guides.3d-view` and
`guides.-foo` without treating an invalid first path segment as bracketable. Do not add hints to
the other sites. In particular, `guides..mcp-setup`, `guides[not-json]`, malformed calls, and
unterminated indexes need their current precise syntax diagnostics rather than a speculative key
rewrite.

## Implementation Plan

1. Edit `src/shared/ai-vision/path-parser.ts` for the parser behavior.
   - Add the optional third `suggestion` argument to `PathSyntaxError` and append it after the
     constructor's existing `(at offset N)` suffix. The emitted order is
     `... found "-" (at offset N). If this was intended as one member name, use
     guides["mcp-setup"].`; no other constructor site supplies the third argument.
   - Add a small parser-local helper or equivalent logic that receives the normalized source,
     current member start/name, current position, and the path-segment boundary.
   - Use that helper both after an identifier has stopped at an eligible character and from
     `readIdentifier()` when a mid-path segment starts with an invalid-but-bracketable character.
     Recognize only `-`, `/`, internal whitespace, and `@` in an otherwise plain token; a leading
     digit is covered because it is an `IDENTIFIER_PART` character but not an `IDENTIFIER_START`.
     Exclude path dots and all suffix/balancing punctuation. Do not offer a first-segment bracket
     form that the grammar cannot parse.
   - Build the complete corrected path, including any already-valid prefix and later `.member`
     suffix, with `JSON.stringify()`. Keep the original syntax wording and offset, then append one
     concise conditional instruction with the copy-paste path.
   - Do not alter identifier acceptance, bracket parsing, call parsing, `$help` rules, trimming, or
     any existing non-member-key `PathSyntaxError` behavior.
2. Update `src/main/mcp/tools/call-tools.ts` only for the no-renderer parse-error fallback.
   - Extend the private route result with an optional `parseError` string. In `routeCallPath()`'s
     `parsePath()` catch, retain forwarding and capture the `PathSyntaxError.message` (using the
     existing shared error-message convention for an unexpected error) instead of discarding it.
   - In the forwarding handler, when `parseError` exists and `sendToRenderer()` returns a transport
     error such as no renderer, a missing window, a closed window, or a bridge failure, replace that
     transport response with a result envelope containing `{ path, error: "Invalid path: ..." }`,
     where the ellipsis is the captured parser message. When the renderer returns its normal
     resolver envelope, preserve it and its renderer-root hint.
   - Do not add a hint or `null` fields to the fallback envelope; `toCallResult()` must still emit
     one full `Error:` text block with `isError: true`.
3. Verify the existing propagation through these files:
   - `src/shared/ai-vision/resolver.ts` (`resolveCall()` parse-error branch).
   - `src/main/mcp/tools/call-tools.ts` (`routeCallPath()`, the renderer forwarding branch, and
     `toCallResult()`).
   - `src/renderer/api/mcp/call-command.ts` and
     `src/renderer/scripting/ai-vision/call.ts` (renderer bridge into `resolveCall()`).
   Confirm that the parser message reaches the MCP text block, remains an `isError`, and does not
   rely on a guide-specific hint or a `result` value; with a renderer present, the existing
   renderer-root hint is allowed and expected.
4. Do not modify the guide tree projection, guide assets, board/tool naming validation, the
   `call` schema, `doc/epics/EPIC-093.md`, or `doc/active-work.md`. The existing per-entry `call`
   field remains useful discovery data even after the parser can explain a failed dotted spelling.
5. Verify live through the `persephone` MCP `call` tool. This repository has no unit-test suite or
   test script; the package scripts expose lint/typecheck/build commands, while the standing QA
   method is a call-only live run. Start with a bare `call` (no `path`) so discovery is part of the
   check, then exercise:
   - `guides.mcp-setup` with `hints: "never"`: error text contains the full
     `guides["mcp-setup"]` correction, the found character and offset, has no `hint: null`, and
     is reported as an error rather than a success-shaped no-op.
   - `guides.mcp-setup.layout`: correction preserves the `.layout` suffix.
   - `guides.agents/ui-editors`: correction quotes the complete slash-containing guide key.
   - `guides["mcp-setup"]` and `guides.editors.grid`: both remain valid successful calls.
   - `guides.3d-view` and `guides.-foo`: both receive the same conditional correction form as
     `guides.mcp-setup` because they have the valid `guides` prefix and a bracketable token.
   - `guides..mcp-setup` still raises `Expected a member name` at the empty segment and receives no
     speculative bracket hint; a malformed index such as `guides[not-json]` retains its existing
     index diagnostic as well.
   - Repeat the malformed path with a renderer window available and record that any separate hint
     is the renderer root hint, not a `GuidesNode` hint. Repeat it in a dedicated no-renderer
     instance (confirmed through `windows`) and require the same `Invalid path: ...` message rather
     than `No renderer window available`.
   - Repeat a malformed call with a very small `maxLength`: the error and corrected path remain
     complete, with no `[truncated ...]` marker, because error text is outside result shaping.
6. Record any live discrepancy before implementation is considered complete. A parser-plus-router
   change should not require a new QA surface file; if a run is recorded, it must follow
   [`qa/README.md`](../../../qa/README.md)'s call-only procedure and must not modify pinned or
   pre-existing pages.

## Concerns

- **Suggestion versus certainty:** the parser cannot inspect descriptors. The bracket form is a
  syntax repair, not proof that the key exists. The wording must be explicitly conditional and the
  original error must remain visible.
- **Offset ordering:** `PathSyntaxError` owns the offset suffix. The implementation must pass the
  suggestion separately so the emitted message ends the offset parenthetical before beginning the
  actionable sentence.
- **Dot ambiguity:** a dot is a valid path operator, so embedded-dot names cannot be recovered at
  this failure site without guessing. They are intentionally excluded from the hint scope.
- **Operator ambiguity:** a path with `(` or `[` near the failure may be an attempted method/index
  expression, not a key. Those cases keep their existing errors.
- **Dynamic ids:** current committed guide keys demonstrate `-` and `/`; the current tool manifest
  validator allows any non-blank toolset/tool names, and board names/views are user-authored. The
  hint supports their key characters syntactically, but it does not change where those ids are
  passed (tool/board methods still take them as arguments). Whitespace and `@` remain speculative
  future/runtime cases, not claims about current committed identifiers.
- **Main/renderer routing:** with a renderer, malformed paths currently go through the renderer
  and may carry its root hint; with no renderer, the transport error currently hides the parser
  error. The planned `parseError` fallback preserves the first behavior and repairs the second,
  without pretending that the renderer's root hint is a main-process guide hint.
- **Shared-parser blast radius:** `parsePath()` is also used by `help-search.ts` to follow declared
  child segments. The new text should only be observable when a caller receives a syntax error;
  `help-search.ts` catches malformed child segments and skips them, so it must not be broadened.
- **No truncation or absent-key regression:** the message belongs in `error`, not a new optional
  result property. This preserves the existing omission convention for absent `hint`, `result`,
  and other fields and keeps the full actionable message independent of `maxLength`.

All design questions are resolved above: the supported character set is `-`, `/`, whitespace, and
`@` (with whitespace and `@` explicitly speculative); the post-identifier and eligible mid-path
invalid-start sites change; `.` and syntax operators are excluded; parse errors retain a renderer
hint when possible but fall back in main when no renderer can answer; and live MCP `call`
verification replaces unit tests.

## Acceptance Criteria

- [ ] `guides.mcp-setup` reaches the MCP caller as an `isError` response whose emitted error text
      is ordered as `Error: Invalid path: Expected "." or end of path, found "-" (at offset N).
      If this was intended as one member name, use guides["mcp-setup"].` (with `N` equal to
      the actual parser offset); the suggestion does not appear before the offset suffix.
- [ ] A hyphenated member followed by a valid suffix quotes the complete corrected path, for
      example `guides.mcp-setup.layout` -> `guides["mcp-setup"].layout`.
- [ ] A slash-containing plain segment can receive the universal bracket form, for example
      `guides.agents/ui-editors` -> `guides["agents/ui-editors"]`.
- [ ] Mid-path invalid-start segments receive the same correction when eligible, including
      `guides.3d-view` -> `guides["3d-view"]` and `guides.-foo` -> `guides["-foo"]`; an invalid
      first segment remains without a bracket suggestion because the grammar has no root index.
- [ ] Eligible spaces and `@` characters receive the same conditional bracket guidance when they
      occur in an otherwise plain member token; these are explicitly speculative/forward-looking,
      and the message never claims that the key exists.
- [ ] `guides..mcp-setup` retains the empty-segment `Expected a member name` diagnostic without a
      speculative bracket hint. Other invalid JSON indexes/arguments and unbalanced delimiters
      retain their existing parser-specific errors as well.
- [ ] The corrected path is generated with JSON escaping, preserves the valid prefix and suffix,
      and is omitted when no parser-valid bracket correction can be synthesized.
- [ ] Existing valid dotted paths and existing valid bracket paths continue to resolve unchanged;
      the guide tree's `path`/`call` projection is unchanged.
- [ ] With `hints: "never"`, the syntax correction remains in the error while the optional hint is
      absent rather than `null`; with a renderer available and normal hints, the renderer-root hint
      remains available as before; with no renderer, the parser fallback has no hint field.
- [ ] Error text is not truncated by `maxLength`, and the response does not become a silent
      success, empty result, or success-shaped no-op.
- [ ] With no renderer window open, a malformed path still reaches the MCP caller as the same
      `Invalid path: ...` `isError`, not as `No renderer window available`.
- [ ] Live verification is performed through the `persephone` MCP `call` tool, beginning with a
      bare discovery call; no unit tests or test harness are added.
- [ ] No dashboard entry is added, no EPIC-093 document is edited, and no implementation is made
      outside the scoped parser and parse-error routing changes until the task is approved for
      implementation.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1371-path-syntax-bracket-hint/README.md` | This verified implementation plan; created for US-1371. |
| `src/shared/ai-vision/path-parser.ts` | Add the post-offset conditional bracket-syntax suggestion for eligible post-identifier and mid-path invalid-start tokens; preserve all other parser behavior. |
| `src/main/mcp/tools/call-tools.ts` | Preserve the existing renderer-root hint when forwarding succeeds, but return the parser's `Invalid path` error when no renderer response is available. |

Files that need **no changes** for this task:

- `src/shared/ai-vision/resolver.ts`
- `src/renderer/api/mcp/call-command.ts`
- `src/renderer/scripting/ai-vision/call.ts`
- `src/main/mcp/ai-vision/guides.ts`
- `assets/guides/**`
- `doc/epics/EPIC-092.md`
- `doc/epics/EPIC-093.md`
- `doc/active-work.md`
- `qa/` and unit-test files (none are added; verification is live through MCP `call`)
