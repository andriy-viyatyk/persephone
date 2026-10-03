# US-1607: Site extension authoring guide and agent workflow

**Epic:** [EPIC-120: Site extensions](../../epics/EPIC-120.md) · **Status:** Planned

## Goal

Give an agent that has only Persephone's built-in guides enough information to decide when a site extension is useful, author it safely from a web page's structure, iterate through the user-owned trust gate, and verify and use the resulting model. Keep the full site-extension workflow in a new agent guide, with concise pointers from the existing AI Vision and browser guides.

## Background

EPIC-120's post-PoC decisions define an extension as a script for exact HTTPS hosts, stored as `<root>/<id>/manifest.json` and `extension.js`. The root defaults to `<userData>/data/site-extensions` and can be changed with `site-extensions.path`; trust is bound to that root, so changing the folder drops all grants. Hosts have no wildcard or port matching, and duplicate valid claims conflict. See [EPIC-120](../../epics/EPIC-120.md), “Decisions (after the proof of concept)” and “Decisions for trust (US-1605, 2026-10-03)”.

An extension runs in the signed-in page's main world and can do what the page can do. `siteExtensions.create()` only scaffolds files; it never trusts the extension. The user alone clicks **Trust** in the browser page's trust bar. Editing a trusted script is applied on reload without a new prompt, so an agent must not expand the script's behavior beyond the user's request. Changing `hosts` prompts for trust again. These are documented in EPIC-120 and the `siteExtensions` descriptor help in `src/renderer/scripting/ai-vision/namespaces/site-extensions.ts`.

The authoring workflow is grounded in these existing contracts:

- `src/renderer/api/types/site-extensions.d.ts` defines `ISiteExtensions` and create/reload/list result shapes. `src/renderer/api/site-extensions-agent.ts` contains the starter script and implements `folder`, `list()`, `create(id, options)`, `reload(pageId)`, and `remove(id)`. The agent writes edits using `app.fs.write(...)`; there is no separate script-write tool.
- `src/renderer/scripting/ai-vision/namespaces/site-extensions.ts` documents reload's statuses (`injected`, `waiting-for-user`, `disabled`, `no-extension`, `extension-error`, `not-current`) and the user-only Trust bar. `reload(pageId)` re-injects in the current document and waits up to 3,000 ms for registration; `registered: false` after that deadline does not mean script evaluation failed.
- `src/site-extension-runtime.ts` exposes `expose`, `createElements`, `onDispose`, `dispose`, and `schemaVersion` on `window.__persephoneSiteRuntime`. In-place reload invokes registered cleanup callbacks before disposing the remote handle. The starter in `site-extensions-agent.ts` calls `remote.refresh()` after exposing its model, because the initial page probe may have already happened.
- The US-1603 report, [“Changes US-1604 onward need”, item 7](../US-1603-outlook-poc/README.md#changes-us-1604-onward-need), records the authoring lessons: call `refresh()` once after a late `expose()`; a virtualized list's scroller may be inside its `listbox`; wait for a **changed** result set because a site may replace results in place; report newly seen items using layout position and a seen-set rather than “the first row changed”; and study DOM structure with probes that return structure, never page text. The report's “The model” section and “Test data” section establish the data boundary: list results contain headers only, body text is returned only through explicit `read(id)`, and no private mailbox content belongs in the report or agent context.
- `assets/guides/agents/ai-vision.md` is the style and base reference: its board authoring sections are example-driven; “Rules that will bite you” and “Checklist” make trust, cleanup, validation, refresh, and end-to-end verification explicit. Its current “Web pages in the browser editor” section is the reference for a site developer whose own page publishes a model (probe behavior, versioning, the `page:` data boundary); US-1607 keeps it, distinguishes it from extension authoring, and links to the new end-to-end guide.
- `assets/guides/agents/browser.md` is the browser automation reference; it owns browser page targeting, snapshots, and `evaluate()`. It will gain only a brief pointer for a page an agent will use repeatedly.
- The agent overview is `assets/guides/agents/index.md`; the user-facing collection index is `assets/guides/index.md`.

### Guide discovery findings

Guide paths are derived from markdown files; there is no manifest for the in-app tree or `guides.search`:

- `src/renderer/guides/guide-source.ts` (`RendererGuideSource`) roots the renderer source at `api.getAssetsPath("guides")` and enumerates directory entries. `src/renderer/guides/index.ts` creates the shared renderer `GuideIndex` from that source. `src/shared/guides/index.ts` (`createGuideIndex`) recursively scans directories and indexes every `.md` file; `search()` searches all indexed pages. `src/renderer/editors/about/AboutGuideBrowserView.ts` (`loadContents`) builds the About guide tree from `getGuideIndex().getTree(...)`, showing agent pages when **Show agent guides** is on. A new `assets/guides/agents/site-extensions.md` is therefore automatically added to the About tree and renderer search. No About-browser registration code is needed.
- Main-process discovery is also corpus based: `src/main/mcp/ai-vision/guide-source.ts` (`MainGuideSource`) reads the guides directory; `src/main/mcp/ai-vision/main-root.ts` constructs `GuidesNode` with `createGuideIndex(...)`; and `src/main/mcp/ai-vision/guides.ts` (`GuidesNode.search`) delegates to the same index. A new agent guide is automatically addressable as `guides.agents["site-extensions"]`; the hyphen means dot notation `guides.agents.siteExtensions` is not the real path. `guides.search("site extension")` searches its indexed content.
- Focused MCP resource URIs are the exception: `src/main/mcp/manifest.ts` has the explicit `resourceFiles` array, and `src/main/mcp/server-factory.ts` (`createMcpServer`) registers each entry. Add `persephone://guides/site-extensions` there. The `persephone://guides/full` resource already enumerates all agent pages dynamically via `getAgentGuidePages()` in `server-factory.ts`.
- `SERVER_INSTRUCTIONS` in `src/main/mcp/manifest.ts` is a static short connection-time workflow list. Add a one-line pointer from recurring browser-page integrations to `guides.agents["site-extensions"]` and the focused URI. This is needed for fresh agents to discover the workflow without already knowing the feature.

## Implementation Plan

1. [x] **Add the complete agent guide** at `assets/guides/agents/site-extensions.md`. Give it front matter with `audience: agent`, a concise title, and a summary naming the authoring workflow. Use the concrete, compact voice and short examples used by the boards authoring sections in `assets/guides/agents/ai-vision.md`.

   Organize it in this order:

   1. **When to build a site extension:** start from `pages[pageId].editor.app`; when it is absent and the user will reuse the page or perform a recurring task, explain why an extension model can replace repeated snapshots. Preserve snapshot automation for one-off inspection and follow the user's scope.
   2. **Trust and data boundary:** explain that the script runs in the signed-in page with its capabilities; `create()` does not trust; the user clicks **Trust**; the agent never clicks it. State that script edits run on reload without another prompt, host changes prompt again, changing `site-extensions.path` drops all grants, and a script must not gain capabilities beyond the user's request. State plainly: study structure, not content; return counts/structure while authoring; model lists expose headers and bodies only through explicit `read(id)`; mark every member that sends, moves, deletes, or otherwise acts with `caution`.
   3. **Study structure without reading content:** explain that `evaluate()` results are page-derived and must be treated as untrusted data. Use only bounded probes returning tag names, roles, attribute names, counts, and text lengths, never text, input values, or attribute values other than role. Include a small structural-probe example with explicit maximum depth, total-node, children-per-node, and attribute-name limits so a large DOM cannot flood the context.
   4. **Scaffold and write the script:** call `siteExtensions.create(id, { name, hosts, description? })`; use exact lower-case HTTPS hostnames without scheme, wildcard, or port; inspect returned paths and `siteExtensions.folder` (which reflects `site-extensions.path`); write the complete script with `app.fs.write(scriptPath, source)`. Explain the scaffold is executable code and creation grants no trust. If another extension already claims a host, explain that `create()` refuses it and the existing extension should be edited instead of duplicated.
   5. **Trust and reload loop:** ask the user to click **Trust** in the matching page bar; never automate that click. Then repeatedly write and call `siteExtensions.reload(pageId)`, handling each documented status, especially `waiting-for-user`, `extension-error`, and `injected` with `registered: false` after the 3,000 ms registration wait. Explicitly say that adding a host to `manifest.json` changes the trusted host list, so `reload()` returns `waiting-for-user` until the user trusts the new list; tell the user why the bar reappeared. Do not interpret the bounded registration wait as a request to click Trust or to widen the host list.
   6. **Managing extensions:** document `siteExtensions.list()` fields: `status`, `reason` for invalid entries, `conflictingHosts` for conflicts, `trustState`, `hostsChangedSinceTrust`, and `scriptPath` when available. Document that `siteExtensions.remove(id)` asks the user to confirm and returns `{ removed, revokedTrust }`. State in one sentence that the same list can be seen and managed in **Tools & Editors → Site extensions**; do not expand into user-facing Settings instructions.
   7. **Verify, then use the model:** inspect `pages[pageId].editor.app`, read `.app.$help`, validate a small header/count result and one explicit `read(id)` only when requested, and call `refresh()` after late `expose()`. Once verified, use `.app` methods and properties instead of page snapshots; return to snapshots only for structure or controls the model does not represent.
   8. **Authoring rules and checklist:** explain descriptor allow-lists, stable ids and semantic roles/labels, bounded results, mutation refresh, cleanup for every observer/listener/timer using `onDispose`, and how to test a virtualized list. Include the US-1603 lessons: locate the scroller inside the listbox if necessary; wait for a changed result set; for new items scroll to the top, compare layout positions, and track a seen-set instead of trusting row order or `aria-posinset` alone.
   9. **Complete generic example:** include one small, public-site-agnostic `extension.js` that discovers generic `[role="list"]` / `[role="listitem"]` items by role plus stable item id/label attributes; returns only id and header metadata in the collection; provides explicit `read(id)` for an item's body; observes relevant list mutations and calls `remote.refresh()` when its shape changes; registers `MutationObserver.disconnect()` with `runtime.onDispose()`; and has one `activate(id)` (or equivalent) action whose descriptor member carries `caution`. The example must not use Outlook selectors or mailbox data, and its prose must tell the author to adapt selectors and fields to the site.

   The structural-probe example should make its output budget visible and return metadata only, for example:

   ```js
   const structure = await pages[pageId].editor.evaluate(`() => {
       const MAX_NODES = 60;
       const MAX_DEPTH = 4;
       const MAX_CHILDREN = 8;
       const MAX_ATTRIBUTES = 16;
       let visited = 0;

       function describe(element, depth) {
           if (!element || visited >= MAX_NODES || depth > MAX_DEPTH) return null;
           visited++;
           const children = Array.from(element.children)
               .slice(0, MAX_CHILDREN)
               .map(child => describe(child, depth + 1))
               .filter(Boolean);
           return {
               tag: element.tagName.toLowerCase(),
               role: (element.getAttribute("role") || "").slice(0, 64),
               attributeNames: Array.from(element.attributes)
                   .slice(0, MAX_ATTRIBUTES).map(attribute => attribute.name.slice(0, 64)),
               attributeCount: element.attributes.length,
               childCount: element.children.length,
               textLength: (element.textContent || "").length,
               children,
           };
       }
       return { structure: describe(document.body, 0), visited };
   }`);
   ```

   Explain that `evaluate()` returns page-derived data. The result contains no text, labels, values, or attribute values other than the semantic role; `textContent` is measured locally only to return its length.

2. [x] **Preserve and clarify the existing AI Vision page** in `assets/guides/agents/ai-vision.md`. This section is for site developers who can change their own page code; site-extension authoring is the separate path for agents who cannot change the site. Add a short opening paragraph distinguishing those cases and linking the latter to the new guide. Keep the rest of the section intact, including its `ai-vision/remote` import, `registerAiVision` / `registerAiVisionFor` distinction, host-side discovery/version behavior, and `page:` rules. Update only the stale discovery bullet: `BrowserWebviewModel.handleAiVisionSignal()` calls `scheduleLateAiVisionProbe()` when no registration exists, and that method schedules a trailing probe if rate-limited; a late-publishing model is found when it calls `remote.refresh()` once after `expose()`.

   Before:

   ```md
   A page the user opens in Persephone's browser can publish the same way. Here the page **does**
   depend on the package:
   ...
   - **Discovery is a probe, not a handshake.** Persephone looks for `window.__aiVision` after a
     completed navigation. Publish it as part of page startup rather than behind a user action.
   ```

   After:

   ```md
   If you can change the site's own code, publish its model as described here. If you cannot
   change the site and want a reusable model for its page, read [Site extensions](./site-extensions.md)
   for the agent-authored extension workflow.

   A page the user opens in Persephone's browser can publish the same way. Here the page **does**
   depend on the package:
   ...
   - **Late model discovery.** If a model is published after page load, call `remote.refresh()` once
     after `expose()`. Persephone handles the signal and probes again, including a trailing probe if
     the late-probe rate limit would otherwise defer it.
   ```

   Keep all existing paragraphs and the remaining host-side bullets after these edits.

3. [x] **Add the browser pointer** in `assets/guides/agents/browser.md`, directly after the opening page targeting example or under “Hosts and members”. Add one paragraph: when the user will use a page repeatedly and `pages[pageId].editor.app` has no model, read [Site extensions](./site-extensions.md) to author one. Keep browser snapshot and evaluation reference content otherwise unchanged.

   Before → after:

   ```md
   ## Hosts and members
   ```

   ```md
   ## Hosts and members

   For a page you will use repeatedly with no `pages[pageId].editor.app` model, read
   [Site extensions](./site-extensions.md) to build a reusable model.
   ```

4. [x] **Register the guide in the agent overview** at `assets/guides/agents/index.md`. Add a task-routing row beside the existing web-page / model rows, pointing to `siteExtensions.create`, `guides.agents["site-extensions"]`, and `persephone://guides/site-extensions`.

   Before → after:

   ```md
   | Drive a web page / board / the app UI | `pages[i].editor` / `window.screen` | node `$help` and `persephone://guides/browser` |
   ```

   ```md
   | Build a reusable model for a web page with no `.app` model | `siteExtensions.create` → `app.fs.write` → `siteExtensions.reload` | [Site extensions](./site-extensions.md) / `guides.agents["site-extensions"]` |
   | Drive a web page / board / the app UI | `pages[i].editor` / `window.screen` | node `$help` and `persephone://guides/browser` |
   ```

5. [x] **Register the focused MCP resource and discovery hint** in `src/main/mcp/manifest.ts`:
   - Add a `resourceFiles` entry named `site-extensions-guide`, URI `persephone://guides/site-extensions`, file `guides/agents/site-extensions.md`, with a short authoring-workflow description. The `resourceFiles` array is consumed by the registration loop in `src/main/mcp/server-factory.ts`.
   - Add one concise `SERVER_INSTRUCTIONS` item pointing agents building a reusable browser-page model to `guides.agents["site-extensions"]` and `persephone://guides/site-extensions`.

   Before → after for the instruction list:

   ```ts
   "For Persephone controls, start with `guides.screens` or `guides.screens.index`; for browser automation use `guides.agents.browser`. The focused `persephone://guides/*` resources remain available as an alternative.",
   ```

   ```ts
   "For Persephone controls, start with `guides.screens` or `guides.screens.index`; for browser automation use `guides.agents.browser`. For a reusable model on a page without `.app`, read `guides.agents[\"site-extensions\"]` or `persephone://guides/site-extensions`. The focused `persephone://guides/*` resources remain available as an alternative.",
   ```

   No changes are needed to `src/renderer/guides/*`, `src/shared/guides/index.ts`, `src/main/mcp/ai-vision/guides.ts`, or the About browser: those scan and index markdown files dynamically. No change is needed for `persephone://guides/full`, which builds its contents from the dynamic agent-guide tree.

6. [x] **Keep this task agent-facing.** Do not change the user-facing Settings guide or Tools & Editors tab documentation. Documentation of the Settings section and Tools & Editors tab belongs to `/userdoc` at EPIC-120 close, as directed by the epic decisions. Do not add unit tests or a test harness; verify discovery by the existing dynamic index contracts and task acceptance criteria.

## Concerns / Open Questions

- **Guide path includes a hyphen.** With the required filename, its canonical key is `agents/site-extensions`, so the actual call path is `guides.agents["site-extensions"]`, not `guides.agents.siteExtensions`. Keep this exact path consistent in the guide, index, MCP instruction, resource URI, and acceptance criteria.
- **Examples must not teach content extraction during discovery.** The structural probe may measure `textContent.length` locally but must not return text, input values, or page-derived strings. Its result is page-derived. Enforce depth, node, child, and attribute-name caps so a large DOM cannot flood the agent context. The example's body read belongs behind an explicit `read(id)` call; its collection must stay header-only.
- **Reload does not grant trust.** `waiting-for-user` is expected until the user approves in the page. The authoring loop must leave the decision with the user. Because script edits do not re-prompt, the guide must make the scope constraint explicit before reload.
- **No unresolved design questions.** All registration surfaces and paths are determined from the current guide source, MCP manifest, and epic decisions above.

## Acceptance Criteria

- `assets/guides/agents/site-extensions.md` gives a fresh agent reading only `guides.agents["site-extensions"]` (or `persephone://guides/site-extensions`) a complete workflow from detecting a missing model through structure-only DOM study, scaffold/edit, user Trust, reload/status loop, `$help` verification, and using the model instead of snapshots.
- The guide documents `siteExtensions.list()` fields, user-confirmed `remove(id)` and `{ removed, revokedTrust }`, the Tools & Editors → Site extensions management surface, and editing an existing extension instead of duplicating a claimed host.
- Structural-probe example results are explicitly page-derived and bounded by node count, depth, children per element, and attribute-name count; they return only tag names, roles, attribute names, counts, and text lengths.
- The reload workflow explains that adding a host to `manifest.json` changes the trust set, yields `waiting-for-user`, and requires explaining to the user why the Trust bar reappeared.
- `guides.search("site extension")` finds the guide through the markdown corpus index; the About guide browser includes it when agent guides are shown; the focused MCP resource URI returns it.
- The guide states the data and trust rules plainly, including headers-only lists, explicit body reads, caution on acting members, no agent Trust click, no trust on create, changed-host prompting, reset-on-folder-change, and the script-scope rule for reload without a prompt.
- The guide includes the US-1603 authoring lessons and one concise complete generic example with `refresh()`, `onDispose()` cleanup, explicit `read(id)`, and a caution-marked action.
- `assets/guides/agents/ai-vision.md` preserves the full site-developer section, adds an opening paragraph distinguishing site-owned models from agent-authored extensions, and accurately documents late-model discovery via one `remote.refresh()` after `expose()`; `assets/guides/agents/browser.md` has one brief pointer; `assets/guides/agents/index.md` routes agents to the guide.
- `src/main/mcp/manifest.ts` registers `persephone://guides/site-extensions` and adds a concise server-instructions pointer. No dynamic renderer or About-browser registration code is added.
- The task remains agent-facing: no Settings / Tools & Editors user-facing documentation, unit tests, or harnesses are added.

## Files Changed Summary

| File | Planned change |
|---|---|
| `assets/guides/agents/site-extensions.md` | **New.** Full concise, example-driven site-extension workflow and authoring rules. |
| `assets/guides/agents/ai-vision.md` | Preserve “Web pages in the browser editor”; add an opening audience distinction and update late-model discovery to document `remote.refresh()` after `expose()`. |
| `assets/guides/agents/browser.md` | Add one paragraph directing recurring page-model authoring to the new guide. |
| `assets/guides/agents/index.md` | Add task routing for `siteExtensions` authoring and the canonical guide key. |
| `src/main/mcp/manifest.ts` | Add the focused guide resource and concise server-instructions discovery line. |
| `src/main/mcp/server-factory.ts` | **No change.** It registers each `resourceFiles` entry and builds `/full` from the dynamic agent guide tree. |
| `src/renderer/guides/guide-source.ts`, `src/renderer/guides/index.ts`, `src/shared/guides/index.ts` | **No change.** Renderer corpus scanning and search include markdown files recursively. |
| `src/main/mcp/ai-vision/guide-source.ts`, `src/main/mcp/ai-vision/main-root.ts`, `src/main/mcp/ai-vision/guides.ts` | **No change.** Main-process guide tree and `guides.search` use the dynamic corpus index. |
| `src/renderer/editors/about/AboutGuideBrowserView.ts` | **No change.** The About tree reads the dynamic index and filters agent pages with its existing toggle. |
| `assets/guides/index.md` and Settings / Tools & Editors user guide pages | **No change.** This task adds an agent-only guide; user-facing documentation is deferred to `/userdoc` at epic close. |
| `src/renderer/api/site-extensions-agent.ts`, `src/renderer/api/types/site-extensions.d.ts`, `src/renderer/scripting/ai-vision/namespaces/site-extensions.ts`, `src/site-extension-runtime.ts` | **No change.** US-1606 has already shipped the API, descriptor help, starter, and runtime contract this guide documents. |
| `doc/active-work.md`, `doc/epics/EPIC-120.md` | Link this task from the EPIC-120 Active work block and mark its linked-task row Planned. |

## Verification (2026-10-03)

- Discovery, through the live MCP:
  - `guides.search("site extension")` returns `agents/site-extensions` (title match, score 300);
  - `guides.agents["site-extensions"]` returns the guide;
  - `persephone://guides/site-extensions` returns it as `text/markdown`.
- The structural probe ran on a public page through `call` → `pages["<id>"].editor.evaluate`. It returned only tags, roles, attribute names, counts and text lengths: 13 nodes and no text.
- The example extension's source parses.
- Codex ran `npm run typecheck`, `npm run lint` and `npm run build-prod`; all pass.

### Corrections made during review

- **`refresh()` pattern.** The example called `remote.refresh()` whenever any item's id or label changed. Each `refresh()` logs a `shape-changed` event, and the item shape is probed only once (`ai-vision.md` § "refresh() — the gotcha"). The example now refreshes only when the collection becomes non-empty or empty. The checklist explains why, and adds `remote.notify(text)` for announcing new items.
- **Probe invocation.** The guide showed `pages[pageId].editor.evaluate(...)` as script code. `pages` is a call path, not a `script.execute` global, and `app.pages[id].editor.evaluate` is undefined in a script. The probe is now presented as a `call` with the function as the single `args` string.
