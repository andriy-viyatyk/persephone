# US-2125: Test host value fidelity and call options

Epic: [EPIC-199](../../epics/EPIC-199.md) (planned).

## Goal

Make the UI test host preserve the value type produced by the MCP `call` tool and give tests
consistent call options, polling, page identity, and assertion helpers. Document the call boundary
in one guide section without changing the agent-facing text body.

## Background

`src/test-host/client.ts` currently decodes the first text block in `McpClient.decode()` and, unless
`callText()` was requested, runs `JSON.parse(body)` with a raw-string fallback. Since
`src/main/mcp/tools/call-tools.ts` serializes non-string results but emits string results unchanged
at `toCallResult()`, JSON-looking strings such as `"true"`, `"42"`, and JSON file text lose their
string type in `ctx.call()` and the awaitable stand-in.

Use the MCP result's `_meta` for the out-of-band type, never `structuredContent`: some MCP clients
surface structured content instead of text to the model, and a value envelope would quote string
bodies and duplicate large results. Define the single key
`PERSEPHONE_CALL_RESULT_TYPE_META_KEY = "persephone/resultType"` in a shared constant module
`src/shared/mcp-result-type.ts`, imported by the TypeScript producer and consumer. The independent
`.mjs` adapter mirrors the literal with a comment naming that owner. Persephone's
`registerTools()` passes its `run(args)` result directly to the SDK tool handler; the SDK server
handler returns that result unchanged (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:150-183`).
The SDK `CallToolResultSchema` retains top-level `_meta` (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:100-104,1289-1317`),
and `Client.callTool()` returns the parsed result (`node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js:479-509`);
the declared client result also includes `_meta` (`node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts:500-520`).
The metadata therefore reaches `McpClient` without changing primary text. The integration suite's
separate adapter in `integration-test/lib/client.mjs` also parses text today and must use the same
metadata rule. The raw `call` content assertions in `integration-test/tests/core/mcp/mcp.test.mjs`
stay unchanged, with one added check that a string result's raw body is unquoted and equals the
string returned by `ctx.call()`.

`TestContext` in `src/test-host/context.ts` already gives `ctx.call()` / `ctx.callText()` the options
`timeout`, `maxLength`, and `dialog`, but `waitFor()` accepts only `timeout` and its path branch
calls without options. The `createAppProxy()` callback in `src/test-host/app-proxy.ts` carries only
`path` and `args`, so stand-in reads and calls cannot forward options. The proxy already constructs
a path stand-in and resolves it again on each `await` or method invocation.

`openBrowser()` in `src/test-host/browser-helpers.ts` creates a page, keeps its id in a local
`created` record, and currently returns only `context.handle(page.editor)`. `ctx.expect()` in
`context.ts` currently implements `toBe`, `toEqual`, `toContain`, and `toBeTruthy`. Method-path
calls with omitted `args` are sent without the field by `McpClient.rawCall()`; the `ai-vision`
resolver then describes the method instead of invoking it (its README specifies that methods need
`args: []`).

Existing test workarounds verified in source and feedback include JSON-string booleans converted
with `String(value)`, numeric DOM strings converted with `Number(...)`, and direct exact-string reads
through `ctx.callText()`. Those casts need to be corrected only where the expected contract is a
string; genuine booleans/numbers and `undefined`-to-`null` JSON behavior remain as they are.

## Implementation Plan

