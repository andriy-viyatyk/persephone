# US-2166: Storage state and storage helpers

## Goal

Add Playwright-shaped browser storage state capture and pre-navigation application to the web-app test runner, plus small page-scoped local/session storage helpers. Gate HttpOnly-cookie reads to pages opened by `ctx.openBrowser()` or adopted by `ctx.usePage()`, keep all storage values and init-script source out of logs and reports, and reuse US-2165's init-script registry.

## Background

### EPIC-207 decisions and existing F1 foundation

- This task implements EPIC-207 proposals F2 and F7. Decision 3 makes `storageState()` a test power because it reads HttpOnly cookies; F7 helpers are evaluate-equivalent and use the existing page access rule. Decisions 1 and 2 put CDP behavior in a new feature module under `src/main/cdp/` composed by `src/main/cdp-service.ts`, and require the existing browser IPC/typed RPC and CDP helpers rather than new protocol code. Decision 4 makes state a secret and permits only a size/count summary in logs. Decision 8 has US-2165 bump `BOARD_BRIDGE_VERSION` to 1.61.0; this task extends that history paragraph without another bump.
- [US-2165](../US-2165-init-scripts/README.md) owns `Page.addScriptToEvaluateOnNewDocument` in `src/main/cdp/cdp-init-scripts.ts`, the typed browser IPC path, and the renderer `addInitScript` / `removeInitScript` facade. Use that registry for the one-navigation storage seeding script; do not create a second init-script registry or change `attachTestExtension` semantics.
- `src/renderer/automation/CdpSession.ts` is the renderer CDP client and uses the existing `BrowserChannel` request/reply path. `src/ipc/main/cdp-handlers.ts` and `src/main/cdp-service.ts` dispatch/combine CDP features. Add only storage-specific typed operations and composition there; reuse `CdpTarget` attach/detach lifecycle and existing invoke error handling.

### Verified page ownership and access behavior

- The one access predicate belongs next to `agentMayAccessBrowserPage` in `src/renderer/editors/browser/agent-access.ts`. That helper currently permits ordinary pages and permits incognito/Tor only when `openedByAgent` is true. `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` and `PageWrapper.ts` already call it; the browser remote and popup code also use it.
- `openedByAgent` is declared in the ephemeral-state section of `BrowserEditorState` in `src/renderer/editors/browser/browser-state.ts`, defaults to `false`, and is set by `BrowserEditor.configureMode()` in `src/renderer/editors/browser/BrowserEditor.ts`. `PageCollectionWrapper` stores the MCP-origin flag and passes it through `showBrowserPage()` and `openUrlInBrowserTab()`; `ScriptContext` sets that flag when `origin === "agent"`. `ctx.openBrowser()` calls `pages.showBrowserPage` through that MCP call path before navigating. Therefore pages it opens in normal profiles already carry `openedByAgent`; no ownership fix is required for those pages. Keep the test adoption bit in the same explicitly ephemeral state area so it is false after restore.
- `src/test-host/browser-helpers.ts` owns `openBrowser()`, `usePage()`, and `closePagesOpenedSince()`. `src/test-host/context-operations.ts` owns the `ctx` method surface and per-attempt `ownedPages` / `sessionPages` sets. Adopted pages are left open today, so cleanup must explicitly release their adoption flag (and clear their init scripts) without closing them.
- Add `agentMayUseBrowserTestPower(state)` beside `agentMayAccessBrowserPage(state)`. It composes the existing page rule with `openedByAgent || testPowerAdopted`; it must not re-derive the private-session rule. `ctx.usePage()` sets `testPowerAdopted` through a runner-only browser-editor member, after refusing user-opened incognito/Tor pages. Cleanup clears it and page restoration starts with it false. The gate is a safety boundary against accidental use on another page, not a sandbox; any MCP client can call runner-only members, as Decision 3 records.
- The refusal for `storageState()` is: `storageState() is available only on a page opened with ctx.openBrowser() or adopted with ctx.usePage(); user-opened incognito/Tor pages cannot be adopted.` Reuse the same predicate and message for US-2167 downloads, US-2168 routes, and US-2169 clipboard; do not add feature-specific access checks.
- CDP cookie commands address the browser profile/partition cookie jar associated with the target; cookies are not private to an individual tab. Thus `storageState()` reads that profile's cookies applicable to the current URL. Applying state on a persistent profile can overwrite the user's cookies for that domain and persist those changes. Do not refuse persistent profiles; recommend `ctx.openBrowser(url, { storageState, incognito: true })` for a disposable in-memory session or a dedicated browser profile when the suite needs persistence.

