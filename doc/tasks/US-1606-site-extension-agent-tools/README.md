# US-1606: Site extension agent tools

Epic: [EPIC-120: Site extensions](../../epics/EPIC-120.md)

## Goal

Expose a `siteExtensions` root namespace and matching `app.siteExtensions` script API so an agent can inspect, scaffold, reload, and remove site extensions. Creation never grants trust: the user must approve execution in the existing browser trust bar.

## Background

EPIC-120 decides that extensions live at `<root>/<id>/manifest.json` and `extension.js` by default, use exact HTTPS hostnames, and run only when their host is trusted and enabled. `siteExtensionStore.getRoot()`, `list()`, and `findForHost()` in `src/renderer/api/site-extensions.ts` own the effective root and validated inventory; the store revalidates manifests by modification time and reads scripts fresh during injection. Its private `EXTENSION_ID_PATTERN`, `isExactHostname()`, and `validateManifest()` currently enforce the id, host, and manifest rules. `SiteExtensionListing` distinguishes valid, invalid (with reason), and conflict (with `conflictingHosts`) entries.

The hub tab at `src/renderer/editors/tools-hub/SiteExtensionsTab.ts` merges store listings with `siteExtensionTrust.snapshot`. Its `removeExtension()` asks through `showConfirmationDialog`, guards the folder under the configured root, recursively removes it, and revokes an existing grant. `siteExtensionTrust.get()` and `sameSiteExtensionHostSet()` in `src/renderer/api/site-extension-trust.ts` provide the renderer trust state and host-list comparison; trust itself is main-owned and is already mirrored to the renderer. EPIC-120's US-1605 decision reserves trust approval to that page bar.

`BrowserWebviewModel.injectSiteExtension()` is the navigation entry point. It checks private mode, HTTPS, the matching extension, enabled trust, and host-set equality, then either calls `injectTrustedExtensionIntoCurrentDocument()` or raises the existing prompt. The trusted injector reads the extension script and runtime fresh, puts `window.__persephoneSiteExtension` on the page, evaluates the script, and calls `probeAiVisionAgain()` after a successful evaluation. At present the marker is non-configurable, script failures return only the generic string `extension-error`, and the injected runtime in `src/site-extension-runtime.ts` exposes `expose` and `createElements` but does not retain the remote handle or provide disposal hooks. The package's `expose()` result has `refresh()` and `dispose()`; `dispose()` deletes `window.__aiVision` only when it still points at that handle (`node_modules/ai-vision/dist/remote/expose.js`).

The root call tree is assembled by `AiRoot` in `src/renderer/scripting/ai-vision/root.ts`; `ROOT_MEMBERS` and matching getters define namespaces such as `boards` and `tools`. `src/renderer/scripting/ai-vision/namespaces/index.ts` registers descriptors for API objects. `src/renderer/api/types/app.d.ts`, `src/renderer/api/app-service-registry.ts`, `src/renderer/api/app.ts`, and `src/renderer/scripting/api-wrapper/AppWrapper.ts` define, load, and expose script API services. `src/renderer/scripting/ai-vision/namespaces/tools.ts` demonstrates `IAiMember`, `stringRule`, `valueRule`, and `validateCallArguments`; destructive or privileged operations carry member-level `caution` text. `boards.uninstallBoard` demonstrates a confirmation-backed boolean result for cancellation.

For page targeting, `PagesModel.findPage(pageId)` yields a `PageModel`, whose `mainEditorInstance` is the actual editor model. Browser page ids therefore resolve to `BrowserEditor`; its state has an `activeTabId`, and `BrowserEditor.getAiVisionRegistration()` in `src/renderer/editors/browser/BrowserEditor.ts` defaults to that active tab. `BrowserEditorFacade.sendAiVision()` also rejects a registration if it no longer belongs to the active internal tab. `BrowserWebviewModel.siteDocumentId()`, `isCurrentDocument()`, and its trust-prompt methods guard work against cross-document changes. `agentMayAccessBrowserPage()` allows user-owned private pages to be inaccessible to agent operations; the epic's stronger site-extension rule is that private tabs receive no injection.

