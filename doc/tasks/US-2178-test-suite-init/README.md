# US-2178: `persephone-test --init <folder>` starter suite

Epic: [EPIC-209: Guides and scaffolding for web-app tests](../../epics/EPIC-209.md), proposal H4.

## Goal

Add `--init <folder>` and `--init=<folder>` to create a generic, offline starter suite and exit with status 0 before a test host or window starts. If the destination exists and contains any files, create nothing, list every conflicting file on stderr, and exit with status 1. This document is the implementation plan and the complete proposed contents of every generated file.

## Background

### Verified startup and exit path

`launcher/src/test_main.rs::main` prepends `--test`, forwards every user argument to the sibling `persephone.exe`, waits with `Command::status()`, and returns that process's exit code (or 1 for a signal/start failure). `src/main.ts` parses the profile first, then calls `parseTestControllerArguments(profile.remainingArgs)` and branches to `startTestController()` before `startWithProfile()` can call `setupMainProcess()`. The test controller does not create a `BrowserWindow`; after its utility test host finishes, `src/main/test-mode/controller.ts::startTestController` calls `app.exit(exitCode)` from `finally`. Therefore init must be dispatched in the main-process branch before `startTestController`, and should use `app.exit(0|1)` after writing. This preserves the no-window behavior and makes the launcher receive the exit status.

`src/main/test-mode/arguments.ts` owns test CLI parsing. Its existing parser supports separate and equals forms, resolves paths from `cwd`, and rejects missing values and duplicate options. Add an independent init-options parser there; do not make init require `--test`, since init is a standalone operation. `src/main.ts` is the dispatch point and must route init before controller parsing/launch. The new `src/main/test-mode/init-suite.ts` owns destination validation, conflict listing, copying and the init exit result. It reuses Node `fs/promises` and `path` in the main process, and existing `errMessage` from `src/shared/utils.ts` for errors. It does not add a protocol or grow a roadmap §2.3 god file.

The runner's `src/test-host/test-descriptor-validation.ts::validateTestDescriptors` requires each `.test.mjs` module to default-export a descriptor or non-empty descriptor array; the in-app example is in `assets/guides/agents/web-app-tests/index.md`. The test context surface is defined by `src/test-host/context.ts` and implemented by `src/test-host/context-operations.ts`: `ctx.openBrowser(url)`, `ctx.call(path, args?, options?)`, `ctx.expect.poll(callback, options?).<matcher>()`, and `ctx.file(relative)` are present. `ctx.file(relative)` is intentionally unavailable in file hooks, so suite-relative fixture paths come from the `lib/` module's `import.meta.url` using Node's `fileURLToPath(new URL(relative, import.meta.url))`. `src/test-host/browser-helpers.ts::openBrowser` returns a browser editor stand-in with local `pageId` metadata. The stand-in can call facade members directly: `browser-helpers.ts::editorHandle` returns `context.handle(page["editor"], { pageId })`, and `src/test-host/app-proxy.ts::createNode` forwards chained member and method paths. `BrowserEditorFacade` exposes `navigateAndWait`, `click`, `type`, `attachTestExtension`, and the dynamically supplied `app` member when a page model is registered. Selector parsing in `src/renderer/automation/page-scripts.ts::parseStep` recognizes `role=` and `label=`; the `name` role attribute is parsed by `parseRole`. `src/test-host/poll-expect.ts::PollOptions` accepts `timeout`, `interval`, and `message`.

`src/renderer/editors/browser/SiteExtensionInjection.ts::temporarySiteExtensionPredicate` matches only `http:` and `https:` documents. The temporary extension attaches to the exact host authority and injects on a matching loaded page or its next navigation. The suite therefore serves its shipped `site/index.html` over loopback HTTP from a Node `http` server started in `beforeAll` and closed in `afterAll`; it needs no network access beyond loopback. `ctx.openBrowser("about:blank")`, attach to `127.0.0.1:<ephemeral-port>`, then `navigateAndWait(url)` ensures injection on the fixture.

The temporary extension model is attached through pages[pageId].editor.attachTestExtension({ host, scriptPath }), then called at pages[pageId].editor.app.<method>. src/site-extension-runtime.ts:43-47 implements runtime.expose(root), also described in assets/guides/agents/site-extensions.md; assets/guides/agents/temporary-site-extensions.md documents temporary extension host matching and injection. TemporarySiteExtensions.attach() now accepts a file, list, or folder through resolveTemporaryExtensionSources() in src/renderer/editors/browser/temporary-extension-sources.ts as planned in US-2176. This task deliberately uses a model/ folder containing 00-base.js and 10-app.js, per US-2176 shared-scope, name-ordered folder behavior; the epic's folder choice supersedes the review's single-file model/app-model.js sketch.