### Runner paths and logging verified

- `ctx.file(relative)` in `src/test-host/context-operations.ts` resolves with `path.resolve(path.dirname(identity.file), relative)`. `ctx.openBrowser()` currently lives in `src/test-host/browser-helpers.ts`, whose options and call sequence are URL/profile validation, create browser page, then navigate. Extend this sequence to load a supplied JSON file relative to the current test file (the suite folder for the active test) or accept an already-parsed object; install state before the navigation call. The runner already uses `node:fs/promises` in `src/test-host/results.ts` and `src/test-host/failure-bundle.ts`, but there is no test-context file-write helper. Tests can save captured state with Node `fs/promises.writeFile(ctx.file(...), JSON.stringify(state, null, 2))`; no new `ctx.saveStorageState()` member is needed.
- `src/test-host/client.ts` formats arguments and raw MCP replies into thrown errors. `src/test-host/step-format.ts` previews call arguments. `src/test-host/test-log.ts` previews results and serializes events. `src/test-host/context-operations.ts` writes step arguments, result previews, and errors. `src/test-host/results.ts` writes all `TestResult` error/step/cleanup fields to `report.json` and `report.md`. `src/test-host/failure-bundle.ts` writes page errors, console errors and failed-request diagnostics. Classify sensitive members by trailing path before preview/serialization, suppress their raw replies/errors, and allow a count-only storage summary. Also register cookie and Web Storage values from captured/applied states and `storage.set` arguments in a per-run redactor so exact values are scrubbed from assertion, diagnostic, or cleanup text.
- There is a second, app-side logger: `src/renderer/api/mcp/mcp-call-rpc.ts` calls `logIncomingRequest()` for every MCP call, and `src/renderer/api/mcp/request-log.ts` retains and displays the raw params and result in the MCP Server Log page. It currently filters only `_tipObservations`. This path must redact request arguments and replies for `storageState`, `applyStorageStateForTestRun`, and `addInitScript` (whose source may contain state values), and redact only arguments for `storage.set`; redact relevant errors too. Classify these by trailing member path so `windows[n].` and `pages["id"].` prefixes do not bypass redaction. `src/main/test-mode/TestModeLog.ts` writes app/site console and network metadata, but does not serialize MCP call arguments or replies. Keep network logging body/header-free and do not add storage payloads or init source to console/log events.
- Keep errors from `Page.addScriptToEvaluateOnNewDocument`, CDP cookie commands, validation, and cleanup free of cookie/storage values and init-script source. US-2165's registry must not echo script source in logs or errors.

### Architecture and API shape

- `src/renderer/editors/browser/BrowserWebviewModel.ts` is a roadmap §2.3 god file and must not grow. `src/main/cdp-service.ts` is also listed there and may gain only composition. Put cookie commands in new `src/main/cdp/cdp-storage-state.ts`; put renderer orchestration in new browser collaborator modules and compose them through the existing facade. No `await import()` or wrapper module to evade an import zone.
- Capture `{ cookies, origins: [{ origin, localStorage, sessionStorage }] }`. By default, capture only the selected tab's committed current origin. Read cookies with CDP `Network.getCookies({ urls: [currentUrl] })`, which filters the profile/partition cookie jar to cookies applicable to the current URL and includes HttpOnly cookies. This is URL-scoped, not tab-private: on persistent profiles it captures the same applicable cookies the user's browser profile uses. Return local/session storage from evaluation in the page. For a non-HTTP(S) or opaque current document, return no origin storage and no URL-scoped cookies rather than inventing an origin.
- `ctx.openBrowser(url, { storageState })` accepts a validated state object or JSON file path. Resolve relative paths with the same `path.dirname(identity.file)` base as `ctx.file()`. Before first navigation, set cookies through the selected tab's CDP Network session, register a storage-seeding source through US-2165, then navigate. The init source writes only to the exact matching origin in the state's `origins` list. Remove its registration as soon as `navigateAndWait()` settles (also on failure). This also seeds `sessionStorage`, which cannot be set from the host before the destination document exists.
- Public editor surface: `editor.storageState(options?)` and a nested `editor.storage` namespace with only `clear({ prefix?, area? })` and `set(key, value, { area? })` for F7. `area` is `"local"` by default or `"session"`; `set` accepts string keys and values, matching Web Storage. `clear` without a prefix clears that selected area; with a prefix it removes only matching keys. Do not add `get` or `keys` in this task; tests can use existing `evaluate()` for reads. The nested node is represented by an `IAiVisible` storage facade so normal call-tree property/method resolution supports `editor.storage.clear()`.
- `storageState()` and `applyStorageStateForTestRun()` use the test-power predicate. The F7 namespace uses `agentMayAccessBrowserPage()` only, matching `evaluate()` and the epic decision.

