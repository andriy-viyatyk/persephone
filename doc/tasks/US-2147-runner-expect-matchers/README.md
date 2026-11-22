# US-2147: Complete the expect matcher set

## Goal

Implement B1 and B6 of [EPIC-202](../../epics/EPIC-202.md): useful assertion matchers and actionable errors for unsupported matchers and app stand-ins.

## Background

`src/test-host/context.ts` constructs a plain matcher object and calls `check`, which sets the step and associates thrown objects with it. It currently supports `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeGreaterThan`, `toBeLessThanOrEqual`, `toMatch`; it uses `node:assert/strict`, `Object.is`, and bounded `preview`. Missing names currently throw JavaScript's `TypeError: ... is not a function`. Feedback items 6, 7, 14, 21 and 24 motivate this task; the `waitFor` message and browser click portions are outside it.

`app-proxy.ts` creates callable Proxy stand-ins, including handles from `asHandle`. Its private `SEGMENTS` symbol already identifies both. A `JSON.stringify` of a stand-in gets a synthetic `toJSON` member, invokes it through the proxy's `apply` trap, and sends a call; the server rejects that unknown member asynchronously. The returned Promise is ignored by serialization, producing the unhandled rejection in item 7. The `validateArguments` toJSON checks are a separate outgoing-argument path and do not protect `expect`.

## Implementation Plan

- [x] In `src/test-host/app-proxy.ts`, export a narrow `isAppStandIn(value)` using the same private `SEGMENTS` identification as `asHandle`, checking callable values first. Do not probe `then`, `toJSON`, or serialize the value. In `expect.ts`, walk direct values and expected arguments through plain objects and arrays before rendering them, detecting nested stand-ins, including `{ page: ctx.app.pages[0] }`. Use a cycle-safe bounded walk with a small depth cap (for example 4), and do not invoke accessor properties; preserve ordinary functions for `toThrow`. Use a safe preview that does not serialize unchecked values beyond the bound or invoke accessors.
- [x] Move the matcher implementations and `preview` to new `src/test-host/expect.ts`; export `ExpectMatchers` and exactly `createExpect(value: unknown, message: string | undefined, check: (step: string, assertion: () => void) => void): ExpectMatchers`. Keep `context.ts` as the entry point and retain the `check`/`markFailure` bookkeeping and existing matcher behavior. Update `TestContext.expect` and delegate:

  ```ts
  // Before:
  expect(value: unknown): { toBe(expected: unknown): void; toEqual(expected: unknown): void; toContain(expected: unknown): void; toBeTruthy(): void; toBeGreaterThan(expected: number): void; toBeLessThanOrEqual(expected: number): void; toMatch(expected: RegExp): void };
  // After:
  expect(value: unknown, message?: string): ExpectMatchers;
  // createContext entry: expect(value, message) { return createExpect(value, message, check); }
  ```
- [x] Implement `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeGreaterThan`, `toBeLessThanOrEqual`, `toMatch`, plus `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toHaveLength`, `toHaveProperty`, `toMatchObject`, `toContainEqual`, `toThrow`. Use `node:assert/strict` deep equality and partial recursive matching for objects/arrays, without mutating inputs; `toHaveProperty` supports a dotted path and optional expected value, distinguishing missing from present undefined. `toContainEqual` uses deep equality; `toThrow` invokes a synchronous function and optionally matches a string, RegExp or error constructor. Preserve existing argument semantics for the seven existing matchers.
- [x] Provide `.not` on every matcher, including `toThrow`, with failure generated when the positive predicate succeeds; do not swallow invalid-argument errors as successful negation. Put a supplied message before generated assertion text. Route assertion and unknown-name errors through `check`, and refuse a stand-in/handle before any preview, advising `await` or reading a property first.
- [x] Wrap both positive and `.not` matcher objects in a Proxy whose unknown string property access throws a clear error including the unsupported name and the complete supported matcher list. Handle symbols and introspection safely; do not accidentally treat `then` as a matcher. Example:

  ```js
  // Before: TypeError: ctx.expect(...).toBeFalsy is not a function
  ctx.expect(false, "empty result").toBeFalsy(); // after: passes
  ctx.expect(1).not.toBe(2);                    // after: passes
  ```

- [x] Run `npm run typecheck` and `npm run lint`; no unit tests or harnesses were added.
- [x] Live check by Claude on 2026-11-22 against the running dev app (attached throwaway suite outside the repo); `npm run test:ui -- --area core/smoke` passes. See the epic's notes.

## Concerns

- `src/test-host/` is not in `scripts/typecheck-strict.mjs`'s strict folder list; normal typecheck and lint still apply. Preserve old assertion steps and failures for the shared UI suite. `integration-test/run.mjs` passes a selection and setup; its aggregator reads product `report.json` fields. Existing tests see the same matchers and results without opting in.
- At epic close `/userdoc` should update `assets/guides/agents/web-app-tests/index.md`, **Test file and context** and **Triage a failed run**. No new protocol or `window.persephone` change; no `await import()` workaround. God files only shrink.
- Files that need NO changes: `doc/active-work.md`, `doc/epics/EPIC-202.md`, `src/main/test-mode/instance-options.ts`, `src/ipc/test-host-protocol.ts`, `integration-test/**`, `launcher/**`, `node_modules/ai-vision/**`, MCP server, and the user guide in this task.

## Acceptance Criteria

- [x] All listed matchers and their `.not` forms work; optional messages precede generated text; unknown names list supported names.
- [x] Direct and nested stand-ins and handles fail synchronously with await/property guidance and no accidental `toJSON` call; `TestContext` describes the API.
- [x] Existing integration behavior remains compatible; typecheck and lint pass; the Claude manual check remains available.

## Files Changed

| File | Planned change |
|---|---|
| `src/test-host/expect.ts` | Matcher implementation and types. |
| `src/test-host/context.ts` | Delegate through existing `check`; update context type. |
| `src/test-host/app-proxy.ts` | Expose safe stand-in detection. |