`src/test-host/expect.ts` owns immediate matchers and `src/test-host/poll-expect.ts::createPollExpect` owns async polling matcher construction. The test uses `ctx.expect.poll(() => site.app.items(), { timeout, message }).toEqual(...)`; it does not use sleeps. `src/test-host/file-hooks.ts::readFileHooks` recognizes `beforeAll`, `beforeEach`, `afterEach`, and `afterAll` exports.

### Assets and result locations

Use `assets/test-suite-template/` for generated template files. This follows existing static asset conventions: `electron-builder.yml` copies the entire `assets/` tree to packaged `resources/assets`; `src/main/utils.ts::getAssetPath()` resolves `process.resourcesPath/assets` when packaged and `<repo>/assets` in development. The init module reads source files from `getAssetPath("test-suite-template", ...)`, so the same asset path rule works in both layouts. Unlike generated app assets, no build-time copy step is needed.

The current `assets/guides/agents/web-app-tests/run-options.md` already documents the developer invocation `electron . --test <suite>` from the repository root, explains that `persephone.exe` is a GUI-subsystem process, and states that the launcher returns the app exit code. The proposed exact dev init command is `electron . --test --init .\web-test-starter`. In the generated suite, `run-tests.ps1` resolves the runner from `PERSEPHONE_TEST_EXE` first and then `Get-Command persephone-test.exe`; if neither resolves, it prints a direct setup message and exits 1. The run script passes the suite folder and optionally `--reporter json-lines` (US-2177). Default reports go to `test-results/` beside a test file or within the suite folder, per `run-options.md`; the guide brief directs authors to that output and explains `--log-dir` and `--log` behavior.

## Implementation Plan

1. **CLI ownership — `src/main/test-mode/arguments.ts`.** Add `InitSuiteArguments` and `parseInitSuiteArguments(args, cwd)` for `--init <folder>` and `--init=<folder>`. Resolve relative destinations against `cwd`; reject duplicates, missing values, and values beginning with `--`. Ignore exactly one `--test` marker because `persephone-test.exe` prepends it and the developer command includes it; reject unrelated test options. Init remains standalone and does not require a test path. Add init recognition to the test-mode option detector only if needed to keep the entry dispatch clean; regular test parsing stays unchanged.

   Before:

   ```ts
   const testArguments = parseTestControllerArguments(profile.remainingArgs);
   if (testArguments) void startTestController(profile, testArguments);
   else startWithProfile(profile);
   ```

   After: parse init first and call its single-job handler; only fall through to the existing test-controller/profile branches when init is absent.

2. Init behavior owner: src/main/test-mode/init-suite.ts exports initializeTestSuite(destination). If the destination exists and is not a directory, print "Cannot initialize starter suite: destination is not a directory: <destination>" and return 1. If it is a directory, compare contents with the template before writing: report each existing template-relative path as "Conflict: <relative-path>"; when the directory has entries but none overlap the template, print "Cannot initialize starter suite: folder is not empty: <destination>". In either non-empty case, write no files and return 1. For an absent or empty destination, create parent/destination directories and copy using fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false }). After success, print "Created: <relative-path>" for each generated file and then "Next: run <destination>\run-tests.ps1". For copy or other I/O errors, print "Could not initialize starter suite at <destination>: <errMessage(error)>" and return 1. This module owns conflict rules, messages, copy, and success output; do not duplicate them in main.ts or argument parsing.

3. **Main-process dispatch — `src/main.ts`.** After profile parsing and before `parseTestControllerArguments`/`startTestController`, detect `--init` in `profile.remainingArgs`, parse it using `profile.remainingArgs` and original working directory, call `initializeTestSuite`, and invoke `app.exit(code)`. Catch parse errors in the existing startup error boundary and print them to stderr with exit 1 when an init option was present. Do not invoke `setupMainProcess`, create a window, or fork the test host for init. Preserve normal `--test` behavior.

4. **Template source — new `assets/test-suite-template/`.** Store actual files rather than embedded strings. The initializer uses `getAssetPath()` and recursively copies this tree while preserving relative paths. Proposed full file contents are below. The suite is generic and uses only mock content.