## Implementation Plan

1. **Add the shared test-power rule and ephemeral adoption.** In `src/renderer/editors/browser/agent-access.ts`, export `agentMayUseBrowserTestPower(state)` and the shared refusal text/function. Implement it by calling `agentMayAccessBrowserPage(state)` and then checking `openedByAgent` or a `testPowerAdopted` flag. Add `testPowerAdopted: boolean` to the explicitly ephemeral section of `BrowserEditorState` in `src/renderer/editors/browser/browser-state.ts`, default it to false, and verify the browser restore path constructs state through the same default rather than persisting the flag. In a new `src/renderer/editors/browser/BrowserTestPowerAdoption.ts`, own `adopt()` / `release()` behavior and reject adoption when the existing page-access helper refuses a user-private page. Have hidden `adoptForTestRun()` and `releaseFromTestRun()` browser-editor members delegate to this collaborator.

   Before:

   ```ts
   export function agentMayAccessBrowserPage(state) {
       return !isPrivateBrowserSession(state) || !!state?.openedByAgent;
   }
   ```

   After:

   ```ts
   export function agentMayUseBrowserTestPower(state) {
       return agentMayAccessBrowserPage(state)
           && (!!state?.openedByAgent || !!state?.testPowerAdopted);
   }
   ```

2. **Adopt and release pages from the runner.** Add runner-only `adoptForTestRun()` / `releaseFromTestRun()` browser-editor members, routed through the existing MCP call tree; they are not a new transport or protocol. In `src/test-host/browser-helpers.ts`, after `usePage()` has uniquely matched a page, call `adoptForTestRun()` before returning the handle and record its page ID only after success. If adoption refuses an incognito/Tor page, preserve the access-rule explanation and do not return a handle. In `closePagesOpenedSince()`, call `releaseFromTestRun()` for each `sessionPages` entry as best-effort cleanup and log only page ID, success, and a non-sensitive error. Ensure cleanup runs even if page snapshot fails. `ctx.openBrowser()` needs no adoption call because its MCP-originated open already sets `openedByAgent`.

3. **Own CDP cookie operations in a feature module.** Create `src/main/cdp/cdp-storage-state.ts`. It owns cookie capture and seeding for a browser target; use `Network.getCookies` with the selected tab's committed URL list and `Network.setCookies` through the existing `CdpTarget`/typed browser IPC plumbing. Do not explicitly call `Network.enable` just for cookies: these commands do not require it. `CdpTarget.enableDomain("Network")` sets 20 MB total and 1 MB per-resource body buffers; the existing `cdp-page-events.ts` / `cdp-network-collector.ts` path may already have enabled that domain. Keep the target/session key for command routing, while stating clearly that the cookie jar belongs to the profile/partition rather than the tab. Preserve cookie attributes returned by CDP and reject invalid serialized cookie records before sending commands. Do not put CDP storage logic in `BrowserWebviewModel.ts` or grow `cdp-service.ts` beyond imports, methods, and lifecycle composition.

