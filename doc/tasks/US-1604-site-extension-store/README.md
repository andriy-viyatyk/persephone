# US-1604: Site extension store, manifest, host matching, injection

**Epic:** [EPIC-120](../../epics/EPIC-120.md) · **Status:** Implementation in progress; requested implementation complete, user verification pending
**Depends on:** [US-1602](../US-1602-site-extension-injection-poc/README.md), [US-1603](../US-1603-outlook-poc/README.md)

## Goal

Replace the developer-only site-extension PoC lookup with a renderer-owned store at
`<userData>/data/site-extensions/<id>/`, validate each extension manifest and script path, and
inject valid extensions for their exact HTTPS hosts. Preserve the PoC-proven CDP lifecycle and
private-page protection while removing PoC-only diagnostics and duplicate AiVision registration.

## Progress

- Implemented plan steps 1-4 and 8, plus the Outlook source header and sample manifest from step 5.
- Steps 6-7 are intentionally pending for the user's Persephone MCP verification.
- The local `%APPDATA%/persephone/data/site-extensions/outlook/` copy remains to be installed; the
  active workspace permits writes only inside the repository.

## Background

- EPIC-120's post-PoC decisions dated 2026-10-03 are settled: lower-case id folders without
  nesting; manifests with `name`, `version`, `description`, `hosts`, and optional `script` defaulting
  to `extension.js`; exact host names with HTTPS implied; one extension per host; renderer-side
  store; manifest index revalidated by modification time on lookup; scripts read fresh per
  injection. Outlook uses `outlook.cloud.microsoft`, `outlook.office.com`, and
  `outlook.office365.com`.
- The PoC lookup in `src/renderer/editors/browser/site-extension-poc.ts` reads
  `<data>/site-extensions-poc/<host>.js`, bundles the remote runtime from
  `src/site-extension-runtime.ts`, creates a main-world wrapper, and publishes the test-only
  `window.__siteExtensionPoc.events` timing log. Replace the lookup and wrapper construction with
  the store; remove the timing log as PoC-only instrumentation. The script itself remains freshly
  read on each injection.
- `BrowserView`'s `onDomReady` in `src/renderer/editors/browser/BrowserView.ts` calls
  `probeAiVisionOnReady()` and `injectSiteExtension()`. `BrowserWebviewModel.injectSiteExtension()`
  currently rejects `isIncognito || isTor`, attaches CDP with `{ aiVisionBinding: true }`, awaits
  `ensureTargetReady()`, evaluates in the main world, records PoC events, and probes after a
  successful injection. Its wrapper re-checks `location.protocol` and `location.hostname` and
  sets a non-enumerable per-document marker. Keep these lifecycle and safety behaviors; put the
  extension id in the marker.
- `BrowserWebviewModel.handleAiVisionSignal()` retains the US-1602 late-model path: a shape signal
  without a registration is rate-limited by `AI_VISION_LATE_PROBE_INTERVAL_MS` and triggers
  `probeAiVisionAgain()`. Preserve this path unchanged in behavior.
- `probeAiVision()` registers a successful probe through `setAiVisionRegistration()` and logs a
  `registered` timing event. Injection clears the probe-dedupe key and probes again, so the load
  probe and post-injection probe can both set the same shape/version. The productized path should
  skip an identical registration for the same document generation.