- [x] **Preserve values across MCP.** In `src/main/mcp/tools/call-tools.ts`, make `toCallResult()`
  attach only `_meta: { [PERSEPHONE_CALL_RESULT_TYPE_META_KEY]: "string" | "json" }` to successful
  call results, using the shared constant from `src/shared/mcp-result-type.ts`. A string result is
  tagged `"string"`; all other JSON results, including normalized top-level `undefined` (`null`),
  are tagged `"json"`. Keep the primary text block byte-for-byte and do not add `structuredContent`.
  The `IMcpToolResult` type in `src/main/mcp/types.ts` owns the optional metadata field shape;
  `call-tools.ts`'s `toCallResult()` owns its type value and reuses the already-resolved `rest.result`
  rather than reparsing display text. In `src/test-host/client.ts`, include `_meta` in the raw MCP
  result type and decode after current pending/attention/truncation checks: `"string"` returns the
  primary text body as-is, `"json"` uses `JSON.parse(body)`, and an absent key (older app/build)
  keeps today's parse-with-fallback behavior. `callText()` always returns the text body. The
  `integration-test/lib/client.mjs` adapter follows the same rule and mirrors the key literal with
  a comment naming `src/shared/mcp-result-type.ts` as its owner. Preserve current image results,
  pending results, errors, and truncated array reads. A truncated string result still carries
  `"string"`, returns the truncated primary body raw, and remains subject to the existing
  maxLength/truncation guard before decoding. No protocol code or custom envelope is introduced.

  Before:

  ```ts
  return JSON.parse(body);
  ```

  After:

  ```ts
  if (resultType === "string") return body;
  if (resultType === "json") return JSON.parse(body);
  try { return JSON.parse(body); } catch { return body; } // legacy result without the key
  ```

  `call()` returns string `"true"`; a real boolean result remains boolean `true`; `callText()` and
  the agent-facing primary text still return the unchanged text.

- [x] **Expose call options through the stand-in and polling.** Make
  `src/test-host/app-proxy.ts`'s `Call` callback and `createAppProxy()` / `asHandle()` carry an
  optional `CallOptions` object (`timeout`, `maxLength`, `dialog`) alongside the call path and
  arguments. Add one explicit options wrapper on the stand-in (for example,
  `ctx.app.withOptions({ maxLength, dialog }).some.path`); its descendants retain those options, and
  a read or invocation applies them to that single MCP request. The stand-in remains a path, so
  each read after editor switching resolves through `ctx.call()` again. In
  `src/test-host/context.ts`, define/reuse the call-options type and pass it through the existing
  `call()` implementation, which already forwards `maxLength` and `dialog` to `McpClient.call()`.
  Extend `waitFor(pathOrCallback, predicate, options)` to accept `{ timeout?, maxLength?, dialog? }`;
  use `timeout` for the polling deadline and forward `maxLength` / `dialog` for each path poll.
  Callback polling continues to call the callback as supplied.

  Before: `ctx.waitFor("dialogs[0].title", predicate)` polls an ordinary call and fails on
  attention; a stand-in read with a large result cannot supply `maxLength`.
  After: `ctx.waitFor("dialogs[0].title", predicate, { dialog: true })` polls with attention
  allowed, and `ctx.app.withOptions({ maxLength: 1000000 }).themes.list()` sends that maximum.

- [x] **Reject omitted method argument arrays.** In `src/test-host/context.ts`, have `ctx.call()`
  inspect the typed result only when `args === undefined`; reject the resolver's method descriptor
  shape, verified in `node_modules/ai-vision/dist/core/resolver.js:124`:
  `{ kind: "method", signature: string, summary, note: 'Call it as "<path>()" (or pass "args").' }`.
  Key the check on this resolver marker (including its method-specific note/signature shape), not
  `kind` alone, so an ordinary property object with a `kind` field remains readable. Throw a
  `TypeError` naming the requested path and instructing the caller to pass `[]`. Do not reject a
  property read or no-path overview. Reuse the returned descriptor from `McpClient.call()`; do not
  add code to `node_modules/ai-vision` or change agent-facing text.

  Before: `ctx.call("ui.alerts.list")` returns the method descriptor.
  After: it throws a targeted message to use `ctx.call("ui.alerts.list", [])`.