4. **Implement renderer storage-state orchestration.** Create `src/renderer/editors/browser/BrowserStorageState.ts`, which owns validation and the capture/apply workflow for a selected tab. Reuse the existing browser tab target lookup, `CdpSession`, the page evaluator already used by `src/renderer/automation/queries.ts`, and US-2165 `addInitScript` / `removeInitScript`. `storageState()` first enforces `agentMayUseBrowserTestPower`, asks the CDP collaborator for URL-scoped profile/partition cookies, and evaluates local/session storage for the current origin. The runner-only `applyStorageStateForTestRun(state)` validates `{ cookies, origins }`, sets cookies before navigation, serializes only origin/key/value data into an init source, registers it with the US-2165 main registry, and returns the opaque F1 registration ID (never the source). `ctx.openBrowser()` calls `navigateAndWait()` and removes that ID immediately in `finally` when navigation settles, including timeout/failure. A redirect or early reload before then may run the source again; it only rewrites supplied values for an exact matching origin. Never include the source or values in thrown errors or log events.

5. **Add the storage helpers in a small nested facade.** Create `src/renderer/editors/browser/BrowserStorageFacade.ts` to own `storage.clear` and `storage.set`, validation of `area`/key/value/prefix, and page-side execution. Reuse `agentMayAccessBrowserPage()` and the existing evaluator; do not apply the test-power predicate. Compose the state and helper collaborators from `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` using narrow delegation. Name the runner-only members consistently: `adoptForTestRun()`, `releaseFromTestRun()`, and `applyStorageStateForTestRun(state)`. Give each `IAiMember` summary the `Web-app test runner:` prefix and set `hidden: true`, following `BROWSER_PLAYWRIGHT_ALIAS_MEMBERS` and the facade's hidden-member behavior so these remain callable but are omitted from `$help` member lists. The existing 1.61.0 history paragraph still records them because they remain call-tree members. Add the public types in `src/renderer/api/types/browser-editor.d.ts`; extend help and signatures without duplicating behavior rules in the facade.

6. **Use the existing cross-process boundary.** Add typed storage cookie operations to `src/ipc/browser-ipc.ts`, dispatch them from `src/ipc/main/cdp-handlers.ts`, compose the new module in `src/main/cdp-service.ts`, and add `CdpSession` convenience methods in `src/renderer/automation/CdpSession.ts`. Reuse `BrowserChannel`, existing typed invoke/reply, `CdpTarget`, and error unwrapping. Add no new correlator, event channel, error envelope, frame method map, or storage-specific protocol. Keep imports within the enforced zones; do not use `await import()`.

7. **Apply state before the first navigation and support file input.** Extend `ctx.openBrowser()` options in `src/test-host/context.ts` and `src/test-host/context-operations.ts`, and its implementation in `src/test-host/browser-helpers.ts`, to accept `storageState: StorageState | string`. After creating the browser page and recording ownership, load/validate a path (relative to `path.dirname(identity.file)`, exactly like `ctx.file`) or validate the object, call `applyStorageStateForTestRun(state)` on the still-un-navigated tab, then call `navigateAndWait(url)`. Remove its returned init ID immediately in `finally` when navigation settles. Do not make the initial `showBrowserPage()` call navigate. State file contents and object payload must not appear in helper errors or cleanup logs.

   Before:

   ```js
   const site = await ctx.openBrowser(url);
   await site.evaluate(() => localStorage.setItem("token", token)); // too late for app startup
   ```

   After:

   ```js
   const site = await ctx.openBrowser(url, {
     storageState: ctx.file(".local-test-state/auth.json"),
   });
   ```

   To save state, tests import `node:fs/promises` and write `JSON.stringify(await site.storageState(), null, 2)` to `ctx.file(...)`. `storageState()` reads the browser profile/partition cookies for the current URL. Applying them with a persistent profile can overwrite and persist the user's cookies for that domain; recommend `incognito: true` for a disposable in-memory session or a dedicated profile when persistence is needed. State files contain sign-in tokens: put them in a directory already ignored by the user's repository, keep them local, and do not add or edit this repository's `.gitignore`.