5. Suite test API calls: smoke.test.mjs default-exports a non-empty descriptor array as required by the runner. Its beforeAll starts the fixture server using suitePath() rather than ctx.file(); it opens about:blank with ctx.openBrowser, attaches the model directly with site.attachTestExtension, navigates with site.navigateAndWait, calls site.app.heading() and site.app.items() through the editor stand-in, fills and submits with site.type and site.click, and verifies changing list state through ctx.expect.poll({ timeout, message }). ctx.file() remains unused in file hooks. No Playwright locator object, Node test runner API, or page DOM access from the test is introduced.

6. Shared-scope model: model/00-base.js owns small DOM text helpers in the shared injection scope. model/10-app.js uses those helpers for heading() and items() and exposes the model at initial script evaluation with window.__persephoneSiteRuntime.expose({...}); it does not call remote.refresh() because that is for a model exposed late. Since scriptPath is a folder, US-2176's resolver loads direct .js files in name order into one shared scope. The test calls heading() once to exercise the cross-file helper; assertions stay in tests while the model owns page reads and actions.

7. **Run option guide — assets/guides/agents/web-app-tests/run-options.md.** Add a concise Initialize a starter suite entry with the packaged command persephone-test.exe --init <folder>, equals form, refusal semantics, and developer command electron . --test --init .\web-test-starter. Keep the broader guide rewrite in US-2179. Claude must verify the developer command live; Codex cannot start Persephone.

8. **Before/after CLI contract.**

   ```text
   Before: persephone-test.exe .\web-tests
           (all arguments are test-controller options; --init is rejected)
   After:  persephone-test.exe --init .\web-test-starter
           creates the starter files and exits 0 without starting the test host/window
           persephone-test.exe --init .\web-test-starter
           when non-empty: lists relative conflicts on stderr, writes nothing, exits 1
   ```

9. **No-change list.** Do not edit `launcher/src/test_main.rs` (it already forwards arguments and returns the child status), `src/test-host/` (the API used by this suite exists), `src/renderer/editors/browser/SiteExtensionInjection.ts` (HTTP matching already exists), `src/renderer/editors/browser/TemporarySiteExtensions.ts` (folder support belongs to US-2176), `electron-builder.yml` (it already includes the entire assets tree), `scripts/build-prod.mjs` (assets are not generated there), `doc/active-work.md` (the epic task entry already exists), or the full web-app test guide (US-2179 owns it).

10. Verification after implementation: use temporary empty and populated destinations to verify both flag forms, exact error output, no writes on conflicts, and exit codes; verify init starts neither the test host nor an app window. Claude must live-verify electron . --test --init .\web-test-starter from a dev checkout and confirm generated files/status 0; Codex cannot start Persephone. Run the generated suite with electron . --test .\web-test-starter --reporter json-lines and confirm the offline smoke test, report.json, and JSONL output. Also run npm run lint and npm run typecheck; do not use build-prod because EPIC-209 decision 7 forbids it during this work.

### Proposed generated files (complete contents)

#### `tests/smoke.test.mjs`

```js
import { startStaticServer, suitePath } from "../lib/static-server.mjs";

let server;
let baseUrl;

export async function beforeAll() {
    server = await startStaticServer(suitePath("../site"));
    baseUrl = server.url;
}

export async function afterAll() {
    await server?.close();
}

export default [
    test("the shipped mock page accepts and lists an item", async (ctx) => {
        const site = await ctx.openBrowser("about:blank");
        await site.attachTestExtension({
            host: new URL(baseUrl).host,
            scriptPath: suitePath("../model"),
            name: "Mock page model",
        });
        await site.navigateAndWait(baseUrl);

        ctx.expect(await site.app.heading()).toBe("Mock list");
        await site.type("label=New item", "Offline check");
        await site.click('role=button[name="Add item"]');

        await ctx.expect.poll(() => site.app.items(), {
            timeout: 5000,
            message: "The page model should report the submitted item",
        }).toEqual(["Offline check"]);
    }),
];
```

