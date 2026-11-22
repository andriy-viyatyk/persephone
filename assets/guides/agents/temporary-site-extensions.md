---
title: "Temporary site extensions for app testing"
audience: agent
summary: "Attach, inspect, replace, and detach a page-scoped test script that runs on matching browser tabs."
---

# Temporary site extensions for app testing

Temporary extensions inject after the matching document loads and provide the host-scoped
`site.app` model and runtime. For code that must run before page-authored scripts, use the separate
browser-editor `addInitScript(source, options?)`, `removeInitScript(id, options?)`, and
`clearInitScripts(options?)` methods. Registration returns an opaque ID; remove returns whether it
existed and clear returns the number removed. Source is limited to 1,000,000 characters and a tab
can hold 50 registrations. Init scripts run unchanged before page scripts on future documents, not
in the current document. They cover the main frame and same-process child frames, but not OOPIFs;
they persist through reload and cross-origin navigation and are cleared when that tab closes. They
pause while DevTools has detached CDP; the next automation call restores registrations before it
runs. For example, `const id = await pages[pageId].editor.addInitScript("window.testMode = true");`.
Init scripts do not create a `site.app` model. See
[Browser](./browser.md#init-scripts-at-document-start) for the full behavior.

Use a temporary extension when a test needs the same page model or site actions on each matching
load. It is kept only in one browser page's memory, does not prompt for saved-extension trust, and
does not receive the privileged cross-host fetch broker. The normal site extension runtime still
provides `expose`, `onDispose`, `setActions`, and `runtime.params`.
It also provides `runtime.ref`, `visible`, `accessibleName`, `setValue`, `waitFor`, and
`afterReturn`, with the same behavior as a saved extension. `runtime.ref(element)` returns a
`{ ref }` locator for a connected element in the main document; return it from a model method and
pass the result to `click()`, `type()`, or another locator action. Use [Page-model runtime helpers](./site-extensions.md#page-model-runtime-helpers)
for signatures and a worked example. `accessibleName` is a page-side approximation; role and name
selector facts come from Chromium's accessibility tree. `afterReturn()` schedules a callback after
the reply is produced on a best-effort basis. Use it to schedule navigation after reply
serialization. If cross-document navigation destroys the in-flight call, `{ allowNavigation: true }`
returns `{ navigated: true }`; it does not recover the original value. The original value is
available only when the reply arrives before navigation.

## Attach an inline script or file

Call the browser page facade directly or through the path-based `call` surface:

```js
const result = await pages[pageId].editor.attachTestExtension({
    host: "localhost:5173",
    scriptPath: "C:/projects/my-app/tests/persephone/app-model.js",
    name: "My app test model",
    params: { scenario: "empty-project" },
});
```

Provide exactly one source:

- `scriptPath` must be an absolute readable file path. It is checked once during attach and read
  again for each injection. Edit the file, then reload the matching tab; do not attach again.
- `scriptPath` can also be a non-empty array of absolute readable files (loaded in array order) or
  an absolute folder path (only direct `.js` and `.JS` files, sorted by plain filename order). Prefix
  names with `00-`, `10-`, and so on when their order should be easy to read. All files run in one
  shared scope. Files are reread and folder membership is refreshed on injection after a tab reload.
- `source` is inline script text, limited to 1 MiB UTF-8. To change inline text, attach again for
  the same host.

Both missing and both present are errors. An empty list, a folder without direct JavaScript files, or
any missing/unreadable file does not register or replace an existing rule. Runtime and syntax errors
from file-backed scripts include the originating file and line. `name` is an optional label, up to 256 characters, shown by the address-bar indicator. `params` is an optional
JSON object up to 16 KiB and 32 levels deep; the script reads it from `window.__persephoneSiteRuntime.params`.
Never put secrets or real user data in params. The registry list omits source and params.

## Matching, scope, and precedence

`host` is a bare hostname or `hostname:port`, with no scheme, path, wildcard, query, or fragment.
Matching is exact after hostname case and IDN normalization. A rule without a port uses the
scheme's default (80 for HTTP, 443 for HTTPS). An explicit port matches that numeric effective port
under either scheme. When a no-port rule overlaps an explicit default-port rule, the explicit rule
wins. Any valid hostname is allowed.

The rule applies only to this browser page and only to matching HTTP or HTTPS documents. It wins
over a saved extension for the matching document while attached; there is no saved-extension
fallback if the temporary script fails. Other hosts and ports receive no extension. It applies to
all internal tabs in the page, including later tabs and links or `window.open()` calls opened with a
tab disposition. Real `BrowserWindow` pop-ups are excluded.

Attaching applies immediately to already-loaded, ready matching tabs, including background tabs,
without reloading. Tabs that are still loading or not yet materialized are injected when their
document becomes ready. There is no page-level marker. `testExtensions` lists each rule with its
`injectedTabs` and its `failedTabs` (each with an error, such as an unreadable `scriptPath` after a
reload); detach with `detachTestExtension(host)`. As with a saved extension, the address bar shows
the site-extension indicator while an injected script exposes a model.

## Test models

A temporary test model exposes the page content and state needed by its assertions. It is attached
for the test run and uses the same `aiVision` model protocol as a saved extension. Saved models
should return minimal identifiers and header metadata by default, then gate body content behind
explicit reads. See [saved site models](./site-extensions.md) and the
[complete saved-model example](./site-extensions-example.md). Temporary models do not receive the
saved extension's privileged fetch broker.

Keep page reads and reusable page actions in `site.app` model methods. The test owns setup, locator
interactions through the browser facade, waits, assertions, and pass/fail choices. Keep model results
narrow and derived from the page. After navigation or attachment, poll the first model read because
registration can lag page load and callback errors retry. The 250 ms registration wait applies only
when a probe is already active; there may not be one yet after load.

`runtime.afterReturn(callback)` schedules work after reply serialization on a best-effort timer. Use
it to trigger navigation after a method has produced its value. It does not guarantee delivery. If
cross-document navigation destroys the in-flight call, `{ allowNavigation: true }` returns
`{ navigated: true }`; it does not recover the original value. Without that option the call fails
with `page-navigated`. Same-document SPA navigation preserves the live model. A model exposed late
may need `remote.refresh()` to start a new probe.

For test-window scope, session-page cleanup, and matcher details, see
[browser models and Playwright mappings](./web-app-tests/browser-models-and-playwright.md).

Return large results in bounded pages, for example with an offset, limit, and `hasMore`, then request
the next slice. If reply normalization receives a cut result, the call fails with
`result-truncated` and names `maxLength`. Do not treat a truncated reply as complete. The site model
uses its own `siteShape` result path; the host-side 500-item array shaping limit does not apply to
these site-extension calls. Keep body reads explicit and per item where useful.

`scriptPath` can be one file, an ordered non-empty list, or a folder. A folder loads direct `.js` and
`.JS` files in plain filename order; nested folders are not traversed. List order is preserved. All
sources share one scope, so later files can use earlier declarations. Prefix files with numbers to
make the order clear. File-backed errors include the file and line.

`expose(root)` requires `root.aiVision`. Without it, it throws
`The exposed root must carry an AiVision descriptor.` The minimum descriptor has `kind`, `summary`,
and `members`; each member has `name`, `kind` (`"property"` or `"method"`), and `summary`. A method
may also declare `signature`. Expose only the model members the test needs.

### Worked test-model example

These three excerpts come from the starter suite.
`persephone-test --init <folder>` writes the full suite, including the fixture page, loopback server
helper, run script, and `AGENTS.md`; those files are not repeated here. See [run options](./web-app-tests/run-options.md)
for the starter command.

`model/00-base.js`:

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

`model/10-app.js`:

```js
window.__persephoneSiteRuntime.expose({
    heading() {
        return mockPage.text("h1");
    },
    items() {
        return mockPage.texts("ul[aria-label='Items'] li");
    },
    // Required: expose() rejects a root without an aiVision descriptor
    // ("The exposed root must carry an AiVision descriptor.").
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

`tests/smoke.test.mjs`:

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

        // The model registers shortly after the page loads: poll the first read instead of sleeping.
        await ctx.expect.poll(() => site.app.heading()).toBe("Mock list");
        await site.type("label=New item", "Offline check");
        await site.click('role=button[name="Add item"]');

        await ctx.expect.poll(() => site.app.items(), {
            timeout: 5000,
            message: "The page model should report the submitted item",
        }).toEqual(["Offline check"]);
    }),
];
```

## Results, replacement, and cleanup

Attaching the same canonical `host:port` replaces that rule. The result lists current targets as
`injected`, `deferred`, or `error`; an error is per tab and does not remove the rule. Read
`pages[pageId].editor.testExtensions` to see attached rules and tabs where injection succeeded.

Detach by passing the same host authority:

```js
const result = await pages[pageId].editor.detachTestExtension("localhost:5173");
// { status: "detached" | "not-found", errors: [{ id, error }] }
```

Detach prevents future injection and disposes the current runtime, actions, and remote model in
documents that used that rule. A cleanup error means the document became unavailable or cleanup
could not be confirmed; reload that tab. Registered disposers are run, but arbitrary page changes,
unregistered timers, or other script effects cannot be undone. Closing the browser page or restarting
Persephone discards all temporary rules. They are not saved in page restore data, settings, or the
site-extensions folder.

## Private pages and capabilities

The facade's existing agent-access rule still applies: an agent-opened Incognito or Tor page can
use temporary extensions, while a user-owned private page remains inaccessible. Temporary rules
do not change the page's existing Tor proxy or privacy policy. They have no `fetchHosts` and calls to
`runtime.fetchText()` fail as unavailable; they cannot reach the privileged saved-extension fetch
broker. The page and extension share a JavaScript world, so a temporary extension is not a security
boundary from the page itself.

For persistent scripts, consent, fetch hosts, and saved extension management, see
[Site extensions](./site-extensions.md).

Temporary and saved site models use the site-shape reply path. Reply-size limits still apply, and a
cut reply fails with `result-truncated`; the host's generic 500-item array shaping limit does not
apply to these model calls.
