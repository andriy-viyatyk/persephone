# US-1355: Hint economics — honour `hints` and dedupe on the error path

**Status:** Implemented (unreviewed — epic close runs the completion skills)

Epic: [EPIC-091](../../epics/EPIC-091.md), report items 1.2 and 3.8.

## Goal

Make `call` errors obey the documented `hints` mode and the existing per-session `SeenKinds`
dedupe, while preserving the first unknown-member response as a self-correcting valid-member
list. Near typos should receive a one-line correction; repeated non-matching errors should point
to `$help` instead of repeating a large member dump. The error and its `resolved up to` context
remain visible in every mode (`src/main/mcp/tools/call-tools.ts:249-252`).

## Background

The MCP schema already documents `auto`, `always`, and `never` (`src/main/mcp/tools/call-tools.ts:124-130`).
The ordinary resolver error path is already correctly gated: `nodeHint` returns no hint for
`never`, includes members for `always` or an unseen kind, and records the kind in `seenKinds`
(`src/shared/ai-vision/resolver.ts:190-196`). The defect is the `forceMembers` branch in
`errorAt`, which formats members and children inline without consulting either rule
(`src/shared/ai-vision/resolver.ts:199-218`). It is used for unknown members, non-writable
properties, and calling a property as a method (`src/shared/ai-vision/resolver.ts:102-109,
137-140`).

`SeenKinds` is a set of descriptor kind names (`src/shared/ai-vision/resolver.ts:50-51`). It is
owned for the MCP session by `callTools`, copied into forwarded renderer requests, and updated
from a returned hint kind (`src/main/mcp/tools/call-tools.ts:95-98,150-152,175-188`). The renderer
reconstructs that set before resolving (`src/renderer/api/mcp/call-command.ts:9-18`), then delegates
to the shared resolver (`src/renderer/scripting/ai-vision/call.ts:16-35`). A suggestion must not
mark a kind as seen when no member list was sent; the existing round trip must continue to add a
kind only when a response actually contains `hint.kind` (`src/main/mcp/tools/call-tools.ts:186-187`).

The current hint builder already owns the reusable formatting pieces: live children at
`formatChildren`, member names at `formatMembers`, the normal hint at `buildHint`, and full help at
`buildHelp` (`src/shared/ai-vision/hint.ts:15-22,33-36,42-60,63-73`). The root descriptor confirms
that `pages` is a real member of the `Persephone` node (`src/renderer/scripting/ai-vision/root.ts:38-56,195-204`),
so `pagez` must be able to suggest `pages`.

The authority for the behaviour is EPIC-091 decision 3 (`doc/epics/EPIC-091.md:167-191`):

1. A case-insensitive exact match, or a uniquely best Levenshtein distance-1/2 match subject to the
   length gate below, replaces the member dump with the one-line correction under `auto` and
   `never`; under `always`, the correction is appended to the error and the explicitly requested
   member-list hint is still emitted.
2. Without a near match, the first error for a kind retains the member list; a repeat has only a
   one-line kind summary and `Details: call with path "<kind>.$help"`.
3. `hints: "never"` suppresses every hint block, including forced-member errors.
4. Error text is never suppressed.

This preserves report section 4's unknown-member teaching behaviour and its deliberately hint-free
`args`/`value` error (`doc/epics/EPIC-091-evaluation-report.md:195-202`). The mutual-exclusion return
is an early result with no `hint` and must remain so (`src/shared/ai-vision/resolver.ts:63-68`).

### Investigation finding: malformed paths are a fourth hint leak

The malformed-path catch currently calls `nodeHint("", root, seenKinds, "always")` before the
request's `hintMode` is calculated (`src/shared/ai-vision/resolver.ts:53-64`). This bypasses both
the caller's `hints: "never"` preference and the normal auto dedupe, and accounts for the report's
`pages..logView` and `pages[0` dumps among the six repeated error dumps
(`doc/epics/EPIC-091-evaluation-report.md:49-61`). This is a finding for epic-close visibility; the
implementation plan below corrects it as part of the same resolver-level hint-economics fix.