API/source references: default-export validation is `src/test-host/test-descriptor-validation.ts:7-13`, the global `test` assignment is `src/test-host/index.ts:24`, and the supported export example is `assets/guides/agents/web-app-tests/index.md:65-70`. File hooks are declared in `src/test-host/file-hooks.ts:5-8` and read by `readFileHooks()` at `file-hooks.ts:10-24`; their context is declared at `src/test-host/context.ts:11-28`. `ctx.openBrowser` is declared in `context.ts:14` and implemented in `src/test-host/context-operations.ts:173-177`; its page editor handle and `pageId` metadata come from `src/test-host/browser-helpers.ts:284-288`. `site.navigateAndWait(url)` is a real `BrowserEditorFacade` member at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:82,470-473`; `site.type(locator, text)` and `site.click(locator)` are members at `BrowserEditorFacade.ts:604,610`, with selectors dispatched by `src/renderer/automation/page-scripts.ts:40-51` (`role=`/`label=`) and `page-scripts.ts:156-190` (`role` name parsing). Direct `site.attachTestExtension(options)` is declared at `BrowserEditorFacade.ts:58` and implemented at `:670-673`. `site.app` is the conditional `APP_MEMBER` at `BrowserEditorFacade.ts:28-35`, provided after remote model registration at `:337-346`. The `.app.items()` and `.app.heading()` chains work through the returned app stand-in: `browser-helpers.ts:284-288` wraps the editor with `ctx.handle`, and `src/test-host/app-proxy.ts:18-19,41-44,64-67,78-99` carries chained properties and method calls to the call path. `ctx.expect.poll` options are exactly `timeout`, `interval`, and `message` in `src/test-host/poll-expect.ts:10,14-16`; the test's form follows the documented polling API in `assets/guides/agents/web-app-tests/call-boundary-and-examples.md:45-75`.

#### `site/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mock list</title>
</head>
<body>
  <main>
    <h1>Mock list</h1>
    <form id="item-form">
      <label>New item <input name="item" autocomplete="off"></label>
      <button type="submit">Add item</button>
    </form>
    <ul aria-label="Items"></ul>
  </main>
  <script>
    const form = document.querySelector("#item-form");
    const input = form.querySelector("input[name='item']");
    const list = document.querySelector("ul");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
      input.value = "";
    });
  </script>
