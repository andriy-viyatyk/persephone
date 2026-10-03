# US-1605: Site extension registration and trust

**Epic:** [EPIC-120](../../epics/EPIC-120.md) | **Status:** Planned; must ship in the same release as US-1604  
**Depends on:** [US-1604](../US-1604-site-extension-store/README.md)

## Goal

Gate site-extension injection on main-owned, user-approved trust bound to the extension id and its exact host list. Add an in-browser-page consent bar and a Settings section to enable, revoke, inspect, open, and remove extensions, while preserving the existing private-page rules.

## Background

- EPIC-120's **Decisions for trust (US-1605, 2026-10-03)** are settled: trust is keyed by extension id and host list; source edits do not require new consent; changing hosts does. Main owns `<userData>/data/trustedSiteExtensions.json` and broadcasts the authoritative snapshot to every window. Trust is never read from the extension folder or exposed on `app`/to scripts. There is no automatic trust, including for agent-created extensions.
- US-1604 provides `siteExtensionStore.findForHost(host)` and `siteExtensionStore.list()` in `src/renderer/api/site-extensions.ts`. The listing has `valid`, `invalid` (with reason), and `conflict` status. `BrowserWebviewModel.injectSiteExtension()` in `src/renderer/editors/browser/BrowserWebviewModel.ts` is called after `dom-ready`; it rejects `isIncognito || isTor`, looks up the current HTTPS hostname, reads the script fresh, injects into the page main world, checks protocol/hostname again in-page, and probes after success. Keep this injection lifecycle and private-page check.
- **Trust reference.** The header of `src/renderer/api/board-trust.ts` documents US-1538's split: `BoardTrustService` in `src/main/board-trust-service.ts` owns and persists trust; `src/ipc/main/board-handlers.ts` binds typed endpoints; `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/renderer/renderer-events.ts`, and `src/renderer/api/board-trust-sync.ts` carry the contract and mirror. The service broadcasts with `openWindows.send(EventEndpoint.eBoardTrustChanged, ...)`, and `src/main/open-windows.ts` sends to all open windows. `src/main/main-setup.ts` initializes the owner before restored renderer windows request its data. Site-extension trust should use the same authoritative-main / reactive-renderer pattern, with its own file and event.
- **Browser prompt reference.** `BrowserEditorState.permissionPrompts` in `src/renderer/editors/browser/BrowserEditorModel.ts` holds tab-scoped prompts. `PermissionPromptBarView` in `src/renderer/editors/browser/BrowserView.ts` renders the active tab's prompt in the browser chrome; `BrowserEditorView.syncPermissionPrompt()` mounts and clears it. Give site-extension trust a dedicated bar in the same location and visual pattern. Do not reuse `PermissionPromptBarView`: its `requestId` and Allow/Block actions resolve browser permission requests through `BrowserEditor.resolvePermissionPrompt()`, while site-extension consent updates persistent main-owned trust and can inject a script into a live document.
- **Settings reference.** `src/renderer/editors/settings/settings-catalog.ts` defines the Browser group and section metadata; `src/renderer/editors/settings/SettingsView.ts` maps ids through `SECTION_VIEW_FACTORIES` and mounts sections. `BrowserProfilesSection.ts` is the browser management pattern; `BoardSettingsSection.ts` shows native controls and named controls. Register a `site-extensions` section in both catalog and factory. New controls need stable `data-name` values under `doc/architecture/ui-element-contract.md`'s control-addressing convention.
- **Agent-facing behavior.** An untrusted board is replaced with the explanatory `UntrustedBoardView`; its trust choice is a modal adapted by `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`. That adapter's `click` member carries the policy caution that Trust is the user's decision and agents should click only when the user explicitly asked. Site extensions use a non-modal browser bar, so add a read-only pending-trust status to the browser editor facade in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` with the same caution; do not expose a trust action in an AiVision dialog adapter. Use ordinary named bar controls (`data-name`) and the agent-facing caution policy, without adding a hard block to shared automation input paths.
- Keep US-1606 agent tools, US-1607 guides, and US-1612 event-noise changes out of this task. Do not add unit tests. Verification below is manual and uses counts/structure only; never inspect or return mailbox text.

## Implementation Plan

1. **Add main-owned site-extension trust persistence and IPC.** Add `src/main/site-extension-trust-service.ts`, following `BoardTrustService`'s serialized mutations and atomic JSON write pattern. Store `<userData>/data/trustedSiteExtensions.json` with presence of an id entry meaning trusted; entry hosts are the approved exact host list, and `enabled` is independent of trust:

   ```json
   {
     "version": 1,
     "extensions": {
       "outlook": {
         "hosts": ["outlook.cloud.microsoft", "outlook.office.com", "outlook.office365.com"],
         "enabled": true
       }
     }
   }
   ```

   Normalize host comparison as a set (order does not change the grant); require exact strings and reject malformed records when loading. `trust(id, currentHosts)` replaces that id's approved host list and enables it. `revoke(id)` removes the id entry. `setEnabled(id, enabled)` changes only an existing trusted entry. Persist before publishing the new authoritative snapshot; after every mutation broadcast it to all windows through `openWindows.send(EventEndpoint.eSiteExtensionTrustChanged, snapshot)`.

   Add the typed request/event contract in `src/ipc/api-types.ts`, renderer methods in `src/ipc/renderer/api.ts`, the event bridge in `src/ipc/renderer/renderer-events.ts`, and guarded handlers in a dedicated `src/ipc/main/site-extension-handlers.ts`, registered from `src/ipc/main/controller.ts`. Initialize the service from `src/main/main-setup.ts` before windows restore, matching the board trust startup order. The renderer must only request trust changes after a user action; no endpoint is added to the public `app` object model or script declarations.

   **Before â†’ after trust ownership / record:**

   ```ts
   // Before: US-1604 has no trust record; the renderer injects any valid store result.
   const extension = await siteExtensionStore.findForHost(pageUrl.hostname);
   if (!extension) return;

   // After: main's persisted snapshot is authoritative; entry presence is trust.
   type SiteExtensionGrant = { hosts: string[]; enabled: boolean };
   type SiteExtensionTrustSnapshot = Record<string, SiteExtensionGrant>;
   // <userData>/data/trustedSiteExtensions.json: { version: 1, extensions: snapshot }
   // Main mutation path: persist -> replace owner snapshot -> broadcast to every open window.
   await writeSnapshotAtomically(nextSnapshot);
   openWindows.send(EventEndpoint.eSiteExtensionTrustChanged, nextSnapshot);
   ```

   The exact implementation may keep versioning/writes private in the service; the ordering above is required. Endpoint signatures in `src/ipc/api-types.ts` should distinguish read snapshot, trust with the current host list, revoke, and enable/disable.

   **Before â†’ after IPC and broadcast:**

   ```ts
   // Before: injection runtime IPC exists, but no endpoint reads or changes extension trust.
   const runtime = await api.getSiteExtensionRuntime();

   // After: typed, sender-guarded calls reach the main owner; mutations broadcast the new snapshot.
   bindEndpoint(Endpoint.getSiteExtensionTrust, () => siteExtensionTrustService.getSnapshot());
   bindEndpoint(Endpoint.setSiteExtensionTrust, (_event, id, hosts) => siteExtensionTrustService.trust(id, hosts));
   rendererEvents[EventEndpoint.eSiteExtensionTrustChanged].subscribe((snapshot) => {
       siteExtensionTrust.applyAuthoritativeSnapshot(snapshot);
   });
   ```

2. **Add the renderer trust mirror.** Add `src/renderer/api/site-extension-trust.ts` with a `TGlobalState` mirror, load, synchronous lookup after load, subscribe support, and apply-authoritative-snapshot handling. Add `src/renderer/api/site-extension-trust-sync.ts` to subscribe to `eSiteExtensionTrustChanged` and apply the snapshot. Initialize this process-lifetime event wiring from `App.initEvents()` in `src/renderer/api/app.ts`, the existing internal bootstrap seam; do not register the trust mirror in `src/renderer/api/app-service-registry.ts`, because that table defines script-facing `app` services. Keep this module internal with no public `app` or script `.d.ts` surface. On Settings changes, apply the mutation response immediately and converge on main's broadcast snapshot.

   **Before â†’ after mirror:**

   ```ts
   // Before: BrowserWebviewModel has no trust mirror and cannot distinguish trusted extensions.
   const extension = await siteExtensionStore.findForHost(host);

   // After: sync check against the loaded main-authoritative renderer mirror.
   const grant = siteExtensionTrust.get(extension.id);
   const matchesApprovedHosts = grant && sameHostSet(grant.hosts, extension.hosts);
   ```

3. **Gate injection and model the prompt lifecycle.** Extend `BrowserEditorState` in `src/renderer/editors/browser/BrowserEditorModel.ts` with an ephemeral active/pending extension-trust prompt keyed by internal tab id and document generation. `BrowserEditor` already owns `getAiVisionDocumentGeneration(internalTabId)`; use that generation as the document identity. Reconcile pending prompts on navigation and trust broadcasts. In `BrowserWebviewModel.injectSiteExtension()` gate the existing injection path as follows:

   - If no valid, conflict-free `siteExtensionStore.findForHost()` result exists, do not inject or prompt.
   - Keep Incognito and Tor refusal exactly `state.isIncognito || state.isTor`; do not add an `openedByAgent` exception.
   - A grant injects only when the id exists, `enabled === true`, and its approved host set equals the current manifest host set. When trusted but disabled, do not inject or prompt.
   - When an enabled extension has no grant, or its host list no longer matches its grant, show a prompt for that tab/document. Display the exact sentence `Site extension <name> wants to run on <current host>`. If its manifest contains additional hosts, also display `It will also run on: <other hosts>` with every other host in the manifest's host list. Include the disclosure that the script can do anything available to the user's signed-in site session. The user must see every host before approving the whole list.
   - On **Trust**, re-read `siteExtensionStore.findForHost(prompt.host)` before writing any grant. Compare both the returned extension id and the entire host set with the id/list displayed by the prompt. If no current valid unique extension is returned, or its id/host set differs, do not write trust: replace/update the prompt from the newly-read listing (or show that the extension is no longer valid for this host, with no Trust action, if there is no current candidate). Only if id and host set still match may the user action call the internal trust mirror's main-backed mutation with that displayed host list, then invoke the same current-document injection path without reloading. Re-check HTTPS and `location.hostname` in the wrapper as US-1604 already does. **Not now** clears the bar and records dismissal only for this tab/document; switching tabs preserves its pending prompt, and a new document generation permits prompting again. It is not a persistent deny or trust decision.
   - Await `siteExtensionTrust.load()` before the first gate decision, since restored tabs may reach `dom-ready` before the later `App.initEvents()` broadcast subscription is installed. Re-check the current tab/document generation and current host after asynchronous trust/store/script reads, so a late completion cannot inject into a navigated document.
   - Extract the existing US-1604 source-read/CDP/wrapper/probe body into a private current-document helper so both normal `dom-ready` injection and the Trust action use the same checks and code path.

   **Before â†’ after injection gate:**

   ```ts
   // Before: BrowserWebviewModel.injectSiteExtension() in US-1604
   const extension = await siteExtensionStore.findForHost(pageUrl.hostname);
   if (!extension) return;
   let expression: string;
   try {
       const [source, runtime] = await Promise.all([
           fs.read(extension.scriptPath),
           api.getSiteExtensionRuntime(),
       ]);
       // Existing US-1604 wrapper, CDP evaluate, and post-injection probe follow.
   } catch { return; }

   // After: same method, before entering that existing path
   const extension = await siteExtensionStore.findForHost(pageUrl.hostname);
   if (!extension) return;
   const grant = siteExtensionTrust.get(extension.id);
   const hostsMatch = !!grant && sameHostSet(grant.hosts, extension.hosts);
   if (grant?.enabled && hostsMatch) {
       await this.injectTrustedExtensionIntoCurrentDocument(internalTabId, extension, documentGeneration);
       return;
   }
   if (grant && !grant.enabled) return;
   if (!grant || !hostsMatch) this.showSiteExtensionTrustPrompt(internalTabId, extension, documentGeneration);
   // Trusted + disabled: intentionally no injection and no prompt.
   ```

4. **Render the browser trust bar and carry the agent policy in its read-only surface.** In `src/renderer/editors/browser/BrowserView.ts`, add a dedicated `SiteExtensionTrustPromptBarView` beside `PermissionPromptBarView`, and sync it from `BrowserEditorView.sync()` for the active internal tab. Follow the existing `browser-permission-prompt` bar layout but use ordinary, distinct `data-name` values for `site-extension-trust`, `site-extension-not-now`, and prompt copy. Show the exact current-host sentence, all additional manifest hosts the grant covers, and the signed-in-session disclosure from step 3. Trust is an explicit user button; Not now is tab/document-scoped.

   Extend `BrowserEditorFacade.aiVision` in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` with a read-only pending prompt summary (extension name/id, current host, and the additional hosts). Add the board-style caution to this AiVision member: `Trust is the user's decision; never click it on your own judgement. Click only when the user has explicitly asked for that outcome.` Do not add a `trust()` method or a `dialogs[]` action adapter: this is a page bar rather than a modal. Keep the existing private-page access policy in `src/renderer/editors/browser/agent-access.ts` unchanged.

   **Before â†’ after prompt / agent surface:**

   ```ts
   // Before: BrowserView only renders browser permission prompts; facade exposes no extension consent state.
   const prompt = state.permissionPrompts.find((item) => item.internalTabId === state.activeTabId);
   // permission prompt buttons resolve allow/block for browser permission requests

   // After: independent site-extension prompt with ordinary named controls and read-only agent status.
   const prompt = state.siteExtensionTrustPrompts.find((item) =>
       item.internalTabId === state.activeTabId && item.generation === currentDocumentGeneration);
   // Display: "Site extension <name> wants to run on <current host>"
   // Plus every other host in prompt.hosts and the signed-in-session disclosure.
   // pages[i].editor.siteExtensionTrustPrompt -> { status, name, host, otherHosts }
   // Its AiVision member carries the caution: trust only on the user's explicit request.
   ```

   **Before â†’ after consent effect:**

   ```ts
   // Before: successful US-1604 injection happens only on dom-ready; no consent action exists.
   if (detail === "ok") this.probeAiVisionAgain(internalTabId);

   // After: re-read the prompted host; trust only if id and full host set still match what was shown.
   const current = await siteExtensionStore.findForHost(prompt.host);
   if (!current || current.id !== prompt.id || !sameHostSet(current.hosts, prompt.hosts)) {
       this.updateSiteExtensionTrustPrompt(internalTabId, generation, current);
       return; // no grant is written for a changed/unavailable candidate
   }
   await siteExtensionTrust.trust(current.id, prompt.hosts);
   await this.injectTrustedExtensionIntoCurrentDocument(internalTabId, current, generation);
   // Navigation since the prompt was rendered invalidates generation and cancels this action.
   ```