- `scripts/build-prod.mjs` builds `src/site-extension-runtime.ts` as an IIFE with `minify: false`;
  production should minify this runtime-only bundle. `scripts/dev.mjs` deliberately keeps the
  development watcher unminified. The existing IPC endpoint (`getSiteExtensionRuntime`) in
  `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, and `src/ipc/renderer/api.ts` already
  serves the IIFE and remains in place.
- Store patterns: `src/renderer/api/boards.ts` resolves the data location through the renderer API;
  `src/renderer/api/board-install-registry.ts` shows the registry/listing shape; and
  `src/renderer/editors/board/board-manifest.ts` shows tolerant manifest reading. New renderer file
  access must use `fs` from `src/renderer/api/fs.ts` (`listDirWithTypes`, `stat`, `read`) and path
  operations must use `src/renderer/core/utils/file-path.ts` (`fpJoin`, `fpResolve`, `fpRelative`,
  `fpNormalizeForCompare`, `fpSep`), never direct Node `fs` or `path` imports.

## Implementation Plan

1. **Add the renderer store at `src/renderer/api/site-extensions.ts`.** Derive the root with
   `await fs.dataFileName("site-extensions")`; `fs.resolveDataPath()` is synchronous and must not
   run until `fs.wait()` completes because `_dataPath` is initialized asynchronously. Enumerate
   only immediate child directories with `fs.listDirWithTypes()`, and accept folder ids matching
   lower-case letters, digits, and hyphens (`^[a-z0-9-]+$`, non-empty). There is no nested
   extension layout. Export typed record/listing
   results and two operations: `findForHost(host)` for injection and `list()` for future inventory
   consumers. `list()` must report every discovered directory as `valid`, `invalid` with a stable
   reason, or `conflict` with the colliding host names, so US-1605/1606 can build on it without
   reimplementing validation.

   Before → after lookup:

   ```ts
   // Before: src/renderer/editors/browser/site-extension-poc.ts
   const source = await fs.getDataFile(`${POC_FOLDER}/${host}.js`);

   // After: src/renderer/api/site-extensions.ts consumer API
   const extension = await siteExtensionStore.findForHost(host);
   if (!extension) return undefined;
   const source = await fs.read(extension.scriptPath); // intentionally fresh each injection
   ```

   Parse `manifest.json` as `unknown`; reject non-object/array JSON and validate required non-empty
   string fields `name`, `version`, and `description`. `hosts` must be a non-empty array of exact,
   lower-case hostnames: reject uppercase, `*`, ports, schemes, paths, empty items, and values that
   do not round-trip as a URL hostname. Do not normalize invalid input into a different host.
   `script` is an optional non-empty relative path, defaulting to `extension.js`; resolve it against
   the extension directory with `fpResolve()` and reject absolute or escaping paths by checking
   `fpRelative(extensionDir, scriptPath)` for `..`, a `../` prefix using `fpSep`, or an absolute
   result. This is a lexical boundary check; no symlink resolution is available through the
   renderer `app.fs` API. In addition to the manifest `stat`, stat the resolved script path on each
   index refresh. A missing script makes the extension `invalid` with reason `script not found`; a
   directory at that path makes it invalid with reason `script is not a file`. This check is cheap
   and must run even when the manifest mtime is unchanged, so creating or removing the script is
   noticed without editing the manifest.

   Each lookup/list refresh enumerates current extension directories, stats each manifest, and
   reuses the parsed/validated entry only when its `manifest.json` mtime is unchanged. Missing
   manifests and stat/read/parse failures become invalid listing entries with a reason; directory
   enumeration also removes deleted ids from the in-memory index. Build host ownership from the
   current valid entries. If multiple valid manifests claim a host, mark each extension listing as
   `conflict` (including the conflicting host names) and omit that host from the lookup map; other
   unique hosts declared by those extensions can still resolve. The script is never part of the
   index cache and is read through `fs.read()` for each injection.

2. **Switch injection from the PoC lookup to the store in
   `src/renderer/editors/browser/BrowserWebviewModel.ts`.** Keep injection triggered by
   `BrowserView.onDomReady`; use the current HTTPS URL hostname as the store lookup key. Continue
   to refuse injection for `state.isIncognito || state.isTor` with no `openedByAgent` exception,
   attach through `this.model.target.cdp(internalTabId).attach({ aiVisionBinding: true })`, await
   `ensureTargetReady()`, evaluate via `evaluateInTarget()`, and probe after an `"ok"` result. Keep
   the in-page `location.protocol === "https:"` and `location.hostname === manifest host`
   re-check, because the document can change while the store/runtime are being read. Retain the
   one-injection-per-document marker and add `id` to its value.

   Before → after wrapper guard:

   ```ts
   // Before: buildSiteExtensionInjection() in site-extension-poc.ts
   if (location.protocol !== "https:" || location.hostname !== host) return "host-mismatch";
   if (window.__persephoneSiteExtension) return "already-injected";
   Object.defineProperty(window, "__persephoneSiteExtension", { value: { host }, enumerable: false });

   // After: wrapper assembled for the store record
   if (location.protocol !== "https:" || location.hostname !== host) return "host-mismatch";
   if (window.__persephoneSiteExtension) return "already-injected";
   Object.defineProperty(window, "__persephoneSiteExtension", {
       value: { id: extension.id, host }, enumerable: false,
   });
   ```

   `host` in the wrapper is the exact lower-case host selected by `findForHost()`. Continue to
   evaluate the runtime IIFE before the extension source and catch extension exceptions as a
   generic failure result, without forwarding exception text that could contain page or mailbox
   content. Do not add trust, enabled/disabled state, or agent-opening exceptions here.

3. **Remove duplicate registration and protect the concurrent null-probe race in
   `BrowserWebviewModel.probeAiVision()`.** In the `typeof serialized !== "string"` null-result path,
   first read the current registration. If it exists for this same tab at the same `generation`,
   return without clearing: another probe may have registered the model after this probe evaluated
   null but before its result was handled. Otherwise keep the existing
   `clearAiVisionRegistrationIfCurrent(internalTabId, generation)` behavior. This is safe because
   `reprobeAiVision()` clears the current registration first, which bumps the document generation;
   a model that legitimately vanished therefore has no same-generation registration for the null
   probe to preserve.

   Before → after null-result handling:

   ```ts
   // Before: BrowserWebviewModel.probeAiVision()
   if (typeof serialized !== "string") {
       this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
       return;
   }

   // After: preserve only a registration installed concurrently for this generation
   if (typeof serialized !== "string") {
       const current = this.model.getAiVisionRegistration(internalTabId);
       if (current?.generation === generation) return;
       this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
       return;
   }
   ```

   Also compare the current registration's generation, version, and serialized shape before
   calling `setAiVisionRegistration()`. If all match the just-probed result, return without
   replacing its token or logging another registration. A different version or shape still goes
   through the existing registration path. This covers the load probe racing with the successful
   injection's follow-up probe without changing `probeAiVisionAgain()` or the US-1602 late-probe
   behavior.

   Before → after registration:

   ```ts
   // Before: BrowserWebviewModel.probeAiVision()
   if (this.model.setAiVisionRegistration(internalTabId, generation, probe.shape, probe.version)) {
       // registration bookkeeping
   }

   // After: same-document duplicate guard immediately before setAiVisionRegistration()
   const current = this.model.getAiVisionRegistration(internalTabId);
   if (current?.generation === generation
       && current.version === probe.version
       && JSON.stringify(current.shape) === JSON.stringify(probe.shape)) return;
   if (this.model.setAiVisionRegistration(internalTabId, generation, probe.shape, probe.version)) {
       // registration bookkeeping
   }
   ```

   Remove PoC timing-event imports/calls and `window.__siteExtensionPoc` instrumentation. The
   probe should no longer emit a `registered` PoC event; ordinary AiVision event behavior is outside
   this cleanup.

4. **Minify only the production runtime bundle in `scripts/build-prod.mjs`.** Set `minify: true`
   for the standalone `site-extension-runtime` IIFE build. Leave `scripts/dev.mjs`'s shared
   `iifeConfig()` at `minify: false` so the development runtime remains debuggable.

   Before → after production config:

   ```js
   // Before: site-extension-runtime build in scripts/build-prod.mjs
   build: { outDir: ".vite/build", emptyOutDir: false, minify: false, ... }

   // After: only this runtime build
   build: { outDir: ".vite/build", emptyOutDir: false, minify: true, ... }
   ```

5. **Keep the user's Outlook model available while retiring the PoC lookup.** Install a local,
   unshipped copy under `<userData>/data/site-extensions/outlook/`: copy
   `doc/tasks/US-1603-outlook-poc/outlook-extension.js` to `extension.js` and add
   `manifest.json` with the Outlook name/version/description, `script: "extension.js"`, and the
   three exact hosts `outlook.cloud.microsoft`, `outlook.office.com`, and
   `outlook.office365.com`. This is local user data, not a bundled extension. Update the header in
   `doc/tasks/US-1603-outlook-poc/outlook-extension.js` to describe this manifest-based install
   instead of `site-extensions-poc/<host>.js`, and add
   `doc/tasks/US-1603-outlook-poc/manifest.json` as the sample manifest copied to the local install.
   The sample file should contain:

   ```json
   {
     "name": "Outlook",
     "version": "1.0.0",
     "description": "AiVision model for Outlook on the web.",
     "hosts": [
       "outlook.cloud.microsoft",
       "outlook.office.com",
       "outlook.office365.com"
     ],
     "script": "extension.js"
   }
   ```

   Then remove
   `src/renderer/editors/browser/site-extension-poc.ts` and its
   `<data>/site-extensions-poc/<host>.js` lookup support. `BrowserWebviewModel.ts` gets its
   injection source and host/id from the new store. Do not delete a user's old PoC data directory
   as part of this task; it simply stops being read. Keep `src/site-extension-runtime.ts` and the
   `getSiteExtensionRuntime` IPC endpoint because the productized store still injects that runtime.

6. **Verify store statuses and injection using non-sensitive fixtures.** Create temporary local
   extensions under distinct ids on documentation hosts: one valid minimal model for `example.com`,
   one otherwise valid manifest for `example.net` whose declared script file is missing, and two
   valid manifests both claiming `example.org`.
   Assert from `siteExtensionStore.list()` that the first is `valid`, the second is `invalid` with
   its validation reason, and both claimants are `conflict` for `example.org`. Check with browser
   `evaluate` that the valid HTTPS page gets the extension-id marker and its browser app registration,
   while the invalid and conflicting pages get no extension-id marker/model; confirm
   `http://example.com` is skipped. Delete all fixture folders after the check. These results must
   come from the store's `list()` output and the in-page marker via `evaluate`, never from page
   content.

   `list()` is not exposed to MCP until US-1606, and this task adds no public surface for it. Call
   it by dynamically importing `src/renderer/api/site-extensions.ts` from `script.execute`. That
   import creates a second module instance, which would normally make the result unreliable. It
   does not matter here: the store's only state is a cache derived from disk, so a fresh instance's
   `list()` computes the same statuses that the injection instance sees. The injection side is
   checked separately, through the in-page marker and the browser `app` registration. Use
   Persephone MCP for page selection, for `evaluate` of the non-enumerable injection marker, and for
   `pages[id].editor.app` registration and structure.

