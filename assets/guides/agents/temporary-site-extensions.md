---
title: "Temporary site extensions for app testing"
audience: agent
summary: "Attach, inspect, replace, and detach a page-scoped test script that runs on matching browser tabs."
---

# Temporary site extensions for app testing

Use a temporary extension when a test needs the same page model or site actions on each matching
load. It is kept only in one browser page's memory, does not prompt for saved-extension trust, and
does not receive the privileged cross-host fetch broker. The normal site extension runtime still
provides `expose`, `onDispose`, `setActions`, and `runtime.params`.

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
- `source` is inline script text, limited to 1 MiB UTF-8. To change inline text, attach again for
  the same host.

Both missing and both present are errors. A missing or unreadable file does not register or replace
an existing rule. `name` is an optional label, up to 256 characters, shown by the address-bar indicator. `params` is an optional
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