### Existing QA scenarios that assert error or error-hint content

These scenarios must be treated as the regression surface while implementing the resolver change:

- `qa/surfaces/shell.md:66-77`, Test S.5, explicitly expects an unknown `ui` element to return a
  self-correcting error listing every valid element name. This is the clearest generic unknown
  member/error-hint assertion.
- `qa/surfaces/dialogs.md:73-91`, Test D.4, asserts that invalid dialog members are rejected and
  that `$help` exposes only the safe dialog members. It exercises the forced-member path and must
  not gain access to the password value.
- `qa/surfaces/windows.md:71-88`, Tests W.5-W.6, assert actionable closed-window errors and the
  `resolved up to` result for an invalid index. The error text and path context must remain even
  when hints are deduped or disabled.
- `qa/surfaces/tools.md:46-58`, Test T.3, asserts that an invalid tool target throws with its
  requested id and valid ids. That list is method-generated error text, not a resolver hint, so it
  must not be replaced by this task.
- `qa/surfaces/shell.md:130-151` (S.10) and `qa/surfaces/shell.md:288-295` (S.18) assert
  self-correcting lists for invalid folder ids and setting keys. They are likewise explicit error
  content, not the generic member-hint block, and must continue to work.

`qa/surfaces/dialogs.md:60-71` (D.3) also checks that attention survives `hints: "never"`; attention
is a separate `ICallResult` field and must not be confused with, or gated by, this task's hint
handling (`src/shared/ai-vision/resolver.ts:35-45`).

### `errorAt` before → after

The current implementation always constructs a full forced hint and only the non-forced branch
reaches `nodeHint` (`src/shared/ai-vision/resolver.ts:199-218`):

```ts
// Before — current resolver.ts:199-218
function errorAt(
    path: string,
    walked: readonly PathSegment[],
    node: unknown,
    seenKinds: SeenKinds,
    mode: HintMode,
    message: string,
    forceMembers = false,
): ICallResult {
    const resolvedUpTo = formatPath(walked);
    const descriptor = getAiVision(node);
    let hint: IHint | undefined;
    if (descriptor && forceMembers) {
        const parts = [`${descriptor.kind} — ${descriptor.summary}`, formatMembers(descriptor.members), formatChildren(resolvedUpTo, descriptor.children?.() ?? [])].filter(Boolean);
        hint = { kind: descriptor.kind, text: parts.join("\n") };
    } else {
        hint = nodeHint(resolvedUpTo, node, seenKinds, mode);
    }
    return { path, error: message, resolvedUpTo, ...(hint ? { hint } : {}) };
}
```

The planned shape makes the error context explicit, gives unknown members a name for matching, and
routes only genuine member-list cases through a gated error-hint builder. The ordering and returned
fields are fixed by this plan (`src/shared/ai-vision/resolver.ts:35-47`):

```ts
// After — planned resolver.ts shape
type ErrorAtOptions = {
    forceMembers?: boolean;
    unknownMember?: string;
};

function errorAt(
    path: string,
    walked: readonly PathSegment[],
    node: unknown,
    seenKinds: SeenKinds,
    mode: HintMode,
    message: string,
    options: ErrorAtOptions = {},
): ICallResult {
    const resolvedUpTo = formatPath(walked);
    const descriptor = getAiVision(node);
    const suggestion = descriptor && options.unknownMember
        ? findMemberSuggestion(options.unknownMember, descriptor.members)
        : undefined;
    const error = suggestion ? `${message} Did you mean ${JSON.stringify(suggestion)}?` : message;
    if (suggestion && mode !== "always") {
        return { path, error, resolvedUpTo };
    }
    const hint = options.forceMembers
        ? errorNodeHint(resolvedUpTo, node, seenKinds, mode)
        : nodeHint(resolvedUpTo, node, seenKinds, mode);
    return { path, error, resolvedUpTo, ...(hint ? { hint } : {}) };
}
```

