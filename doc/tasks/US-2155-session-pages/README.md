# US-2155: Session pages: `ctx.usePage`

**Epic:** [EPIC-204](../../epics/EPIC-204.md) · **Proposal:** A4 · **Feedback:** [US-2138](../US-2138-web-app-test-feedback/README.md), item 3

## Goal

Let a test use an already open browser page in its test window without the runner closing or reloading it.

## Background

- EPIC-204 decision 7 requires browser-only matching, exactly one result, count-only mismatch errors, and preservation of the session page. US-2153 owns window scoping in `src/test-host/test-window.ts`; this plan follows its reviewed design when current code differs.
- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:24`, `:206`–`:213` exposes every page in this window as `PageWrapper`; its ai-vision summary (`PageWrapper.ts:210`–`:219`, `:258`–`:291`) includes `id`, page `title`, `editor` (or null), language, file path, modified/pin/active fields, and optional workspace/browser metadata. Browser `url` is included only when nonempty and `agentMayAccessBrowserPage` permits it (`:280`–`:289`); it is not universally present. The page title is `PageWrapper.ts:119`–`:120`, not necessarily `BrowserEditorFacade` active-tab title (`BrowserEditorFacade.ts:373`–`:378`). Match the list's page title and permitted URL; do not probe `editor.url`: inaccessible or missing URLs do not match a URL criterion. This preserves existing private-page restrictions. The feedback's non-browser probe failure and failed-step logging are recorded at `doc/tasks/US-2138-web-app-test-feedback/README.md:28`.
- `src/test-host/browser-helpers.ts:9`–`:38` creates an editor handle with `context.handle(page["editor"], { pageId })`; `:133`–`:163` already reads and validates page lists for bookkeeping. `context.ts:30`–`:39` owns per-attempt `ownedPages`; `test-attempt.ts:42`–`:65` snapshots before the test and cleans up in `finally`. Current cleanup predates US-2153; its plan changes mode selection and scopes bookkeeping through the single window owner. Review sections 3.A, 3.C and 5 (`doc/reviews/web-app-testing-review.md:76`, `:121`, `:264`) place capture in US-2156 and storage state F2 later.

## Implementation Plan

- [x] **Match and return the handle.** In `src/test-host/browser-helpers.ts`, add `usePage` as the owner of selection and matching; reuse `pageList` and the existing handle construction in `openBrowser`. Extend the parsed page shape to retain string `title` and optional string `url`. Obtain `pages.all` using US-2153's scoped bookkeeping call through `test-window.ts` and the current client (`launcher.client ?? client`), with the request timeout, never `ctx.call` or the logged proxy. Filter `editor === "browser-view"` before matching; match the summary fields directly. A missing URL/title fails only its respective supplied criterion. Do not log list results, criteria, URL or title. Propagate a bookkeeping transport error rather than converting it into a misleading zero-match count.

  ```ts
  // Before: pageList retains only these fields; openBrowser builds a handle.
  interface BrowserPage { id: string; editor: string; }
  return context.handle(page["editor"], { pageId: created.id });

  // After: retain the list's matching fields and return the same kind of handle.
  interface BrowserPage { id: string; editor: string; title?: string; url?: string; }
  // scoped bookkeeping pages.all -> pageList -> browser filter -> criteria -> exactly one
  sessionPages.add(match.id);
  return context.handle((context.app as /* existing stand-in shape */ any).pages[match.id].editor, { pageId: match.id });
  ```

  The final implementation should use the typed `Record<string, unknown>` stand-in narrowing already used by `openBrowser`, not the illustrative `any`; extract a small shared handle helper if useful. Treat both criteria as an AND. String URL uses case-sensitive `startsWith` on the unmodified URL, string title uses case-sensitive `includes`; regex uses `test` on the same string, resetting `lastIndex` before each test and restoring it afterward so global/sticky expressions are deterministic and the caller's regex is unchanged. Validate the options object and both supplied values at runtime: at least one must be a string or RegExp; reject empty strings and invalid types with a fixed `TypeError` that does not echo the input. A mismatch throws `ctx.usePage matched N pages.` only; never include selectors, candidate IDs, URLs or titles. Register only after exactly one match. Repeated selection of the same ID is idempotent. Use the same rule in all modes, including the unprefixed owned mode.

- [x] **Context and capture contract.** In `src/test-host/context.ts`, add `usePage(options: { url?: string | RegExp; title?: string | RegExp }): Promise<object>` and `sessionPages: Set<string>` alongside `ownedPages` in `_state`; allocate both per context/attempt. Invoke the helper with the scope owner and current client, and provide an explicit `_state.pagesUnderTest(): ReadonlySet<string>` returning a fresh union of owned and session IDs for US-2156. Preserve existing `pageId` handle metadata, scoped proxy behavior and restart client replacement. No capture implementation is added in this task; US-2156 consumes the accessor before cleanup.

  ```ts
  // Before
  _state: { step: string; error?: string; stepOf(error: unknown): string; ownedPages: Set<string> };
  // After (retain the existing step members)
  _state: { /* existing step members */ ownedPages: Set<string>; sessionPages: Set<string>;
            pagesUnderTest(): ReadonlySet<string> };
  ```

- [x] **Cleanup.** In `src/test-host/test-attempt.ts`, pass the attempt's session set to `closePagesOpenedSince` in every mode. In `src/test-host/browser-helpers.ts`, the cleanup owner must exclude session IDs from the pages it closes, even if the page appeared after the baseline or also occurs in `ownedPages`. Retain US-2153's mode-specific ownership of all other pages and its dialog/menu sweep. For popups, selected-window cleanup considers both owned and session IDs; owned and attached-created retain baseline-diff behavior. In every mode close only popups absent from the baseline, using the existing `readSnapshot`, untrackable-popup guards and `boundedCall` / `closePopup` error handling. For a session page first appearing after baseline, the baseline popup set is empty, so its current popups are treated as new. Session IDs are never passed to page closing, pin/unpin, or navigation/reload. The ownership set lasts for the attempt, including `finally` and failure capture.

  ```ts
  // Before US-2153: the baseline diff is the page close set in an owned run.
  const newPages = attached ? appeared.filter((page) => ownedPages.has(page.id)) : appeared;
  // After US-2153 mode selection: protect session pages in every mode.
  const newPages = appeared.filter((page) => !sessionPages.has(page.id)
      && (mode !== "attached-selected" || ownedPages.has(page.id)));
  // Selected-window popup eligibility: ownedPages.has(pageId) || sessionPages.has(pageId).
  ```

- [x] **Guides and standards.** In `assets/guides/agents/web-app-tests/index.md`, add `usePage` to the context member list and a signed-in-session example next to `openBrowser`: keep a dedicated Persephone test window, sign in once by hand, run with `--attach --window <title or index>`, then `const site = await ctx.usePage({ url: "https://example.test/" });`. Explain URL prefix, title substring, regex and exactly-one-match rules, `site.pageId`, no runner reload or per-test close, popup cleanup, and choosing this when sign-in cannot be automated. State storage state F2 is later work, not an existing feature. Align existing cleanup text with US-2153's three modes and this protection; document window lifecycle limitation below. Update the context list and cleanup description in `doc/standards/integration-tests.md:130`–`:158` to match. Do not add a guide entry to the dashboard.

  ```js
  // Before
  const site = await ctx.openBrowser("https://example.test/orders");
  // After, for an existing manually signed-in session
  const site = await ctx.usePage({ url: "https://example.test/orders" });
  ```

- [x] **Verification.** Implementer ran `npm run lint` and `npm run typecheck` successfully. Claude runs `npm run guides:check` and the live verification: a selected window containing text and multiple browser pages, exact/zero/multiple matches, title-only and combined selectors, regex including `g`/`y`, missing URL, and repeated calls; verify no failed probe steps or candidate details in mismatch errors. Exercise an owned run and all three US-2153 modes, including an adopted post-baseline page, a pre-existing popup and a new popup, cleanup on failure, preservation of session pages during attempt cleanup, and isolation of another window. Verify the returned handle works and carries `pageId`; inspect the accessor's union before cleanup. No unit tests or harnesses.

## Concerns resolved with recommended answers

- **URL source and privacy:** use the existing `pages.all` summary URL, not `pages[id].editor.url`. Its omission for inaccessible private pages is intentional; do not bypass `agentMayAccessBrowserPage`. Title-only selection uses the page summary title, not a different browser-tab title. The list itself is read through scoped bookkeeping and is not logged.
- **Private pages (Claude review):** the summary hides `url` only for incognito/Tor pages the user opened (`src/renderer/editors/browser/agent-access.ts:21`); such a page never matches a `url` criterion and stays unreadable to the test. The guide says in one sentence: a session page must be in a normal (non-incognito, non-Tor) profile.
- **Post-baseline session:** protect it from per-attempt cleanup regardless of ownership mode; new popups on it are cleaned using the baseline rule. Selecting a page opened by `openBrowser` gives session protection precedence.
- **Window lifetime:** US-2153 and EPIC-204 decisions 2 and 4 still end an owned app and dispose a runner-created attached window at run teardown. Therefore preserving a page beyond the run requires `--attach --window` (selected window); no per-page close or reload is issued for a session page in any mode. Do not promise persistence after its containing runner-owned window is disposed. Document this distinction explicitly.
- **Scope and guardrails:** `test-window.ts` alone owns scoping; `browser-helpers.ts` owns selection and cleanup, reusing `pageList`, snapshot and handle patterns; `context.ts` owns per-attempt sets and accessor. No protocol, board rule, bridge change, import-zone bypass, dynamic import or god-file expansion is planned. Any incidental strict-folder null fix is type-only unless separately recorded here; do not alter runtime conditions as a null fix.

## Acceptance Criteria

- `ctx.usePage` searches only browser pages in the test window in all modes, with the documented criteria, count-only mismatch errors and no failed bookkeeping steps or logged candidate details.
- It returns the same editor handle shape and `pageId` as `openBrowser`, without navigating or reloading. Restricted or unavailable summary fields are not bypassed.
- Per-attempt cleanup never closes a session page, even if it appeared after baseline or is also owned; new session popups are closed according to baseline tracking. Unrelated pages and baseline popups retain US-2153 behavior.
- `_state.pagesUnderTest()` exposes the owned/session union for US-2156; attempt isolation and failure cleanup work.
- Guides and standards describe the signed-in pattern and window-lifetime limitation. Required lint, typecheck, live and guide checks pass as assigned above.

## Files Changed

| File | Planned change |
| --- | --- |
| `src/test-host/browser-helpers.ts` | Scoped list matching, editor handle reuse, session-aware page and popup cleanup. |
| `src/test-host/context.ts` | Public helper and per-attempt session set/union accessor. |
| `src/test-host/test-attempt.ts` | Pass session bookkeeping into cleanup. |
| `assets/guides/agents/web-app-tests/index.md` | Document signed-in session pattern and cleanup. |
| `doc/standards/integration-tests.md` | Update context and cleanup contract. |

**Files needing no change:** `src/test-host/test-window.ts` (reuse US-2153's owner); `src/test-host/results.ts` (US-2156 owns capture); `src/renderer/api/pages/`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `PageWrapper.ts`, and `BrowserEditorFacade.ts` (existing summaries suffice); protocol, board bridge and registries; dashboard and epic.