7. **Verify the user's Outlook page with Persephone MCP.** Its page already exists. Use
   Persephone MCP's page inventory to select that browser page by its host, then use `$help` or
   descriptor inspection at `pages[id].editor.app` to confirm the model's member structure. After
   a reload, repeat the structure check and record counts/pass-fail only. Confirm through the
   browser/store path that each declared host selects its extension, ordinary HTTPS Outlook gets
   one injection, HTTP and an in-page hostname mismatch are skipped, and Incognito/Tor pages remain
   uninjected even when opened by an agent. If a count-only model summary exists, call only that
   summary; never call the `messages` collection, `read`, `search`, or any member returning
   subjects, senders, previews, bodies, addresses, or other mailbox text. Do not use page snapshots
   for this check. Follow the privacy boundary in the [US-1603 report](../US-1603-outlook-poc/README.md)
   and do not capture mailbox text in logs or the task report.

8. **Report injection failures after removing the PoC timing log.** On renderer-side CDP attach or
   evaluation failure, warn with the extension id and a bounded host-side error message. When the
   wrapper returns its generic extension-failure result, warn with the id and a fixed message rather
   than the extension's arbitrary exception text:

   ```ts
   console.warn(`[site-extension] ${extension.id}: ${errMessage(error, "injection failed").slice(0, 256)}`);
   ```

   The `errMessage` warning is only for renderer-side CDP failures. Keep mailbox/page text out of
   both warning paths. Keep the `errMessage` import because the CDP warning uses it; if the
   implementation changes that warning to a static message, remove the now-unused import.

