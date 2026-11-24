# US-2186: Runner reads whole values without truncation (failure capture, `storageState`)

**Epic:** [EPIC-210](../../epics/EPIC-210.md) — items 2 and 12

**Status:** In Progress

## Goal

A runner call that returns a whole JSON value never fails with "truncated without maxLength" unless
the test set a cap. This covers the failure bundle's diagnostics reads and `site.storageState()` on a
page with large tokens in storage.

## Background

- `src/test-host/model-call-options.ts` `modelCallMaxLength()` recognizes only
  `[windows[i].]pages[i].editor.app...`; it reuses `UNBOUNDED_CALL_MAX_LENGTH`
  (`Number.MAX_SAFE_INTEGER`) from `src/shared/ai-vision-call-limits.ts`. Other paths use the MCP
  server's 20,000 default (`src/main/mcp/tools/call-tools.ts`, `callTools()`).
- `McpClient.call()` and `callText()` in `src/test-host/client.ts` apply that rule; `set()` bypasses
  it. `rawCall()` and `image()` are lower-level entry points. `TestWindowOwner` in
  `src/test-host/test-window.ts` scopes paths and forwards the cap.
- `McpClient.decode()` rejects a truncation marker only when no cap was supplied. With a cap,
  strings/text may be returned truncated; structured results may be valid but incomplete JSON.
  `safeReply()` uses `sensitiveMemberKind()` and `sensitiveSummary()` from
  `src/test-host/storage-state-redaction.ts`, so the marker itself is hidden in sensitive errors.
  `context-operations.ts` registers storage secrets only after a successful `storageState` read.
- `captureDiagnostics()` in `src/test-host/failure-bundle.ts` reads `pageErrors`, `consoleMessages`
  and `networkRequests` without a cap, then filters timestamps and keeps the last 100. The network
  method in `src/renderer/automation/page-state.ts` accepts `includeBodies` and `maxBodyBytes`,
  not `since`; its default omits bodies. The existing host-side timestamp filter must remain.
- `assets/guides/agents/web-app-tests/index.md:40` promises unbounded runner model reads, but the
  browser members above currently use the server default.

## Implementation plan

1. [x] **Default rule:** `src/test-host/model-call-options.ts` owns the runner's decoded-call
   limit. Rename `modelCallMaxLength` to `runnerCallMaxLength`, remove path parsing and reuse
   `UNBOUNDED_CALL_MAX_LENGTH` for every decoded call, including the overview and assignments.
   An explicit cap wins. In `src/test-host/client.ts`, update `McpClient.call()` and `callText()`
   and make `set()` pass the same default to `rawCall()`; do not change `rawCall()` or `image()`.
   This deliberately covers all paths, including snapshots and content: the runner is a
   programmatic client and an allow-list would leave other whole values exposed to the same bug.

   ```ts
   // Before: modelCallMaxLength(path, maxLength) parses and recognizes only editor.app paths.
   // After, in model-call-options.ts:
   export function runnerCallMaxLength(explicitMaxLength: number | undefined): number {
       return explicitMaxLength ?? UNBOUNDED_CALL_MAX_LENGTH;
   }
   // client.ts: call() and callText()
   // Before: maxLength: modelCallMaxLength(path, maxLength)
   // After:  maxLength: runnerCallMaxLength(maxLength)
   // set(): add maxLength: runnerCallMaxLength(undefined) to rawCall's options.
   ```

2. [x] **Failure capture:** `captureDiagnostics()` owns the diagnostic read policy; reuse the
   shared limit and the `TestWindowOwner.call()` fifth argument. Explicitly request the full reply
   for all its reads, independent of the general default. Keep `networkRequests` arguments `[]`
   and the existing filtering, projection, 100-entry cap and redaction.

   ```ts
   // Before
   return await testWindow.call(client, `${base}.${property}`, args, timeout);
   // After (import from ../shared/ai-vision-call-limits.js)
   return await testWindow.call(client, `${base}.${property}`, args, timeout, UNBOUNDED_CALL_MAX_LENGTH);
   ```