5. **Add the Settings section and controls.** Add `src/renderer/editors/settings/sections/SiteExtensionsSection.ts` (and a model file if the section needs isolated asynchronous/lifecycle state). Register id `site-extensions` in `src/renderer/editors/settings/settings-catalog.ts` in group `browser`, then add `"site-extensions"` to `SECTION_VIEW_FACTORIES` and import its view in `src/renderer/editors/settings/SettingsView.ts`. Merge `siteExtensionStore.list()` with the renderer trust snapshot by id. Render every extension with a display name (fall back to folder id when the current invalid listing has no validated name), status and invalid reason or conflicting hosts, manifest hosts where available, and trust state. The US-1604 invalid listing shape is `{ id, status: "invalid", reason }`, so show the id, reason, and no validated hosts for those entries; valid/conflict entries carry the name and host list. Invalid/conflict entries remain visible and cannot be newly trusted through Settings or injected while invalid/conflicted; an existing grant remains visible until revoked. Also render grant ids absent from `siteExtensionStore.list()` as `folder missing`, with **Revoke trust** as their only action.

   The section re-reads the store and trust snapshot on mount, after each of its own actions, on trust-mirror broadcasts, and when the user activates a **Refresh** button. The explicit Refresh action is required because `siteExtensionStore` has no filesystem change event; it lets a folder created by an agent or another process appear without closing/reopening Settings. Give the button the `data-name` value `site-extensions-refresh`.

   Each trusted entry has an **Enabled** switch; turning it off does not erase trust. **Revoke trust** removes the id's grant and is available for any entry with a grant. **Open folder** and **Remove** are available for every discovered extension directory, including invalid/conflicted entries. Orphan grants have only Revoke trust. Open folder uses the existing `api.openPath(extensionDir)` or the file-system reveal API after resolving the id under the `site-extensions` root. Remove opens `showConfirmationDialog()` and, only on explicit Delete, removes the folder recursively through `fs.removeDir()` and drops the grant through the main trust API. Use the existing confirmation and filesystem patterns in `src/renderer/api/board-install.ts`; ensure failure leaves the entry/grant recoverable and reports an error. Give the section and each new switch/button stable `data-name` values per `doc/architecture/ui-element-contract.md` (for example `settings-section-site-extensions`, `site-extensions-refresh`, `site-extension-enabled-<id>`, `site-extension-revoke-<id>`, `site-extension-open-folder-<id>`, and `site-extension-remove-<id>`).

   **Before â†’ after Settings registration and removal:**

   ```ts
   // Before: Browser group has browser-profiles, default-browser, and link-behavior.
   "browser-profiles": () => new BrowserProfilesSectionView({}),

   // After: catalog row plus built-in view factory
   "site-extensions": () => new SiteExtensionsSectionView({}),
   // SETTINGS_CATALOG section: id "site-extensions", title "Site Extensions",
   // elementName "settings-section-site-extensions", panelName "settings-panel-site-extensions"

   // Before: US-1604 has no management operation; its renderer store only lists/looks up folders.
   // After: explicit user confirmation precedes folder deletion, followed by dropping that id's grant.
   if (choice !== "Delete") return;
   await fs.removeDir(extensionDir, true);
   await siteExtensionTrust.revoke(extension.id);
   ```

