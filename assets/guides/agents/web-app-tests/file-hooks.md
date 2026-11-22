---
title: "Web-app test file hooks"
audience: agent
summary: "Set up and tear down shared state for a .test.mjs file with bounded lifecycle hooks."
---

# Web-app test file hooks

Return to [Web-app regression tests](./index.md) for runner setup and commands.

## Declare hooks

Export named functions from a `.test.mjs` file. Each hook receives a test context and may return a
promise. If a hook name is exported, its value must be a function.

```js
let dashboardUrl;

export async function beforeAll(ctx) {
  const page = await ctx.openBrowser("https://example.test/dashboard", { profile: "qa-browser" });
  dashboardUrl = await page.url;
}

export async function beforeEach(ctx) {
  const page = await ctx.usePage({ url: dashboardUrl });
  await page.waitFor({ selector: "[data-testid='dashboard']" });
}

export async function afterEach(ctx) {
  await ctx.call("pages.activePage.editor.clearTransientSelection", []);
}

export async function afterAll(ctx) {
  // File-owned pages are closed by the runner after this hook.
  ctx.log("dashboard file finished");
}

export default [
  test("shows the account summary", async (ctx) => {
    const page = await ctx.usePage({ url: dashboardUrl });
    ctx.expect(await page.title).toContain("Dashboard");
  }),
];
```

`beforeAll` and `afterAll` each get a separate context. Every attempt gets one context shared by
`beforeEach`, the test body, and `afterEach`. A retry creates a fresh attempt context and repeats
both per-test hooks. A stand-in belongs to the context that created it. Pass plain IDs, URLs, or
flags through module variables and re-read the page with `ctx.usePage()` or `ctx.app.pages[…]`;
do not store and reuse a stand-in from another hook. Setup extensions from `--test-setup` are
applied once to each hook context and attempt context.

## Selection and ordering

The runner applies the test selection manifest, `--grep`, saved rerun selection, `test.only`,
`test.skip`, missing `requires` tags, and the attached `launch` restriction before it decides
whether to run file hooks. A file with no runnable selected tests does not run any hooks. Skipped
tests remain skipped if `beforeAll` fails. When `beforeAll` fails, runnable selected tests are
`not-run` with reason `beforeAll failed`; `afterAll` still runs unless the environment stopped.

For each runnable descriptor, the order is `beforeEach`, body, failure capture on the first error,
`afterEach`, then per-attempt page cleanup. `afterEach` runs even when `beforeEach` or the body
fails or times out. Retries repeat the sequence. File hooks run once per file, around all selected
attempts. Pages opened in `beforeAll` remain open during every attempt and are cleaned after
`afterAll`.

## Timeouts and failures

The per-attempt timeout covers `beforeEach` and the body; `afterEach` gets a fresh bound of the
same scaled duration. `--test-timeout 0` leaves both unbounded. File hooks use the scaled run-level
`--test-timeout` (default 300,000 ms); a descriptor timeout does not override it. Failure capture
and page cleanup keep their independent bounds. The runner cannot cancel an MCP request already in
flight, synchronous JavaScript loops, or work an extension starts outside guarded context APIs.

Hook failures retain their original error and stack. A normal throw with a test-file stack frame
shows its file and line; a timer-created timeout may only identify the file and last step. An
`afterEach` failure is primary when the test body passed. When the body already failed, the
`afterEach` error and location are listed under cleanup errors. An `afterEach`-only failure on
`test.fails` remains a real failure. Hook pseudo-results use the names `<beforeAll>` and
`<afterAll>`; file cleanup errors are reported on `<afterAll>`, even if that export is absent.

## Page ownership and attached runs

File ownership starts before `beforeAll`. In owned and runner-created windows, the baseline page
diff cleans up file pages. In `--attach --window` mode, pages opened through `ctx.openBrowser` are
owned; adopted pre-existing pages remain protected. If a hook adopts a page opened by another file
hook, the file still closes that owned page after `afterAll`. New popups on owned and adopted pages
are included in cleanup. A stopped or replaced test window ends the run without starting more
hooks or attempting cleanup that needs the stopped environment.

## Reruns and diagnostics

Failed `<beforeAll>` and `<afterAll>` identities are saved in version 1 `last-failed.json`.
`--rerun-failed` expands either identity to the discovered tests in its file, then applies normal
filters and skip rules. A missing file is reported as stale. Real test descriptors using either
reserved-looking name conservatively select the whole file too.

`tests.log` includes `hook-start` and `hook-result` events with file, identity, hook, duration,
success or error, and step; per-attempt hooks also include the attempt number. `report.md`,
`report.json`, and the console show failed hook pseudo-results, locations, captures, cleanup notes,
and `not-run` reasons. See [attached runs and results](./attached-runs-and-results.md) for report
and log locations.