Script declarations under `src/renderer/api/types/*.d.ts` are copied automatically to `assets/editor-types/` by `editorTypesPlugin()` in `vite.renderer.config.ts`; add the source declaration only. The shared call resolver awaits property values: `resolveCall()` in `node_modules/ai-vision/dist/core/resolver.js` does `current = await value` after reading a member. Both renderer `aiCall()` (`src/renderer/scripting/ai-vision/call.ts`) and `AppWrapper.call()` (`src/renderer/scripting/api-wrapper/AppWrapper.ts`) use this resolver, so a Promise-valued `folder` property resolves to a string through MCP `call` and `app.call`. The US-1606 design and its trust constraints are recorded in [EPIC-120](../../epics/EPIC-120.md#decisions-for-agent-tools-us-1606-2026-10-03).

## Implementation Plan

1. [x] **Extend the injected runtime lifecycle** in `src/site-extension-runtime.ts`.
   - Add `onDispose(callback: () => void): void` to the `SiteRuntime` contract and maintain a per-injection cleanup list.
   - Wrap `expose(root)` so it disposes only a previously recorded remote handle, calls the imported `expose(root)`, then records and returns the new handle. It must never invoke cleanup callbacks: scripts may register `onDispose()` callbacks before exposing their root, as the starter does.
   - Add a runtime `dispose(): void` operation that runs registered cleanups once (catch each callback independently so later cleanups still run), empties the list, disposes the recorded remote handle, and clears the recorded handle. Only this explicit teardown operation runs cleanups. Keep the runtime object available for the replacement script.
   - Keep `createElements()` behavior unchanged. A repeated runtime bundle evaluation must not replace the already-installed runtime object.

2. [x] **Share id/host validation with the store and add a typed service contract.**
   - In `src/renderer/api/site-extensions.ts`, export the existing id predicate/rule as `isValidSiteExtensionId(id: string): boolean` and exact-host predicate as `isExactSiteExtensionHost(host: string): boolean`; make `validateManifest()` call those same helpers. Export `validateSiteExtensionHosts(hosts: unknown): string[] | undefined` (or an equivalent typed validator) that rejects empty/non-array/invalid hostname input and returns the same deduplicated host list used for manifests. Do not introduce a second id expression or hostname parser in the create API.
   - Add `src/renderer/api/types/site-extensions.d.ts` with `ISiteExtensions`, create options, list entries, and reload result types. `ISiteExtensions` has readonly `folder: Promise<string>` (scripts use `await app.siteExtensions.folder` because `siteExtensionStore.getRoot()` is asynchronous), `list(): Promise<SiteExtensionAgentListing[]>`, `create(id: string, options: { name: string; hosts: string[]; description?: string }): Promise<SiteExtensionCreateResult>`, `reload(pageId: string): Promise<SiteExtensionReloadResult>`, and `remove(id: string): Promise<SiteExtensionRemoveResult>`, where `SiteExtensionRemoveResult` is `{ removed: boolean; revokedTrust: boolean }`. Define `removed` as whether an extension folder was deleted and `revokedTrust` as whether a grant was revoked; a missing-folder trust row can therefore return `{ removed: false, revokedTrust: true }`.
   - Model each list item on the hub data: `id`, optional `name`, `version`, `hosts`, `scriptPath`, `status: "valid" | "invalid" | "conflict"`, optional `reason` / `conflictingHosts`, derived `trustState: "untrusted" | "trusted" | "disabled"`, and `hostsChangedSinceTrust: boolean | undefined` (undefined when the extension has no valid host list). Compute host changes with `sameSiteExtensionHostSet()`; never return trust-file contents or grant internals.
   - Reload result shape: `{ status: "injected" | "waiting-for-user" | "disabled" | "no-extension" | "extension-error" | "not-current"; registered: boolean; error?: string }`. `registered` is whether the probe observed a model before the probe deadline; it is false for all statuses where injection did not complete.

3. [x] **Implement the app service and safe scaffold/removal helpers.**
   - Add `src/renderer/api/site-extensions-agent.ts` exporting the `siteExtensions: ISiteExtensions` implementation. `folder` resolves `siteExtensionStore.getRoot()` and remains read-only. `list()` combines `siteExtensionStore.list()` with the renderer trust mirror as described above.
   - `create(id, options)` validates positional arguments with the AiVision argument-rule helpers, requires a non-empty trimmed name, and calls the exported store id/host validators. Reject option keys other than `name`, `hosts`, and `description`; reject a `hosts` array longer than 20 with a clear message. Each host must already be lower-case: do not normalize it; name the invalid host and say exact lower-case hostnames are expected, matching `validateManifest()`. Resolve `<root>/<id>` with `fpJoin`; check `fs.stat(folder).exists` so an existing directory is refused even when its manifest is invalid or absent. Get current entries from `siteExtensionStore.list()` and refuse any requested host present in another valid record or a conflict record (both are valid manifests claiming the host). Reuse the store's manifest representation and default `extension.js`; emit `manifest.json` with `version: "1.0.0"`, `description: options.description?.trim() || \`Site extension for ${name}.\``, the validated hosts, and `script: "extension.js"`. Use `fs.write()` from `src/renderer/api/fs.ts` (it creates parent directories) for both files; if the second write fails, remove the newly-created folder so a partial scaffold does not look complete. Return `{ id, folder, manifestPath, scriptPath, requiresTrust: true, message }`; the message must state that the user needs to click **Trust** in the matching browser page. This method does not call `siteExtensionTrust.trust()` or request a grant.
   - Add `src/renderer/api/site-extension-management.ts` to own the common safe folder resolver and confirmation-backed removal used by both this service and the hub tab. Export `siteExtensionFolder(id: string): Promise<string>` using `siteExtensionStore.getRoot()`, `fpResolve`, and `fpRelative` to reject a path escaping the root (the existing `extensionFolder()` guard). Export `confirmAndRemoveSiteExtension(id: string, displayName?: string): Promise<SiteExtensionRemoveResult>`; it uses the same `showConfirmationDialog` title/message/buttons as the hub tab and resolves a display name from the listing or falls back to the id. Validate `id` with `isValidSiteExtensionId()` before any filesystem access. For a known folder, Delete recursively removes it; for a missing folder with a leftover trust grant (the hub's folder-missing row), still show the same confirmation, do not throw on absence, and revoke the grant after Delete. If neither folder nor trust grant exists, throw a clear unknown-id error without exposing unrelated paths or trust-file data. On Cancel return `{ removed: false, revokedTrust: false }`; after Delete revoke trust only when `siteExtensionTrust.get(id)` exists and return `{ removed: folderExisted, revokedTrust }`. Keep filesystem deletion and grant revocation ordered as in the existing tab flow.
   - In `SiteExtensionsTab.ts`, replace private `extensionFolder()` and `removeExtension()` mechanics with these shared helpers. Preserve its `reloadRequired` behavior when a removed extension had a trust grant; `perform()` continues to surface errors through `ui.notify()` and refreshes the listing.

4. [x] **Add in-place reload to the browser injection path.**
   - In `src/renderer/editors/browser/BrowserWebviewModel.ts`, refactor the current private trusted injection method to return a structured outcome rather than logging away the result. Preserve `injectSiteExtension()` as the normal fire-and-forget navigation entry point and its exact trust/enabled/host/private gates. Use the same trusted injection implementation from navigation and `reload(pageId)`.
   - Add a public `reloadSiteExtension(): Promise<SiteExtensionReloadResult>` on `BrowserWebviewModel`; it targets the current `activeTabId` only. Return `not-current` when the webview/document is absent, not ready, not HTTPS, private (Incognito or Tor), or changes while the operation is in flight. Return `no-extension` when the active exact HTTPS host has no store match; return `disabled` for a present disabled grant. If there is no grant or its host set is stale, preserve/update the existing normal prompt and return `waiting-for-user`; never grant trust here. If the same document becomes trusted/enabled before the final gate, re-check and use the normal injector.
   - Do not tear down an extension until every gate has passed and the method is about to re-inject: current matching HTTPS page, current extension, trusted grant, enabled state, unchanged host set, ready webview, and non-private mode. For `disabled`, `waiting-for-user`, `no-extension`, and early `not-current`, leave any currently running extension untouched. This preserves the US-1605 behavior that script changes apply on reload or navigation. Immediately before re-injection, evaluate a page-side expression that calls `window.__persephoneSiteRuntime?.dispose?.()` on the runtime object already installed in that document, then delete `window.__persephoneSiteExtension`. Change the marker definition in the injector wrapper to `configurable: true` so it can be deleted. Clear the old AiVision registration and capture the resulting current generation. Re-check `isCurrentDocument(internalTabId, documentId, host)` after every await. Then read the extension script fresh, evaluate the normal injection wrapper (the runtime bundle plus the fresh script) through the existing CDP `evaluateInTarget()` path, and probe. The bundle's `if (!target.__persephoneSiteRuntime)` guard leaves the installed runtime object in place.
   - Change the page wrapper's catch result to include a safely extracted error message from the thrown page value; return that message to the renderer while keeping the existing page-console diagnostic. Before truncating to 512 characters, strip control characters except newline and tab (including ESC and C1 controls), then label it `Page-derived extension error:` and append an ellipsis if truncation occurred. Script read/evaluation failures map to `extension-error` with a bounded explanatory message; host mismatch/duplicate-marker results map to `not-current` rather than claiming injection.
   - After successful script evaluation, run an immediate probe, then observe registration for the captured `getAiVisionDocumentGeneration()` value for up to 3,000 ms total, including that immediate probe. `BrowserEditor.setAiVisionRegistration()` in `src/renderer/editors/browser/BrowserEditor.ts` updates the per-tab registration map without updating observable editor state, so poll `BrowserEditor.getAiVisionRegistration(internalTabId)` every 50 ms rather than subscribing to `state`; accept only a registration whose `generation` equals the captured generation. Bound the immediate CDP probe with `withTimeout()` from `src/renderer/core/utils/utils.ts` to the remaining portion of the same 3,000 ms deadline. The runtime's `remote.refresh()` signal path re-probes and registers the late model; reload's poll observes the registration map. At the deadline return `status: "injected", registered: false`; keep normal navigation injection non-blocking.
   - In the new service, `reload(pageId)` resolves `pagesModel.findPage(pageId)?.mainEditorInstance`, requires a `BrowserEditorModel`, and delegates to `editor.webview.reloadSiteExtension()`. An unknown page, another editor type, or a page with no current eligible document returns `not-current` (rather than throwing for an expected non-target).

5. [x] **Register the script and AiVision surfaces.**
   - Add `siteExtensions: ISiteExtensions` to `src/renderer/api/types/app.d.ts` and include `siteExtensions` in the service keys in `src/renderer/api/app-service-registry.ts`, loaded from `./site-extensions-agent`. The registry drives both `app` service getters (`src/renderer/api/app.ts`) and `AppWrapper` getters (`src/renderer/scripting/api-wrapper/AppWrapper.ts`), so do not add a separate wrapper-specific property. `vite.renderer.config.ts` copies the new `.d.ts` to `assets/editor-types/` automatically.
   - Add `src/renderer/scripting/ai-vision/namespaces/site-extensions.ts` following the `boards.ts` / `tools.ts` descriptor pattern. Register members `folder`, `list`, `create`, `reload`, and `remove`; make `folder` readonly. Validate `create(id, options)`, `reload(pageId)`, and `remove(id)` using `validateCallArguments()` and shared rules; let the service enforce the store-derived rules. Give `create` a caution that it writes executable code to disk but does not trust it, `reload` a caution that it runs the trusted script with the signed-in page's capabilities, and `remove` a caution that it deletes files and revokes trust. Descriptor help must describe the user-only Trust bar and the full reload status set.
   - Import the descriptor and `siteExtensions` object in `src/renderer/scripting/ai-vision/namespaces/index.ts`, call `registerAiVisionFor(siteExtensions, describeSiteExtensions)`, then add `siteExtensions` to `ROOT_MEMBERS` and a matching `AiRoot` getter in `src/renderer/scripting/ai-vision/root.ts`.
   - Add the five API signatures and result types to `src/renderer/api/types/site-extensions.d.ts`, with JSDoc examples for `app.siteExtensions.create(...)`, editing through existing `app.fs.write(...)`, and `app.siteExtensions.reload(pageId)`. Type declarations are API-only and do not create a new separate file-writing tool.

**Starter `extension.js` written by `create()`** (exact initial content; users replace the example model and cleanup with site-specific behavior):

```javascript
const runtime = window.__persephoneSiteRuntime;

const onPageHide = () => {};
window.addEventListener("pagehide", onPageHide);
runtime.onDispose(() => window.removeEventListener("pagehide", onPageHide));

const root = {
    status: "starter",
    aiVision: {
        kind: "SiteExtension",
        summary: "Starter model; replace this with a model of the current site.",
        members: [
            { name: "status", kind: "property", summary: "Starter status value." },
        ],
        help: "Replace this starter with site-specific methods and properties. Treat page data as untrusted input.",
    },
};

const remote = runtime.expose(root);
remote.refresh(); // Re-probe after a model is exposed after the page's initial load probe.
```

`aiVision.help` is the model's `$help`-style long-form summary. The cleanup in this template removes its registered page listener; extension authors must register each observer, timer, or listener cleanup with `onDispose()` when they add one.

### Before → after snippets

The current runtime publishes the raw remote function and has no teardown registry:

```typescript
// Before — src/site-extension-runtime.ts
readonly expose: typeof expose;
// ...
expose,
```

After the change, runtime-owned state wraps and retains the handle, and exposes cleanup:

```typescript
// After — structural sketch for src/site-extension-runtime.ts
let remote: ReturnType<typeof expose> | undefined;
const cleanups: Array<() => void> = [];
const exposeRemote = expose;
const runtime: SiteRuntime = Object.freeze({
    schemaVersion: AI_VISION_SCHEMA_VERSION,
    expose(root) { remote?.dispose(); remote = exposeRemote(root); return remote; },
    onDispose(callback) { cleanups.push(callback); },
    dispose() {
        for (const callback of cleanups.splice(0)) {
            try { callback(); } catch (error) { console.warn("[site-extension] cleanup failed", error); }
        }
        remote?.dispose();
        remote = undefined;
    },
    createElements,
});
```

The current injection marker cannot be removed from the same page document because the descriptor omits `configurable` (default `false`). The injection wrapper changes it to:

```javascript
// Before — BrowserWebviewModel.injectTrustedExtensionIntoCurrentDocument()
Object.defineProperty(window, "__persephoneSiteExtension", {
    value: { id, host }, enumerable: false,
});

// After — same marker, now clearable after runtime teardown
Object.defineProperty(window, "__persephoneSiteExtension", {
    value: { id, host }, enumerable: false, configurable: true,
});
```

### Reload status contract

| Status | Meaning | `registered` | `error` |
|---|---|---:|---|
| `injected` | The current trusted, enabled extension evaluated successfully; the model probe may still time out. | Probe result | absent |
| `waiting-for-user` | Trust is absent or the extension host list changed; the regular in-page prompt is visible or already pending. | `false` | absent |
| `disabled` | A matching extension has a current trust record with `enabled: false`. | `false` | absent |
| `no-extension` | No valid unconflicted extension matches the active page host. | `false` | absent |
| `extension-error` | Script/runtime read or page evaluation failed. | `false` | Bounded, page-derived labelled message |
| `not-current` | The page id/editor/webview/document is unavailable, private, non-HTTPS, not ready, or changed during reload. | `false` | Absent |

## Concerns / Open Questions

- **Resolved target choice:** if a browser page owns multiple internal tabs, `reload(pageId)` targets only its active internal tab (`BrowserEditorModel.state.activeTabId`). The script API accepts the Persephone page id, not an internal tab id; this matches `BrowserEditorFacade`'s active-tab model and avoids mutating an invisible, non-current document.
- **Private pages:** Incognito and Tor documents never receive a site extension, including when opened by an agent. Reload reports `not-current` for them; it does not expose the page or change trust.
- **Trust prompt races:** a reload may run while a prompt is pending or while the user is approving it. Keep the pending prompt on `waiting-for-user`; after every async boundary re-read current document identity, extension/host match, and grant. Only a completed user approval can transition the same document into trusted injection. No agent call may synthesize that approval.
- **Incomplete cleanup:** the runtime can reliably run only callbacks the extension registered. Scripts that install observers, timers, or listeners without registering cleanup can leak those effects across in-place reloads. The starter and descriptor help must say this; page navigation remains the hard reset.
- **Probe deadline:** reload allows 3,000 ms total after successful evaluation, runs an immediate probe, then polls the per-tab AiVision registration map every 50 ms. Registration-map writes do not emit editor-state changes (`BrowserEditor.setAiVisionRegistration()`), so there is no suitable state subscription. On timeout the result remains `injected` with `registered: false`; `remote.refresh()` may register the late model after reload returns.
- **Scaffold partial failure:** create should clean up its just-created folder if writing the starter script fails after the manifest was written. A process interruption between writes can still leave a folder; `list()` must continue to report it as invalid, and another `create()` must refuse to overwrite that existing folder.
- **Conflicted host claims:** the store marks all valid extensions in a duplicate-host group as `conflict` and omits that host from `findForHost()`. Create must refuse a host appearing in either a `valid` or `conflict` listing owned by another id so it cannot silently create/extend a conflict.
- **Runtime version is document-scoped:** `injectTrustedExtensionIntoCurrentDocument()` installs the runtime only when `window.__persephoneSiteRuntime` is absent. In-place script reload therefore keeps that document's original runtime bundle; runtime code changes from an app update or dev rebuild take effect after navigation. Reload must call `dispose()` on the object already present at `window.__persephoneSiteRuntime` before evaluating the replacement extension script.
- **Removal with stale trust:** a missing extension directory may still have a trust mirror row. Removal must confirm before revoking that grant; an id with neither a folder nor grant is an error, and malformed ids must fail before path resolution or other filesystem access.
- **Create option validation:** the manifest validator accepts exact lower-case hostnames. Agent create additionally caps hosts at 20 and rejects unknown option keys; these checks must be explicit so an oversized or misspelled input cannot silently alter the scaffold.

## Acceptance Criteria

- `siteExtensions` is discoverable from the AiVision root and the same methods are available as `app.siteExtensions`; `folder` resolves to the effective store root and is readonly. Runtime `expose()` disposes only an earlier remote handle and never runs `onDispose()` callbacks; reload's explicit `dispose()` runs callbacks once before disposing the current remote.
- `list()` reports store validity/conflicts plus the hub's trust state and host-list-changed state, without exposing trust-file internals.
- `create()` validates ids and exact lower-case hostnames through the same helpers used by manifest validation; it rejects unknown options, more than 20 hosts, existing folders, and hosts claimed by another valid extension, writes the manifest and starter script, returns both paths, and clearly requires the user's browser Trust action. It never grants or requests trust.
- `reload(pageId)` targets the active internal tab, preserves its page state, applies the same HTTPS/private/trust/enabled/host gates as normal injection, and leaves a running extension untouched for `disabled`, `waiting-for-user`, `no-extension`, and early `not-current`. After all gates pass, it runs registered disposals and the remote handle disposal, clears the configurable marker, reads the script fresh, evaluates and probes immediately, then observes the current-generation registration map for up to 3,000 ms total at 50 ms intervals. It returns the documented status, registration result, and sanitized/truncated labelled message for errors.
- `remove(id)` and the Site Extensions hub use one id-first validator, folder guard, and confirmation/removal implementation. Cancel leaves folder and trust intact; Delete removes an existing folder if present and revokes any grant. A missing folder with leftover trust is removable after confirmation; unknown ids throw a clear error; malformed ids fail before filesystem access. The agent API and helper both return `{ removed, revokedTrust }`.
- The starter template publishes a `$help`-style AiVision summary, calls `refresh()` after exposing its root, and registers an `onDispose()` cleanup.
- Live verification uses the existing MCP `call` surface and the browser trust bar; no unit tests or test harness plans are added for this task.

## Files Changed Summary

| File | Change |
|---|---|
| `src/site-extension-runtime.ts` | Add `onDispose()`, track the `expose()` handle, and run cleanups only during explicit in-place reload disposal. |
| `src/renderer/api/site-extensions.ts` | Export the id/host validators already used by `validateManifest()`. |
| `src/renderer/api/site-extensions-agent.ts` | New `ISiteExtensions` service: folder/list/create/reload/remove. |
| `src/renderer/api/site-extension-management.ts` | New shared guarded folder and confirm/delete/revoke helpers. |
| `src/renderer/editors/tools-hub/SiteExtensionsTab.ts` | Reuse shared remove helpers, preserving refresh and reload notice behavior. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Return injection outcomes/errors and add guarded active-document in-place reload/probe. |
| `src/renderer/api/types/site-extensions.d.ts` | New script API and result declarations; Vite syncs the editor-types copy. |
| `src/renderer/api/types/app.d.ts` | Declare `app.siteExtensions`. |
| `src/renderer/api/app-service-registry.ts` | Load `siteExtensions` as an app service. |
| `src/renderer/scripting/ai-vision/namespaces/site-extensions.ts` | New AiVision descriptor, rules, help, and cautions. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | Register the `siteExtensions` service descriptor. |
| `src/renderer/scripting/ai-vision/root.ts` | Add the root member and getter. |
| `assets/editor-types/site-extensions.d.ts` | **No direct edit:** generated from `src/renderer/api/types/site-extensions.d.ts` by `editorTypesPlugin()` in `vite.renderer.config.ts`. |
| `src/renderer/api/app.ts` | **No direct edit:** service getters are generated from `appServiceDescriptors`. |
| `src/renderer/scripting/api-wrapper/AppWrapper.ts` | **No direct edit:** constructor defines getters from `appServiceDescriptors`. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | **No direct edit:** page-id reload resolves through `pagesModel` and delegates to the browser editor model; facade current-document behavior remains unchanged. |
| `src/renderer/editors/browser/BrowserEditor.ts` | **No direct edit:** active tab id, AiVision registration, and private-mode state are already exposed to `BrowserWebviewModel`. |
| `src/renderer/api/site-extension-trust.ts` | **No direct edit:** reuse `get()` and `sameSiteExtensionHostSet()`; do not add trust grants or requests. |
| `src/renderer/api/types/tools.d.ts` | **No direct edit:** this API is an `app.call()`-only root node pattern; US-1606 adds a service API as explicitly required by EPIC-120. |
| `qa/surfaces/`, `doc/architecture/ui-element-contract.md`, main-process trust IPC, and user guides | **No changes:** US-1606 adds no UI names, trust IPC, or user-facing UI surface; authoring guide updates belong to US-1607. |
| `doc/active-work.md`, `doc/epics/EPIC-120.md` | **No changes:** the dashboard entry and epic task row already link to this README. |

## Verification (2026-10-03, live through MCP `call`)

- `siteExtensions.folder` returns the configured folder.
- `create("test-tools", { name, hosts: ["example.com"] })` wrote both files and returned `requiresTrust: true` with the Trust message.
- `create` refused each of these with a clear message:
  - a duplicate id;
  - a host claimed by `outlook`;
  - `Example.org`;
  - an unknown option;
  - an invalid id.
- `list()` reported both extensions as valid, with their trust state.
- **Untrusted:** `reload(pageId)` returned `waiting-for-user`, and the page's `siteExtensionTrustPrompt` showed the Test Tools bar. An unknown page id returned `not-current`.
- **After the user clicked Trust:** `reload` returned `injected` with `registered: true`.
- **Cleanup:** a counter script that exposes its model 500 ms late and registers an interval cleanup ran four injections and three cleanups in one document. Each reload ran exactly one cleanup, and page state survived.
- **Errors:**
  - A throwing script returned `extension-error` with "Page-derived extension error: …".
  - A 700-character error was cut to 512 characters with an ellipsis, and ESC was stripped.
  - Restoring the script and reloading registered the model again.
- **`remove`:**
  - Cancel returned `{ removed: false, revokedTrust: false }` and left the extension trusted.
  - Delete (clicked by the user) returned `{ removed: true, revokedTrust: true }`. The folder and its grant were gone, and `reload` then returned `no-extension`.
- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

### Fixes made during verification

- **Registration check.** A probe that finds no model advances the AiVision generation, so a late model registers under a newer generation. Reload now accepts any registration with `generation >= captured`. Navigation is still excluded by the current-document check.
- **Late-model probe rate limit** (pre-existing, from US-1602). A `refresh()` signal inside the one-second interval was dropped, so a model announced only once in that window was never registered. `scheduleLateAiVisionProbe()` now schedules one trailing probe instead, and timers are cleared in `disposeIpcHandler`. Reload also resets the interval for its tab.