- [x] **Return the opened page id without breaking the editor stand-in.** In
  `src/test-host/browser-helpers.ts`, preserve the current returned `pages[id].editor` stand-in and
  expose `created.id` on that returned handle as local `pageId` metadata; `pageId` is reserved as a
  local property only on handles returned by `openBrowser()`, and is never sent as a call-tree path.
  Grep of `src/renderer/scripting` and `src/renderer/editors/browser` found no browser editor
  describe member named `pageId`. Keep the rest of the path behavior and per-test cleanup unchanged.
  Implement metadata support in the existing stand-in owner `src/test-host/app-proxy.ts`, not in a
  wrapper that changes call resolution.

  Before: `const page = await ctx.openBrowser(url)` has editor operations but no page id.
  After: the existing `page` editor handle still supports its methods and `page.pageId` gives the
  `pages.all` id used for page-specific paths.

- [x] **Add the missing assertion methods.** In `src/test-host/context.ts`, extend the
  `TestContext.expect()` return type and implementation with `toBeGreaterThan(expected: number)`,
  `toBeLessThanOrEqual(expected: number)`, and `toMatch(expected: RegExp)`. Use Node's existing
  `node:assert/strict` import and follow `check()` so failures are attributed to the assertion step.

- [x] **Audit and fix string-type assumptions in integration tests.** Update only the existing
  workarounds whose source values are strings:

  | File | Verified current code | Planned correction |
  |------|-----------------------|--------------------|
  | `integration-test/tests/browser/tabs/tabs.test.mjs` | `toolbar-page-zoom` reads `aria-expanded`; its wait currently uses `String(value) === "false"`. | Compare `value === "false"` directly. |
  | `integration-test/tests/browser/site-extensions/saved-site-extensions.test.mjs` | The `aria-checked` string is converted with `String(checked) === "false"`. | Compare `checked === "false"` directly. |
  | `integration-test/tests/tools/settings-page/settings-page.test.mjs` | The checkbox's `data-checked` string is compared after `String()` conversion; `original` is a boolean setting value. | Wait for the exact DOM string `String(original)` and assert the exact expected DOM string, without converting the returned value. |
  | `integration-test/tests/browser/navigation/navigation.test.mjs` | `#load-count` text is converted with `Number()` at initial load, after reload, and during the still-loading reload case. | Assert the exact strings `"1"` / `"2"` from the DOM. |

  Preserve the existing `ctx.callText()` usage in `integration-test/tests/boards/lifecycle/lifecycle.test.mjs`,
  `integration-test/tests/core/files/files.test.mjs`, and other exact-text tests: it remains the API for
  agent-facing raw text. Keep actual object/boolean results such as the object returned by the
  lifecycle bridge fixture and boolean predicates as typed values. Review any other `ctx.call()` /
  stand-in string-result casts during implementation; do not weaken assertions.

  Opposite-coercion audit: searched `integration-test/tests/**` and
  `integration-test/tests/helpers/**` for `ctx.call` / `ctx.app` reads of `fs.read`, page `.content`,
  and `evaluate`; for `JSON.parse`, `JSON.stringify`, `Number`, and `String` around those reads; and
  for parsed `.length` / property assertions. The additional test that relies on a JSON-looking
  string being guessed into an object is `integration-test/tests/editors/log-view/log-view.test.mjs`:
  its grid output case reads `pages[id].content`, then stringifies the value before checking for
  `"Ada"`. Change that to treat the page content as a string directly and check that string for
  `"Ada"`; keep the fixture text unchanged. File-text and page-content reads in
  `integration-test/tests/core/files/files.test.mjs`, `integration-test/tests/tools/guides/guides.test.mjs`,
  `integration-test/tests/helpers/shell-helpers.mjs`, and the other matches are used as strings;
  JSON parsing in existing `callText()` reads is explicit and remains unchanged. The grep found no
  other `ctx.call` / `ctx.app` consumer that depends on JSON-looking string text becoming an
  object/number. `tests/helpers/**` is absent in this checkout; the corresponding helper tree is
  `integration-test/tests/helpers/**`.