6. **Define effects on already-injected documents.** A site-extension script executes arbitrary page-world code with the signed-in site's capabilities. Disabling, revoking trust, changing hosts, or removing its folder cannot safely undo code or side effects already in a live document. These changes update the main-owned gate immediately for future injections, but already-injected documents keep their current script/model until the user reloads or navigates them. Show this reload requirement in the Settings section after a trust/enabled/removal change; do not claim revocation rolls back page-world effects. The user Trust action is the exception: it injects into the current document immediately without reload.

   **Before â†’ after live-document behavior:**

   ```text
   // Before: US-1604 injects on dom-ready, with no trust changes to describe.
   // After: a trust/settings mutation blocks future injection; an injected live document remains
   // in its current state until reload/navigation, because arbitrary page-world effects are not reversible.
   // Trust from the prompt injects the newly approved extension into that current document immediately.
   ```

7. **Keep verification manual and privacy-bounded.** Use the following How to verify checklist; do not add unit tests.

## How to verify

- Use temporary extensions on `example.com`, `example.net`, and `example.org`: a valid minimal model on the first host, a missing-script invalid extension on the second, and two valid conflicting claimants on the third. Through `siteExtensionStore.list()` check status/reason and through browser evaluation check that only the valid, trusted, enabled HTTPS fixture gets the extension-id marker/model.
- Verify untrusted shows the bar with the current host, every other manifest host, and the signed-in-session disclosure; Trust updates the record and injects without reload only if a click-time re-read still matches the displayed id and full host list. Change the manifest between prompt display and Trust and verify the prompt updates without writing a grant. Not now stays dismissed for the current tab/document then returns on navigation; disabled, revoked, removed, HTTP, Incognito, and Tor cases do not inject. Check that the agent-facing read-only status carries the user-decision caution and reports `waiting-for-user`.
- Verify Settings mount, Refresh, own-action, and trust-broadcast refresh behavior. Delete an extension folder outside Settings and verify its remaining trust appears as `folder missing` with Revoke trust only; use Refresh to surface a newly-created fixture folder without reopening Settings. Verify that Remove confirmation cancellation preserves folder/grant while confirmation deletes the extension folder and grant. Check the reload notice for already-injected documents after disable, revoke, or remove.
- For the already-installed Outlook fixture, inspect only the model descriptor/member names, counts, version/registration state, and pass/fail. Never call `messages`, `read`, `search`, or any method/member returning subject, sender, preview, body, address, or other mailbox text; never take a content snapshot or put mailbox text in logs/report. Private-page checks remain the same as US-1604.
- Delete all temporary fixture folders after verification.