`errorNodeHint` must return `undefined` for `never`, use the same `seenKinds` decision as
`nodeHint`, call the existing full formatter for the first/`always` member-list response, and use
only the summary plus the concrete `$help` Details line for an already-seen kind. The unknown-member
call passes `{ forceMembers: true, unknownMember: name }`; the non-writable and property-call sites
pass `{ forceMembers: true }` (`src/shared/ai-vision/resolver.ts:102-109,137-140`).

## Implementation Plan

### 1. Add one shared member-name matcher

- Add `src/shared/ai-vision/member-suggestion.ts`.
- Export a small function accepting the rejected member name and
  `readonly IAiMember[]`, returning a member name or `undefined`.
- Match only against the `members` array of the descriptor at the node where resolution stopped,
  never against the root or live object properties. Thus `page.contnet` is compared with the
  `Page` descriptor's `PAGE_MEMBERS`, where `content` is a property member and not a live child
  (`src/renderer/scripting/api-wrapper/PageWrapper.ts:118-133`; live children are separately
  represented by `IAiVisionDescriptor.children`, `src/shared/ai-vision/types.ts:36-39`).
- Give a case-insensitive exact match priority (`Pages` → `pages`). Otherwise calculate ordinary
  Levenshtein distance over `IAiMember.name` values. Distance 1 is acceptable for any rejected
  name; distance 2 is acceptable only when the rejected name is at least 5 characters long. This
  length gate prevents confidently wrong short-name guesses such as the root's `ui`/`fs` pair and
  similar short members (`src/renderer/scripting/ai-vision/root.ts:38-56`). If two or more members
  share the best accepted distance, return no suggestion and fall through to the gated member-list
  path; declaration order is not a safe tie-breaker. `IAiMember.name` and the distinction between
  member metadata and live children are defined in `src/shared/ai-vision/types.ts:17-39`.
- Keep this logic process-neutral in `src/shared/ai-vision/`; both the renderer and main process
  use the same resolver (`src/shared/ai-vision/resolver.ts:8-12`). Do not add a renderer-only or
  MCP-only copy.

### 2. Give forced errors the same gate and session accounting

- In `src/shared/ai-vision/hint.ts`, add a small error-specific builder beside `buildHint` that
  reuses the existing descriptor summary and, on the first emission, the existing member/child
  formatting. When members have already been emitted for the kind, produce only the one-line kind
  summary and the path-specific Details line. Preserve the existing `$help` target convention in
  `buildHint` (`src/shared/ai-vision/hint.ts:42-59`): use `<resolved-node-path>.$help`, or `$help`
  at the root. This is the concrete form of decision 3's `"<kind>.$help"` instruction.
- In `src/shared/ai-vision/resolver.ts`, route the forced-member cases through the same
  `mode === "never"` check and `seenKinds` update used by `nodeHint` (`resolver.ts:190-196`).
  The first `auto` error therefore retains the valid member list, `always` repeats it, and a
  repeated `auto` error gets only the summary plus Details.
- Replace the boolean-only meaning of `forceMembers` with an explicit error context/options shape
  so the unknown-member name can be distinguished from the other two forced cases. Keep forced
  member-list behaviour for non-writable properties and `()` on properties; they need the valid
  member list but are not misspelled member-name lookups.
- Move `hintMode` calculation before path parsing and use it for the malformed-path return as
  well (`src/shared/ai-vision/resolver.ts:53-64`). The current parse-error branch hard-codes
  `"always"` at line 60, which conflicts with the requirement that `hints: "never"` be absolute;
  the default mode must also use the same session dedupe.

### 3. Add the near-match precedence to unknown-member errors only

- At the unknown-member call site (`src/shared/ai-vision/resolver.ts:102-105`), pass the rejected
  name into `errorAt` together with its forced-member context.