8. **Implement systematic logging redaction.** Add `src/test-host/storage-state-redaction.ts` as the owner of sensitive-path classification, count-only summaries, and a per-run registry of exact cookie/local/session values. Put tuning values in a `TUNING_CONSTANTS` block in that file, including `MIN_SECRET_LENGTH_FOR_REDACTION = 8`; do not register shorter strings, `true`/`false`/`null`/`undefined`, or numeric strings as exact secrets, to avoid noisy matches such as replacing `blue`, `1`, or `en` throughout reports. `src/test-host/test-log.ts` owns one redactor for the run; `src/test-host/context-operations.ts` registers each `storageState()` reply, state loaded for application, and `storage.set` value before returning from the call. Classify by trailing member path regardless of a `windows[n].` or `pages["id"].` prefix: `…editor.storageState`, `…editor.storage.set`, `…editor.addInitScript`, and `…editor.applyStorageStateForTestRun`. Calls through `ctx.call(path, args)` and `ctx.app` stand-ins preserve their path through the same `McpClient` and `step-format.ts` / `context-operations.ts` flow, so they use the same classifier. Reuse the redactor in:
   - `src/test-host/step-format.ts` and `src/test-host/test-log.ts` so state arguments, `storage.set` arguments only, apply arguments, init-script source, and `storageState()` replies become only a count/size summary;
   - `src/test-host/context-operations.ts` so step results use path-aware summaries and error fields are scrubbed before `tests.log` writes them;
   - `src/test-host/client.ts` so errors never append a raw storage-state reply or sensitive request arguments;
   - `src/test-host/results.ts` so report JSON/Markdown fields cannot serialize a secret-bearing runner error;
   - `src/test-host/failure-bundle.ts` so diagnostic text is scrubbed before serialization (the bundle must never add a storage-state read or payload itself);
   - `src/test-host/runner.ts` and `src/test-host/results.ts` so the same run-scoped redactor is supplied when report JSON/Markdown is written.

   On the app side, update `src/renderer/api/mcp/request-log.ts` to use the same trailing-member classifier and redact `params.args`/`params.value`, the result, and any error before adding the entry to history or the MCP Server Log. For `…editor.storage.set`, redact arguments only because the reply contains no storage value. `src/renderer/api/mcp/mcp-call-rpc.ts` remains the call boundary and should pass the normal result to the caller; its logger receives only the sanitized projection. Include `addInitScript` because the registered source carries values. Do not log cookies, storage keys/values, file contents, or source; only counts/lengths may be shown. `src/main/test-mode/TestModeLog.ts` remains metadata-only for network events and console capture; do not add storage payload capture there.

9. **Extend the existing bridge paragraph and update guides with implementation.** Keep `src/shared/board-bridge-version.ts` at the version US-2165 selects, `1.61.0`. Extend the existing Bridge 1.61.0 paragraph in `assets/guides/agents/boards/bridge-versions.md` with `storageState`, `storage`, and the hidden runner-only members because the generic board call tree exposes browser-editor members; do not create another version bump or history paragraph. At implementation update `assets/guides/agents/browser.md`, `assets/guides/agents/browser-automation.md`, `assets/guides/agents/web-app-tests/index.md`, `assets/guides/agents/web-app-tests/call-boundary-and-examples.md`, and `assets/guides/agents/web-app-tests/attached-runs-and-results.md`. Explain current-origin capture, one-navigation apply and redirect behavior, cleanup/adoption rules, how to save with `fs/promises` and `ctx.file`, and that state files are secrets kept in an existing git-ignored folder. Explicitly warn that `storageState()` reads profile/partition cookies for the current URL and applying on a persistent profile can overwrite and persist the user's domain cookies; recommend `incognito: true` for a disposable session or a dedicated profile when persistence is needed, while leaving persistent profiles supported. No `.gitignore` edit.

## Concerns