## Concerns

- **Live-document revocation is not reversible.** The extension executes arbitrary page-world JavaScript. A trust or enabled change can stop a future injection but cannot undo code or effects already applied to the current document. The plan states this explicitly and requires reload/navigation for existing documents; no settled trust decision is blocked by this limitation.
- **No other open question.** The trust file owner, host-list binding, no-auto-trust rule, prompt wording/location, and Settings actions are fixed by EPIC-120's 2026-10-03 decisions.

## Acceptance Criteria

- [x] Main owns `<userData>/data/trustedSiteExtensions.json`; its versioned id-keyed records contain the approved host list and independent `enabled` flag. Trust is never read from extension files or exposed as an `app`/script trust API.
- [x] Main persists trust mutations before broadcasting the authoritative snapshot to every renderer window; typed get/mutate IPC is sender-guarded and the renderer mirror follows main broadcasts.
- [x] Injection runs only for a valid, conflict-free extension when it is trusted, enabled, and its current manifest host set exactly matches the stored approved host set. Source edits do not prompt; host-list changes do.
- [x] Untrusted or stale-host extensions show the in-browser-page prompt naming the extension and current host, listing every other host in the grant, and explaining signed-in-session privileges. At Trust click, the current store result is re-read; if id or host set differs from the displayed prompt, no grant is written and the prompt is updated. A matching Trust injects into the current document without reload; Not now suppresses only that tab/document and prompts again after navigation.
- [x] Trusted but disabled extensions do not inject or prompt. Revoke removes trust. Trust/enable/revoke/remove changes prevent subsequent injections, and the UI explains that already-injected live documents need reload/navigation to drop their existing code/model.
- [x] Settings â†’ Browser â†’ Site Extensions lists name, status/reason/conflicting hosts, hosts, and trust; supplies Enabled, Revoke trust, Open folder, and confirmed Remove. Remove deletes the extension folder and drops its trust; Cancel preserves both.
- [x] Agent-facing browser editor state reports that an extension is waiting for user trust and carries the board-style caution that Trust is the user's decision and an agent may click only when the user explicitly asked. The browser bar uses ordinary `data-name` controls; no hard block is added to shared automation input paths.
- [x] Settings merges store entries with grants, displays orphan grants as `folder missing` with Revoke trust only, and re-reads on mount, after its own actions, on trust-mirror broadcasts, and through a Refresh button.
- [x] `isIncognito || isTor` remains the injection refusal condition without an agent-opening exception; other private-page access rules are unchanged.
- [ ] Manual verification uses only safe fixture hosts and Outlook counts/structure; no mailbox text is read, returned, logged, or included in the report. No unit tests are added.
- [x] US-1606, US-1607, and US-1612 work remains outside this task.