- In `errorAt`, run the shared matcher before building any hint. If it returns a candidate, append
  the suggestion to the error string. For `auto` and `never`, return no hint block. For `always`,
  keep the appended suggestion and continue through the ordinary forced-member hint path, so the
  requested member list is still emitted and `seenKinds` reflects the list actually sent. For
  `pagez` at the root, the exact error line is:

  ```text
  "pagez" is not a member of Persephone. Did you mean "pages"?
  ```

  Put this sentence in `error`, rather than `IHint.text`, so it remains actionable under
  `hints: "never"`; the existing MCP formatter always emits `Error: ...` and its resolved-path
  suffix (`src/main/mcp/tools/call-tools.ts:249-252`). A suggestion response must not add the kind
  to `seenKinds` when it has no hint; the `always` case does add it through the returned hint because
  a member list was sent.
- For the nested example, preserve the existing unknown-member prefix and append only the matcher
  result: `"contnet" is not a member of Page. Did you mean "content"?`
  (`src/shared/ai-vision/resolver.ts:102-105`; `src/renderer/scripting/api-wrapper/PageWrapper.ts:118-125`).
- Apply the matcher only to the unknown-member branch. A non-writable property and a property
  called with `()` are valid names with a different mistake; suggesting another name there would
  obscure the actual correction. Those branches continue through the gated/deduped member-list
  path (`src/shared/ai-vision/resolver.ts:107-110,134-140`).

### 4. Preserve the resolver error envelope

- Keep `resolvedUpTo` on every `errorAt` result (`src/shared/ai-vision/resolver.ts:208-218`) and
  leave its rendering as part of the error content, not the hint content
  (`src/main/mcp/tools/call-tools.ts:249-252`).
- Leave the `args`/`value` mutual-exclusion early return without a hint
  (`src/shared/ai-vision/resolver.ts:65-68`). Do not route it through `errorAt` merely to make
  error handling look uniform.
- Do not change custom method errors that enumerate valid values, including the QA cases listed
  above. This task changes generic resolver hint economics, not method validation messages.

### 5. Verify the session round trip and existing QA contract

Use the existing `call` surface and scenarios; do not add unit tests, test harnesses, or new QA
files. Verify at minimum:

- First unknown member with default `auto` returns the valid member list once; a second unrelated
  unknown member at the same descriptor kind returns only the summary and `Details` path.
- `pagez`, case-only `Pages`, and `page.contnet` each receive one-line suggestions; under `auto`
  and `never` the suggestion replaces the dump and does not consume the member-list dedupe slot,
  while `always` includes the same suggestion alongside the requested member-list hint.
- `hints: "always"` repeats a no-near-match member list, while `hints: "never"` returns the error
  and `resolved up to` text but no `hint` block for unknown-member, non-writable, property-call,
  and malformed-path errors.
- A renderer-forwarded call still receives the main session's prior `seenKinds`; a suggestion
  with no hint does not corrupt it, and a subsequent ordinary hint re-adds its kind through the
  existing response path (`src/main/mcp/tools/call-tools.ts:150-152,175-187`).
- Re-run the existing S.5, D.4, W.5-W.6, T.3, S.10, and S.18 scenarios cited above, plus the
  report section 4 preserve checks. If unknown-member recovery no longer teaches the caller what
  is valid, follow EPIC-091's abort criterion and ship only the `hints: "never"` correction
  (`doc/epics/EPIC-091.md:354-360`).

## Concerns

- The central tradeoff is resolved by EPIC-091 decision 3: the first no-near-match unknown-member
  error must still teach the valid member list. Dedupe is allowed only after that list has actually
  been emitted (`doc/epics/EPIC-091.md:167-191`).
- A case-insensitive exact match is intentionally checked before edit distance so `Pages` has the
  unambiguous `pages` correction. Near-match suggestions are limited to unknown-member errors;
  non-writable and property-call errors retain their domain-specific wording.
- A suggestion is error text, not a hint. This is what makes `hints: "never"` absolute while
  retaining an actionable one-line error; it also means the suggestion must not alter
  `SeenKinds`.
- No change is planned to the public `call` schema, the main/renderer forwarding protocol, or the
  attention path. The schema and forwarding already carry `hints`, `seenKinds`, and attention
  independently (`src/main/mcp/tools/call-tools.ts:124-152,162-187`).

## Acceptance Criteria