- [x] **Add integration coverage in existing modules.** Keep the existing raw-text assertions in
  `integration-test/tests/core/mcp/mcp.test.mjs` unchanged and add a check where `rawCall()`'s text
  body for the string `"true"` is exactly `true` (without JSON quotes) while `ctx.call()` returns
  the same string. Add a case in that file that reads a JSON-looking string and a true boolean
  through `ctx.call()` and verifies both types, plus a method-path-without-args rejection and the
  three new assertion methods. Add a focused stand-in/options case to the existing module
  `integration-test/tests/core/mcp/mcp.test.mjs`. Update
  `integration-test/tests/helpers/boards.mjs` and
  `integration-test/tests/boards/permissions/permissions.test.mjs` to poll `dialogs[0].title` by
  path with `{ dialog: true }`. Update `integration-test/tests/browser/helpers.mjs` to use the
  returned `pageId` instead of rescanning `pages.all`, and assert that id in
  `integration-test/tests/browser/navigation/navigation.test.mjs`. Do not add unit tests or a test
  harness.
  Claude runs the full owned suite after implementation; this task does not run it.

- [x] **Document the boundary contract.** In `assets/guides/agents/web-app-tests.md`, replace the
  existing text-parsing paragraph and add one section titled **Crossing the call boundary** that
  explains all of the scope bullets: `ctx.app` is the call-tree root rather than script `app`; a
  stand-in names a path and resolves again on each read (including after editor switch); method
  calls start immediately while property reads start on `await`; awaiting returns a summary;
  `undefined` becomes `null` and undefined object properties are dropped; arguments are JSON;
  `waitFor` resolves to the polled value and accepts call options; attention covers menus and
  dialogs; leave unsaved pages to cleanup; never let `finally` throw. Include the exact
  `openBrowser()` page id/handle behavior and `ctx.expect()` additions. Keep within
  `npm run guides:check` page character limits.

- [x] **Update type/docs consistency.** If `TestContext`'s public method types change, update
  `doc/standards/integration-tests.md` and `.claude/skills/ui-tests/SKILL.md` only where their
  current signatures become stale; the new call-boundary explanation itself belongs in
  `assets/guides/agents/web-app-tests.md`. No new English UI strings are expected; if implementation
  introduces one, add it to `src/shared/i18n/en/` and defer translations until epic close.

### No changes

- `node_modules/ai-vision` and the `github:andriy-viyatyk/ai-vision` package: preserve its installed
  version and do not publish or bump it.
- `C:\projects\persephone-boards`: read-only; no board checkout edits.
- `window.persephone`, `BOARD_BRIDGE_VERSION`, and its history: no bridge surface change is needed.
- `doc/active-work.md`, `doc/epics/EPIC-199.md`, and `doc/reviews/refactoring-roadmap.md`: no tracking,
  epic, or roadmap edits; none of the modules touched is a roadmap §2.3 god file.
- `src/shared/board/` and board registries: this task adds no board rule.
- No `await import()` or import-zone wrapper is part of the plan.
- Strict-folder null-check fixes: none are planned; if implementation discovers one, keep it
  type-only and record it explicitly.
- `integration-test/run.mjs`, runner lifecycle, and existing assertion strength: do not change runner
  ownership or weaken assertions. Claude runs the full owned suite after implementation.
- No unit tests or new test harness.

## Concerns

The stand-in needs a documented, unambiguous way to bind call options because method arguments may
already be objects; options must not be guessed from an ordinary final argument. The plan chooses a
`withOptions()` node wrapper to keep the call path and options separate. Grep of the call-tree source
found no member named `withOptions`; this is a new local stand-in API, implemented in
`src/test-host/app-proxy.ts`, and must preserve the current immediate method invocation /
await-triggered property read behavior.

The MCP `_meta` type marker must remain out of the primary body. Keep all existing `content` text
and supplementary blocks unchanged so agent clients and `npm run test:ui:call` retain their current
visible text. The suite adapter in `integration-test/lib/client.mjs` is a second consumer and must
decode the same marker.

The openBrowser page-id extension must preserve the existing editor stand-in API for callers that
use `page.click()` / `page.evaluate()` directly. Store `pageId` as local stand-in metadata handled
by `src/test-host/app-proxy.ts`; it must not append `.pageId` to the MCP path.