### Out of scope

- **US-1605:** registration UI, trust prompt/gate, enable/disable, and removal. EPIC-120 requires
  US-1604 and US-1605 to ship in the same release; this task intentionally injects every valid
  extension pending that paired trust work.
- **US-1606:** agent tools to scaffold, reload, list, or remove extensions. The store's list/status
  API is the extension point for that task.
- **US-1607:** authoring guides and agent workflow.
- **US-1612:** quieter shape-changed and same-document navigation events.

## Concerns

- The runtime's CDP injection is deliberately in the page's main world and runs with the signed-in
  site's privileges, as settled by EPIC-120. Trust is a required same-release follow-up in US-1605;
  no release should ship US-1604 without that gate.
- Manifest mtime is the specified cache invalidation key. Editors that preserve mtime when replacing
  `manifest.json` could leave stale parsed metadata until mtime changes; US-1604 should implement
  the settled mtime rule rather than introduce a separate watcher or reopen the decision.
- Script paths can be checked lexically with the existing renderer path API, but this API does not
  resolve symlinks. The folder is user-owned local data; keep the specified path traversal guard and
  document this limitation for implementation review if the chosen filesystem operations expose
  symlinks as a practical escape.

## Acceptance Criteria

- [x] Renderer store uses `<userData>/data/site-extensions/<id>/`, has no nested extension ids, and
  validates ids, all required manifest fields, exact lower-case hosts, and a default or contained
  relative script path.