- `hints: "never"` produces no `hint` content for all three forced-member sites and malformed-path
  errors, while the error and `resolved up to` text remain present.
- Under default `auto`, a member list is emitted at most once per descriptor kind per MCP session,
  including when the first encounter is an unknown-member, non-writable, or property-call error.
- A repeated no-near-match forced error contains only the kind summary and a concrete `$help` Details
  path; it does not repeat `members:`.
- `hints: "always"` retains the member list for every forced error, including one with a near-match
  suggestion.
- Distance 1 is accepted at every name length; distance 2 is accepted only for rejected names of
  length 5 or more, and any tie for the best accepted distance produces no suggestion and falls
  through to the member-list path (`src/renderer/scripting/ai-vision/root.ts:38-56`).
- `pagez` → `pages`, `Pages` → `pages`, and `page.contnet` → `page.content` produce the specified
  one-line `Did you mean` error. For the nested case the unchanged resolver prefix is
  `"contnet" is not a member of Page.`, followed by `Did you mean "content"?`; `content` comes
  from the resolved `Page` descriptor's property members, not from a live child
  (`src/renderer/scripting/api-wrapper/PageWrapper.ts:118-125`). The matcher is used only by
  unknown-member errors.
- The first unknown-member error with no near match still includes the complete valid member list,
  preserving report section 4 and the epic abort criterion (`doc/epics/EPIC-091-evaluation-report.md:195-202`).
- The `args`/`value` mutual-exclusion error remains hint-free
  (`src/shared/ai-vision/resolver.ts:65-68`).
- Main/renderer `SeenKinds` round trips remain coherent, and all cited QA scenarios retain their
  required error text, valid-value lists, path context, dialog privacy, and attention behaviour.

## Files Changed Summary

| Path | Planned change |
|---|---|
| `src/shared/ai-vision/member-suggestion.ts` | New process-neutral Levenshtein/case-insensitive member-name matcher. |
| `src/shared/ai-vision/hint.ts` | Error-hint builder for first-list versus repeat-summary rendering, reusing existing formatters. |
| `src/shared/ai-vision/resolver.ts` | Gate/dedupe forced errors, add unknown-member suggestion context, honor `never` for malformed paths, preserve error envelope. |
| `doc/tasks/US-1355-error-hint-economics/README.md` | This implementation plan. |

Files deliberately requiring **no changes**: `src/main/mcp/tools/call-tools.ts`,
`src/renderer/api/mcp/call-command.ts`, `src/renderer/scripting/ai-vision/call.ts`,
`src/shared/ai-vision/types.ts`, `src/shared/ai-vision/path-parser.ts`, and all files under
`qa/surfaces/`. Their existing session transport, descriptor contracts, path grammar, error
formatting, and QA expectations are the interfaces this task must preserve
(`src/main/mcp/tools/call-tools.ts:95-98,150-188,239-252`; `src/renderer/api/mcp/call-command.ts:9-19`).

## Live-verification correction (2026-09-07)

The first implementation returned **no** suggestion for `pagez` — the report's flagship example —
because the reviewed plan's "a tie means no suggestion" rule fired: `pagez` is Levenshtein distance
1 from both `pages` (substitute) and `page` (delete). The rule was right about the risk (a
confidently wrong single suggestion is worse than the member list it replaces) and wrong about the
remedy, because suppressing the suggestion sent the full ~2,400-token dump for the single most
likely typo on the whole surface.

`findMemberSuggestion` was therefore replaced by `findMemberSuggestions`, which returns **every**
equally-good candidate (at most three) ranked by distance, then the smaller absolute length
difference — a substitution is a likelier typo than a deletion, which is what puts `pages` ahead of
`page` — then declaration order. `formatSuggestions` renders them as one readable line. Two names
on one line are still strictly cheaper and more actionable than the member list, and never wrong.

Verified live: `pagez` → `Did you mean "pages" or "page"?`; `Pages` → `Did you mean "pages"?`; a
first unknown member of a kind still returns the complete member list; a second returns the kind
summary plus `Details: call with path "pages.$help"`.