## Acceptance Criteria

- [x] A call result that is the string `"true"`, `"42"`, or JSON-looking file/body text stays a
  string through `ctx.call()` and `ctx.app`; actual booleans, numbers, arrays, objects, and null
  retain their types. `_meta["persephone/resultType"]` carries only `"string"` or `"json"`; an absent
  marker uses the legacy parse-with-fallback behavior. `ctx.callText()` and the agent-facing `call`
  text are unchanged.
- [x] `ctx.app` can bind and forward `maxLength` and `dialog`; `ctx.waitFor()` forwards call options
  on path polls while retaining timeout semantics and returns the last polled value.
- [x] Calling a method path through `ctx.call()` without an args array fails with guidance to pass
  `[]`; property reads remain valid.
- [x] `ctx.openBrowser()` provides the page id and keeps its existing editor operations; the three
  requested `ctx.expect()` methods are typed and report failures through the current step tracker.
- [x] Integration-test string assertions check the exact string type without coercion, and existing
  exact-text reads continue using `ctx.callText()`; no assertion is weakened.
- [x] The web-app test guide contains one complete “Crossing the call boundary” section with every
  listed behavior, and any updated developer/skill signatures agree with `TestContext`.
- [x] No unit test/harness is introduced; no changes are made to `persephone-boards` or
  `ai-vision`; no Persephone launch, `integration-test/run.mjs`, `npm start`, Electron, port 7865,
  or Persephone MCP tool is used. Claude runs the full owned suite after implementation.

## Files Changed

| File | Planned change |
|------|----------------|
| `src/shared/mcp-result-type.ts` | Own the single `_meta` result-type key imported by the TypeScript producer and consumer. |
| `src/main/mcp/tools/call-tools.ts` | Add `_meta` result type while preserving primary text content. |
| `src/main/mcp/types.ts` | Extend `IMcpToolResult` with optional `_meta` result-type metadata. |
| `src/test-host/client.ts` | Decode `_meta` result types for `call()`; preserve text for `callText()`. |
| `src/test-host/app-proxy.ts` | Carry options through stand-ins and support page-id metadata. |
| `src/test-host/context.ts` | Expose call options in wait/proxy paths, reject missing method args, add assertions. |
| `src/test-host/browser-helpers.ts` | Add `pageId` metadata to the existing returned editor handle. |
| `integration-test/lib/client.mjs` | Decode the `_meta` type marker consistently with the product host. |
| `integration-test/README.md` | Correct the stale statement that the app stand-in is only for future suite rewrites; update the API summary. |
| `integration-test/tests/core/mcp/mcp.test.mjs` | Cover fidelity, method args, call options, wait options, and new assertions. |
| `integration-test/tests/editors/log-view/log-view.test.mjs` | Assert opened grid page content as its raw string, without `JSON.stringify` coercion. |
| `integration-test/tests/helpers/boards.mjs` | Use path-based `waitFor` with `{ dialog: true }` for board dialog titles. |
| `integration-test/tests/boards/permissions/permissions.test.mjs` | Exercise dialog-aware path polling. |
| `integration-test/tests/browser/helpers.mjs` | Consume page id from the returned handle. |
| `integration-test/tests/browser/navigation/navigation.test.mjs` | Assert exact strings and returned page id. |
| `integration-test/tests/browser/tabs/tabs.test.mjs` | Assert exact string DOM state. |
| `integration-test/tests/browser/site-extensions/saved-site-extensions.test.mjs` | Assert `aria-checked` as a string. |
| `integration-test/tests/tools/settings-page/settings-page.test.mjs` | Assert exact DOM string for `data-checked`. |
| `assets/guides/agents/web-app-tests.md` | Add the call-boundary section and update context behavior. |
| `doc/standards/integration-tests.md` | Update public API signatures where stale. |
| `.claude/skills/ui-tests/SKILL.md` | Update public API signatures where stale. |