## Files that need no changes

- `src/renderer/api/site-extensions.ts` â€” US-1604's validated store and listing API are the source of extension metadata/status.
- `src/renderer/editors/browser/agent-access.ts` â€” preserve current private-page agent-access policy.
- `src/site-extension-runtime.ts` and the existing `getSiteExtensionRuntime` endpoint implementation in `src/ipc/main/core-handlers.ts` / `src/ipc/renderer/api.ts` â€” the injection runtime and runtime-serving behavior remain unchanged. `src/ipc/api-types.ts` does change to add trust endpoint/event declarations.
- `src/renderer/api/board-trust.ts`, `src/main/board-trust-service.ts`, `src/ipc/main/board-handlers.ts`, and `src/renderer/api/board-trust-sync.ts` â€” trust reference pattern only; do not alter board behavior.
- `src/renderer/editors/board/UntrustedBoardView.ts`, `src/renderer/editors/board/request-board-trust.ts`, and `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` â€” reference behavior only; site-extension consent is non-modal.
- `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` and `src/renderer/editors/settings/sections/BoardSettingsSection.ts` â€” reference patterns only; add the new section in its own module.
- `doc/tasks/US-1606-*`, `doc/tasks/US-1607-*`, and the US-1612 work â€” explicitly out of scope.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/main/site-extension-trust-service.ts` | Own, validate, serialize, persist, and broadcast the versioned trust snapshot in `trustedSiteExtensions.json`. |
| `src/ipc/main/site-extension-handlers.ts` | Register guarded get/trust/revoke/enable endpoints. |
| `src/ipc/main/controller.ts` | Register site-extension trust handlers. |
| `src/main/main-setup.ts` | Initialize trust owner before restored windows. |
| `src/ipc/api-types.ts` | Add trust snapshot types, request endpoints, and trust-changed event type. |
| `src/ipc/renderer/api.ts` | Add typed trust snapshot and mutation calls. |
| `src/ipc/renderer/renderer-events.ts` | Add the authoritative trust broadcast event. |
| `src/renderer/api/site-extension-trust.ts` | Add private reactive renderer mirror and trust lookup/mutations. |
| `src/renderer/api/site-extension-trust-sync.ts` | Initialize mirror and apply main broadcasts. |
| `src/renderer/api/app.ts` | Initialize trust-broadcast synchronization as internal process-lifetime event wiring in `App.initEvents()`. |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Add ephemeral tab/document-scoped pending prompt state. |
| `src/renderer/editors/browser/BrowserEditor.ts` | Clear/reconcile pending prompt state with document generations and trust updates; expose internal user-action handlers. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Enforce trusted + enabled + equal-host-list injection gate; prompt when missing/stale; trust-and-inject current document; preserve private-page refusal. |
| `src/renderer/editors/browser/BrowserView.ts` | Add the site-extension trust bar and Not now / user Trust controls. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Expose read-only waiting-for-user status with the board-style user-decision caution and no trust action. |
| `src/renderer/editors/settings/settings-catalog.ts` | Add Site Extensions under Browser. |
| `src/renderer/editors/settings/SettingsView.ts` | Register and mount the new built-in section. |
| `src/renderer/editors/settings/sections/SiteExtensionsSection.ts` | List extension status/hosts/trust and provide Enabled, Revoke, Open folder, and confirmed Remove controls. |
| `doc/active-work.md` | Replace the in-progress US-1605 placeholder with a linked task entry. |
| `doc/epics/EPIC-120.md` | Link the US-1605 row to this document. |

## Verification log (2026-10-03)

Fixes made during verification:

- **Document identity.** Prompts and injection now key on `BrowserWebviewModel.siteDocumentId()`, which counts cross-document `did-navigate` per tab. They no longer use the AiVision generation, because that generation also advances whenever a probe finds no model, and on an untrusted page a probe always finds none. Keyed that way, the prompt went stale and Trust had nothing to act on.
- The agent-facing `siteExtensionTrustPrompt` value now carries a `note` stating the user-decision rule, because member hints are sent only once per session.
- **Settings section.** Restyled to match Browser Profiles: `settings-native` helpers, a status badge, and inline actions. The reload notice now shows only after this section disables, revokes, or removes a trusted extension.

Verified live:

- **Prompt.** An untrusted extension shows the bar with the current host, the other hosts and the disclosure, and nothing is injected.
- **Agent view.** The agent-facing status reports `waiting-for-user`.
- **Not now.** It hides the bar, which returns after a reload.
- **Settings list.** It shows valid and invalid entries with the reason.
- **Remove.** Cancel keeps the folder; Delete removes it.

Pending: every check that needs a grant, because a grant is the user's Trust click. These are:

- trusted injection without a reload;
- Enabled off/on;
- Revoke trust;
- a changed host list prompts again;
- an orphan grant shows as "folder missing";
- a manifest change between the prompt and the click.