</body>
</html>
```

#### `model/00-base.js`

```js
const mockPage = {
    text(selector) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Expected mock page element: ${selector}`);
        return element.textContent.trim();
    },
    texts(selector) {
        return Array.from(document.querySelectorAll(selector), (element) => element.textContent.trim());
    },
};
```

#### `model/10-app.js`

```js
window.__persephoneSiteRuntime.expose({
    heading() {
        return mockPage.text("h1");
    },
    items() {
        return mockPage.texts("ul[aria-label='Items'] li");
    },
    // Required: expose() rejects a root without an aiVision descriptor
    // ("The exposed root must carry an AiVision descriptor." — verified live by Claude).
    aiVision: {
        kind: "MockListPage",
        summary: "Test model of the starter suite's mock list page.",
        members: [
            { name: "heading", kind: "method", signature: "heading()", summary: "The page heading text." },
            { name: "items", kind: "method", signature: "items()", summary: "The list item texts, in order." },
        ],
    },
});
```

#### `lib/static-server.mjs`

```js
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function suitePath(relative) {
    return fileURLToPath(new URL(relative, import.meta.url));
}

export async function startStaticServer(siteDirectory) {
    const html = await readFile(path.join(siteDirectory, "index.html"));
    const server = createServer((request, response) => {
        if (request.url !== "/" && request.url !== "/index.html") {
            response.writeHead(404).end("Not found");
            return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        await new Promise((resolve) => server.close(resolve));
        throw new Error("The local fixture server did not receive a TCP address.");
    }

    return {
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        }),
    };
}
```

#### `run-tests.ps1`

```powershell
param(
    [switch] $JsonLines
)

$runnerPath = $env:PERSEPHONE_TEST_EXE
if (-not $runnerPath) {
    $runner = Get-Command persephone-test.exe -ErrorAction SilentlyContinue
    if ($runner) { $runnerPath = $runner.Source }
}

if (-not $runnerPath -or -not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    Write-Error "Cannot find persephone-test.exe. Add it to PATH or set PERSEPHONE_TEST_EXE to its full path."
    exit 1
}

$suiteDirectory = $PSScriptRoot
$arguments = @($suiteDirectory)
if ($JsonLines) { $arguments += @("--reporter", "json-lines") }

& $runnerPath @arguments
exit $LASTEXITCODE
```

#### `AGENTS.md`

```markdown
# Web-app test suite notes

This suite tests the local mock page in `site/index.html`. Keep its data synthetic and offline.

## Model and test responsibilities

- Put reusable page reads and page actions in `model/`; return bounded content or state.
- Keep expectations and pass/fail decisions in `tests/*.test.mjs`.
- The model folder loads its direct `*.js` files in name order into one shared scope. Keep shared helpers in `00-base.js` and expose the page model from a later file.
- A model call that can navigate must use the call option `{ allowNavigation: true }` at the test call boundary. Start navigation-sensitive waits before the action.

## Pages and windows

- `ctx.openBrowser()` creates a page owned by the run; cleanup closes it. This starter uses that mode and attaches its model to the test-owned page.
- `ctx.usePage()` adopts an existing browser page; cleanup releases adoption but does not close that page. Use it only for a deliberately retained session page.
- An owned run starts its own app and test window. With --attach, the runner selects or creates a test window; MCP must be enabled in the running profile. Keep calls scoped to that window. User pages outside it are not test pages.

## Waiting and assertions

- Use `ctx.expect.poll()` or the browser editor's `waitFor()` for changing page state. Do not add fixed sleeps.
- Use browser editor locator actions (`site.click`, `site.type`) for input; model methods return page state for assertions.

## Run and results

- Run `./run-tests.ps1`; add `-JsonLines` to request `--reporter json-lines`. Set `PERSEPHONE_TEST_EXE` or put `persephone-test.exe` on `PATH`.
- For an owned run, use `--test <suite-folder>`. For an existing signed-in browser session, use `--attach --window <index-or-title>` and `ctx.usePage()`.
- Default reports and logs are under test-results/ beside a test file or inside the selected suite folder. The test-results/ folder inside this suite is replaced on each run. --log-dir <folder> selects an output folder; --log <file> writes only the step log.
- Read `report.md`, `report.json`, `tests.log`, and failure bundles in the selected output folder.

## Guides

Use the in-app guides instead of copying their full instructions here:

- `guides.agents["web-app-tests"]` (`persephone-guide://agents/web-app-tests`)
- `guides.agents["temporary-site-extensions"]` (`persephone-guide://agents/temporary-site-extensions`)
```

### Short guide addition

Add this concise entry to `assets/guides/agents/web-app-tests/run-options.md`:

```markdown
## Initialize a starter suite

Create a generic offline suite with `persephone-test.exe --init <folder>` or
`persephone-test.exe --init=<folder>`. Init writes into an absent or empty folder; if the folder
contains entries, it lists conflicts on stderr, writes nothing, and exits 1. In a developer checkout,
run `electron . --test --init .\web-test-starter` from the repository root. Init exits without
starting the test host or a window.
```

## Concerns

- **US-2176 sequencing:** the starter depends on folder `scriptPath` resolution loading direct `.js` files in sorted name order into a shared scope. Epic-209 schedules US-2176 first. If its accepted API shape changes, update this plan/template before implementation; the chosen two-file folder model remains the epic decision.
- **US-2177 sequencing:** `--reporter json-lines` is optional in the run script and relies on its already-planned reporter option. The script's default run does not depend on that reporter.
- **Folder conflict policy:** EPIC-209 decision 3 says non-empty destinations refuse overwrite and list conflicts. Report template-relative paths that already exist; if the destination has entries but none overlap template paths, report folder is not empty. An existing non-directory destination gets its own explicit error. All these cases write no template files.
- **Dev command:** existing run-options documentation verifies electron . --test <suite> for developer checkouts. The exact init form electron . --test --init <folder> remains to be live-verified by Claude because Codex cannot start Persephone.
- **Window exit verification:** current code confirms the main test controller exits explicitly with `app.exit(exitCode)` after the host completes, while the launcher waits and returns that exit code. Implementation verification should also run init and confirm no child host/window starts.
- No open product decisions remain. The destination, aliases, refusal behavior, template names, helper ownership, model split, run script discovery policy, and results location are specified here.

## Acceptance Criteria

- [ ] `persephone-test --init <folder>` and `persephone-test --init=<folder>` work; relative folders resolve from the caller's current directory.
- [ ] A new or empty destination receives every proposed template file and exits 0. A non-empty destination receives no writes, lists all conflicting relative paths on stderr, and exits 1.
- [ ] Init prints each created relative path and a final Next line naming run-tests.ps1; conflicts print Conflict: <relative-path>, unmatched non-empty directories print folder is not empty, non-directory targets print the stated non-directory error, and I/O failures print the stated Could not initialize error.
- [ ] Init runs in the main process before test-host startup or any window creation; persephone-test.exe returns the init status. Claude live-verifies electron . --test --init .\web-test-starter from a dev checkout.
- [ ] The generated suite passes offline as written: starts and stops only its loopback static server, uses the local fixture, attaches the two-file model, performs locator actions, polls an assertion, and makes a model call.
- [ ] All template APIs exist in source or are explicitly delivered by the earlier US-2176/US-2177 contracts; API references and the runtime asset resolution are documented above.
- [x] `AGENTS.md` is under 80 lines, generic, and links to the in-app web-app-test and temporary-site-extension guides by object-model names and `persephone-guide://` paths.
- [x] `run-options.md` gets only the short init entry; the full guide rewrite remains US-2179.
- [x] No customer or company project names, new protocol code, god-file growth, `await import()`, import-zone wrapper, or runtime-condition change is introduced.

## Files Changed

| File | Planned change |
|---|---|
| `src/main/test-mode/arguments.ts` | Parse separate and equals init options, resolve destination, reject malformed/duplicate forms. |
| `src/main/test-mode/init-suite.ts` | New single-job owner of destination conflict checks, template copy, diagnostics, and exit result. |
| `src/main.ts` | Dispatch init before test-controller/profile startup and exit with the init result. |
| `assets/test-suite-template/tests/smoke.test.mjs` | Generic offline smoke test using locators, model call, polling assertion, and file hooks. |
| `assets/test-suite-template/site/index.html` | Small mock heading, form, and list fixture. |
| `assets/test-suite-template/model/00-base.js` | Shared model helper in the folder-loaded scope. |
| `assets/test-suite-template/model/10-app.js` | Expose fixture state through a temporary page model. |
| `assets/test-suite-template/lib/static-server.mjs` | One loopback-only helper serving the shipped fixture and closing its Node HTTP server. |
| `assets/test-suite-template/run-tests.ps1` | Find runner from `PERSEPHONE_TEST_EXE` or PATH; optionally request JSONL; preserve runner exit. |
| `assets/test-suite-template/AGENTS.md` | Under-80-line agent brief for suite authoring and run outputs. |
| `assets/guides/agents/web-app-tests/run-options.md` | Add concise `--init` usage and dev command entry. |
| `doc/active-work.md` | No change; EPIC-209 dashboard entry already exists. |
| `launcher/src/test_main.rs` | No change; forwards all arguments and returns the main process status. |
| `src/test-host/**` | No change; this plan uses existing context, hooks, polling, and locator APIs. |
| `src/renderer/editors/browser/SiteExtensionInjection.ts` | No change; existing predicate is HTTP(S)-only. |
| `src/renderer/editors/browser/TemporarySiteExtensions.ts` | No change in this task; folder path handling belongs to US-2176. |
| `electron-builder.yml`, `scripts/build-prod.mjs` | No change; assets are already copied wholesale by electron-builder and resolved by `getAssetPath()`. |

## Verification and fixes (Claude, 2026-11-23)

The shipped files under `assets/test-suite-template/` are authoritative; the proposals above were corrected during
live verification:

- `init-suite.ts`: `fs.cp(..., { errorOnExist: true, force: false })` failed with EEXIST on the destination folder
  itself; the copy is now file by file with `COPYFILE_EXCL`. Init now switches `userData`/`sessionData` to a
  throwaway folder synchronously, as the test controller does, so Chromium never opens the real profile folder
  (before the fix, init printed GPU/disk-cache "Access is denied" errors from the running profile).
- `site/index.html`: `form.elements.item` is `HTMLFormControlsCollection.item()` (a method), not the input; the
  submit handler threw and no item was added. Uses `form.querySelector("input[name='item']")`.
- `tests/smoke.test.mjs`: the first model read right after `navigateAndWait` failed with `"app" is not a member`
  (the model registers shortly after load); the first read is now `ctx.expect.poll(() => site.app.heading())`.
- `model/10-app.js`: the exposed root carries the required `aiVision` descriptor.
- `run-tests.ps1`: remaining arguments pass through to the runner (`./run-tests.ps1 --attach`).

Live: `electron . --test --init <folder>` into an empty folder created 7 files (exit 0); a second run listed 7
conflicts and wrote nothing (exit 1); the generated suite passed attached twice and as an owned run
(`--profile`), with `--reporter json-lines` stdout parsing as JSON only. The run script's missing-runner message
was checked.