- **Cookie scope and persistence.** The CDP target/session identifies where the command is routed; it does not make cookies tab-private. `Network.getCookies({ urls })` reads the associated browser profile/partition's cookies applicable to the current URL, including HttpOnly cookies. `Network.setCookies` writes that same profile/partition jar. A persistent profile therefore exposes and mutates the user's cookies for that domain, and a set may persist after the test. Keep persistent profiles supported; the guide recommends `incognito: true` (an in-memory session discarded with its page) or a dedicated profile when the suite needs isolation.
- **Resolved: no explicit Network enable for cookie commands.** `Network.getCookies` and `Network.setCookies` do not require an explicit `Network.enable`. The current generic browser `cdp-service.cdpSend()` path already calls `ensureNetworkCollector()`, which enables Network using `CdpTarget.enableDomain("Network")`; that helper sets 20 MB total and 1 MB per-resource body buffers. The storage feature must not call `Network.enable` or initialize the collector just for cookie operations. If it reuses generic `cdpSend`, collector activation is existing behavior, not a cookie requirement.
- **Resolved: origins are the current origin only for capture.** This gives a deterministic single-page snapshot while retaining Playwright's `origins` list shape. Applying a state may include multiple serialized origins, but only an origin exactly matching the destination document is written by the init script.
- **Accepted: redirects and early reloads can reseed.** The init script stays registered until `navigateAndWait()` settles and the runner removes its ID immediately in `finally`. A redirect or reload before that call settles may run the script again on a matching origin; it only rewrites the supplied local/session values. No self-removal wrapper or second registry is added.
- **Resolved: no runner state-save API.** Test files already execute as Node modules, `ctx.file()` resolves next to the suite file, and Node `fs/promises` is available to the test itself. A second file API would duplicate that capability.
- **Access limitation.** Adoption does not sandbox MCP clients. It marks the page as intentionally selected for this test run, matching Decision 3; private pages opened by the user remain refused. Keep the denial in the shared predicate so later test powers cannot drift.
- **Runner process termination.** If the test-runner process dies before it calls `releaseFromTestRun()`, the ephemeral adoption flag remains on that live page until the page is restored or closed. This is accepted because the flag only widens test powers on a page that the run explicitly selected; the flag is not persisted and restore initializes it false.
- **Secret boundary.** Automatic framework logs and reports redact sensitive member paths and source arguments, and the runner's per-run redactor removes registered cookie/Web Storage values of at least eight characters from captured errors and diagnostics while skipping common literals and numeric strings. The app request log must redact before retaining entries, not only when rendering the log page. Test-authored output outside runner-controlled logging remains the test author's responsibility.
- **Compatibility.** `storageState` values are JSON and Web Storage values are strings. Reject unsupported values with short validation errors that do not echo the invalid value. Storage seeding is limited to top-level documents covered by the browser target's existing Page session; use the existing F1 scope and do not add OOPIF protocol machinery here.

## Acceptance Criteria