- [x] Store index checks manifest mtime on each lookup/list and reparses only changed manifests;
  validates the resolved script exists and is a file on each index refresh; script contents are
  read fresh on every injection.
- [x] Store resolves its data root only after `fs.wait()` (prefer `await fs.dataFileName(...)`) and
  never reads `_dataPath` before filesystem initialization.
- [x] Host lookup enforces one valid extension per exact hostname: conflicting claimants are
  reported by `list()` and no claimant is injected for that host.
- [x] `list()` exposes valid, invalid-with-reason, and conflict status for US-1605/1606.
- [x] Injection remains HTTPS-only; private-page refusal is exactly `isIncognito || isTor` with no
  agent exception; in-page host re-check, double-injection marker carrying extension id, CDP attach
  with AI-vision binding, and post-injection probe remain.
- [x] Identical shape/version probes in one document generation do not register twice; changed
  shape/version and late-model discovery continue to work.
- [x] A null probe result does not clear a registration already installed for the same tab and
  generation by a concurrent probe; a null result with no same-generation registration still clears
  stale state as before.
- [x] Production `site-extension-runtime.js` is minified; the development runtime remains
  unminified.
- [x] Renderer-side injection failures produce a bounded warning with extension id and no page or
  mailbox content; the wrapper returns a generic failure code for extension exceptions.
- [x] PoC folder lookup and `site-extension-poc.ts` timing log/source module are removed; runtime
  and runtime IPC remain.
- [x] The local Outlook install uses the new manifest layout and its source comment/sample manifest
  no longer direct users to the PoC folder; it is not bundled with Persephone.
- [x] Throwaway documentation-host fixtures (`example.com`, `example.net`, `example.org`) prove
  valid, invalid-with-reason, and conflicting `list()`
  statuses; valid HTTPS injection/model registration; no injection for invalid/conflicting entries;
  and no injection for HTTP. Fixtures are deleted afterwards.
- [x] Persephone MCP verification records structure/counts and pass/fail only, with no mailbox text
  returned to or recorded by the agent.
- [x] US-1605 trust/UI, US-1606 agent tools, US-1607 guides, and US-1612 event noise are not
  implemented as part of US-1604.

## Files that need no changes

- `src/site-extension-runtime.ts` — productized injection still consumes this standalone runtime.
- `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, and `src/ipc/renderer/api.ts` — the
  existing `getSiteExtensionRuntime` endpoint is sufficient.
- `scripts/dev.mjs` — its development-only IIFE configuration remains unminified.
- `src/renderer/editors/browser/BrowserView.ts` — its existing `onDomReady` hook already invokes
  the injection method; keep the hook in place.
- `src/renderer/api/boards.ts`, `src/renderer/api/board-install-registry.ts`,
  `src/renderer/api/board-trust.ts`, and `src/renderer/editors/board/board-manifest.ts` — reference
  patterns only.
- `doc/tasks/US-1602-site-extension-injection-poc/README.md` and
  `doc/tasks/US-1603-outlook-poc/README.md` — source reports; do not rewrite them in US-1604.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/api/site-extensions.ts` | Add renderer store, manifest/script validation and cache, conflict-aware host lookup, and status listing. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Use store records for injection, carry extension id in marker, remove PoC logging, deduplicate registrations, preserve a concurrent registration on a null probe, and warn on injection failures. |
| `src/renderer/editors/browser/site-extension-poc.ts` | Delete PoC lookup, wrapper builder, and timing log. |
| `scripts/build-prod.mjs` | Minify the production site-extension runtime IIFE. |
| `<userData>/data/site-extensions/outlook/manifest.json` and `extension.js` | Install the sample Outlook extension as local user data; do not bundle it. |
| `doc/tasks/US-1603-outlook-poc/outlook-extension.js` | Update the source header for the local manifest-based install. |
| `doc/tasks/US-1603-outlook-poc/manifest.json` | Add the sample three-host Outlook manifest for the local install. |
| `doc/active-work.md` | Link the US-1604 dashboard entry to this task document. |
| `doc/epics/EPIC-120.md` | Link the US-1604 row to this task document. |