3. [x] **Safe truncation error:** `McpClient.decode()` owns reply interpretation and reuses
   `sensitiveMemberKind()` and `formatStep()` with its redactor. Pass the actual optional cap to
   `decode()` from `call()` and `callText()` instead of a boolean; pass `undefined` from `set()`.
   When the marker is present for `storage-state` and an explicit cap exists, throw before parsing
   or returning text, with only the formatted call, cap and advice. Never include `body`, marker,
   or raw reply in that error; the secret may not have been registered yet. Preserve current capped
   behavior for other members and current unexpected-truncation detection when there was no cap.

   ```ts
   // Before
   if (!maxLengthSupplied) throw new Error(`${formatStep("call", path, args, this.redactor)} was truncated without maxLength. Raw reply: ${raw}`);
   // After, inside the existing marker branch
   if (maxLength !== undefined && sensitiveMemberKind(path) === "storage-state")
       throw new Error(`${formatStep("call", path, args, this.redactor)} storageState reply exceeded maxLength ${maxLength}; raise it.`);
   if (maxLength === undefined)
       throw new Error(`${formatStep("call", path, args, this.redactor)} was truncated without maxLength. Raw reply: ${raw}`);
   ```

4. [ ] **Integration verification:** extend
   `integration-test/tests/browser/automation/observe/observe.test.mjs`, using its browser helpers
   and `integration-test/fixtures/http/browser/automation/observe-network.html`. Seed a synthetic
   >100 KB localStorage value using `editor.evaluate`, check the exact value returned by
   `storageState()` with no options, and assert an explicit small cap throws actionable text with
   neither the token nor any raw reply. Check a capped ordinary string still truncates, and an
   uncapped non-model string and structured browser read exceed 20,000 without truncation; exercise
   `ctx.callText` and an attached/scoped path as well. Clean storage and close the page in `finally`.
   For failure capture, generate hundreds of distinct local fixture requests including a 4xx after
   starting the test, then deliberately fail a temporary local test and inspect its staged
   `report.json` and `failures/*.json`: no network capture error, and the expected failed request
   appears with redacted URL and at most 100 entries. Remove that temporary failing test afterwards;
   do not add a unit test or harness. Run the targeted UI module, `npm run typecheck`,
   `npm run lint`, and `npm run guides:check` after implementation.
   The UI coverage is written; execution and failure-bundle inspection remain for the reviewer
   because this sandbox cannot launch Electron, and the temporary failing test was skipped as
   requested.

5. [x] **Guides:** update `assets/guides/agents/web-app-tests/index.md` and
   `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` to say decoded runner calls
   default to unbounded and explicit caps retain truncation semantics, except a truncated
   `storageState` fails with advice. Add a brief entry to `assets/guides/whats-new.md`.

## Concerns

- Unbounded replies can use several MB of memory and time; callers can explicitly cap ordinary
  reads or request narrower data. This is the chosen default, consistent with programmatic reads;
  no latency measurement is a prerequisite. `rawCall` deliberately retains MCP defaults.
- `Number.MAX_SAFE_INTEGER` is a practical limit, not infinite memory. This changes no wire
  protocol, board rule, `window.persephone` surface, or roadmap §2.3 god file.

## Acceptance criteria

- [ ] A failing test with hundreds of requests writes its failure bundle without a network capture
      error, and includes the expected failed request after timestamp filtering and redaction.
- [ ] `site.storageState()` returns the complete >100 KB state without `withOptions`.
- [ ] A truncated storage state under an explicit small cap fails with actionable, redacted text;
      ordinary explicit caps still work, and uncapped decoded calls work on scoped and other paths.
- [ ] Targeted UI integration, typecheck, lint and guide checks pass.

## Files changed

| File | Change |
|---|---|
| `src/test-host/model-call-options.ts` | Own the unbounded decoded-call default, reusing the shared limit. |
| `src/test-host/client.ts` | Apply the default to decoded calls and safely report capped storage-state truncation. |
| `src/test-host/failure-bundle.ts` | Explicitly request whole diagnostic reads. |
| `integration-test/tests/browser/automation/observe/observe.test.mjs` | Add runner integration coverage. |
| `assets/guides/agents/web-app-tests/index.md`, `assets/guides/agents/web-app-tests/call-boundary-and-examples.md`, `assets/guides/whats-new.md` | Document the default and capped storage-state behavior. |

**No changes:** `src/main/mcp/tools/call-tools.ts` (agent-facing server limit and marker),
`src/renderer/automation/page-state.ts` (no `since` option), `src/test-host/test-window.ts`
(existing forwarding), `src/test-host/storage-state-redaction.ts` (existing classification and
redaction), `src/shared/ai-vision-call-limits.ts` (existing limit),
`integration-test/lib/client.mjs` (separate low-level client), and the board bridge.