- `agentMayUseBrowserTestPower()` is the sole predicate for F2/F3/F4/F5 test powers and composes `agentMayAccessBrowserPage()`; its refusal names `ctx.openBrowser()` and `ctx.usePage()`. US-2167, US-2168 and US-2169 reuse it unchanged.
- The three runner-only browser-editor members are named `adoptForTestRun()`, `releaseFromTestRun()`, and `applyStorageStateForTestRun(state)`. Their summaries start with `Web-app test runner:` and each descriptor has `hidden: true`, so they are available to runner call paths but omitted from `$help` member lists.
- `ctx.openBrowser()` pages in normal profiles have `openedByAgent === true`; this was verified from `ScriptContext` → `AppWrapper` → `PageCollectionWrapper` → `showBrowserPage()` → `BrowserEditor.configureMode()`. `ctx.usePage()` adopts through a runner-only member; user-opened incognito/Tor pages are refused. Adoption is ephemeral, released by cleanup, and false after browser restore.
- `editor.storageState()` returns `{ cookies, origins: [{ origin, localStorage, sessionStorage }] }`; capture uses `Network.getCookies` for the selected tab's current URL and page evaluation for current-origin storage. It includes HttpOnly cookies and does not read unrelated URLs.
- `ctx.openBrowser(url, { storageState })` accepts a validated object or JSON file path; relative file paths resolve beside the suite file. Cookies are set through the selected tab's CDP Network session before navigation, and local/session storage is written at document start only for matching origins via US-2165. The temporary init registration is removed after the initial commit and on all failure paths.
- `editor.storage.clear({ prefix?, area? })` and `editor.storage.set(key, value, { area? })` work for local (default) and session storage, follow normal page access, and are not blocked by the test-power gate. No `get`/`keys` surface is added.
- The API and runner delegation live in new collaborators; `BrowserWebviewModel.ts` does not grow. `cdp-service.ts` gains composition only. IPC reuses existing service channel, typed RPC, `PendingRequests`/wire error where already applicable, and `CdpTarget`; no new protocol, board rule outside shared/board registries, import-zone workaround, or `await import()` is introduced.
- The runner's `tests.log`, `report.json`, `report.md`, step/error logs, and failure bundles never contain storage-state payloads, `storageState()` replies, the state-application arguments, or init-script source. They may contain count/size summaries. The app MCP request log also redacts call arguments and replies before storing/rendering them.
- Storage-state values and init source do not enter `TestModeLog` console/network entries. Network logs remain free of request/response bodies and headers.
- The existing Bridge 1.61.0 history paragraph is extended for the board-callable browser-editor surface; the version is not bumped again.
- The listed browser and web-app-test guides explain the APIs, save/load example, private-page rule, secret handling, and existing git-ignored-folder requirement. They also warn that persistent-profile cookie application can overwrite and persist the user's domain cookies, recommend incognito or a dedicated profile for isolation, and do not refuse persistent profiles. No repository `.gitignore` is changed.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2166-storage-state/README.md` | This implementation brief. |
| `doc/epics/EPIC-207.md` | Link US-2166 in the Linked Tasks table. |
| `doc/active-work.md` | Link the existing EPIC-207 US-2166 entry to this brief. |
| `src/renderer/editors/browser/agent-access.ts` | Add the shared test-power predicate and refusal. |
| `src/renderer/editors/browser/browser-state.ts` | Add ephemeral test adoption state; default false. |
| `src/renderer/editors/browser/BrowserTestPowerAdoption.ts` | New collaborator to adopt/release a page for a test run. |
| `src/main/cdp/cdp-storage-state.ts` | New per-target CDP cookie capture/set owner. |
| `src/main/cdp-service.ts` | Compose cookie operations only. |
| `src/ipc/browser-ipc.ts` | Add typed CDP storage operations on the existing browser channel. |
| `src/ipc/main/cdp-handlers.ts` | Dispatch storage operations to the CDP service. |
| `src/renderer/automation/CdpSession.ts` | Add convenience methods using existing typed RPC. |
| `src/renderer/editors/browser/BrowserStorageState.ts` | New renderer capture/apply workflow using CDP and US-2165. |
| `src/renderer/editors/browser/BrowserStorageFacade.ts` | New nested local/session storage helper owner. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Compose collaborators and describe public/runner-only members. |
| `src/renderer/api/types/browser-editor.d.ts` | Add `storageState` and nested `storage` types. |
| `src/test-host/context.ts` | Type `ctx.openBrowser` storage-state input. |
| `src/test-host/context-operations.ts` | Pass suite-file base and options; use sensitive result summaries. |
| `src/test-host/browser-helpers.ts` | Load/apply state before navigation; adopt/release pages and clean temporary scripts. |
| `src/test-host/storage-state-redaction.ts` | New trailing-member classifier, summary helper, tuning constants, and run-scoped exact-value scrubber. |
| `src/test-host/client.ts` | Prevent sensitive arguments/replies in formatted errors. |
| `src/test-host/step-format.ts` | Redact sensitive member arguments. |
| `src/test-host/test-log.ts` | Redact sensitive result previews and step payloads. |
| `src/test-host/results.ts` | Sanitize result/report fields before writing. |
| `src/test-host/runner.ts` | Pass the run-scoped redactor to report serialization. |
| `src/test-host/failure-bundle.ts` | Scrub diagnostic text before bundle serialization. |
| `src/renderer/api/mcp/request-log.ts` | Redact MCP call params, results and errors before retention. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend the existing 1.61.0 history paragraph, no new bump. |
| `assets/guides/agents/browser.md` | Document browser storage state and helper behavior. |
| `assets/guides/agents/browser-automation.md` | Document capture/apply and storage helper examples. |
| `assets/guides/agents/web-app-tests/index.md` | Document state-file handling and test-run behavior. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | Add typed test API and fs save/load examples. |
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md` | Explain `ctx.usePage()` adoption and cleanup behavior. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | No changes; roadmap §2.3 god file. |
| `src/test-host/test-attempt.ts`, `src/test-host/test-file-run.ts` | No changes; they already pass session-page ownership to `closePagesOpenedSince()`. |
| `src/main/test-mode/TestModeLog.ts` | No changes; it does not log MCP params or replies, and storage payloads are not added to console/network events. |
| `.gitignore` | No changes; state files go in an existing git-ignored local directory. |
| `src/shared/board-bridge-version.ts` | No changes in this task; US-2165 performs the EPIC-207 1.61.0 bump. |
