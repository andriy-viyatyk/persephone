# US-1721: Scripting / MCP surface for right-pinned pages

**Epic:** [EPIC-132: Right-pinned pages in a popover](../../epics/EPIC-132.md)
**Scope:** R10 scripting and MCP discovery, live page summaries, public typings, and MCP agent-facing guidance. Human-facing guides are deferred to /userdoc at epic close.

## Goal

Expose right-pin and popover state/actions in the script and ai-vision object models while preserving activePage as the page the user works on. Update MCP discovery text and agent guides so consumers know a right-pinned page may appear over the active page without becoming active.

## Background

EPIC-132 R10 defines the required contract: page and pages.activePage remain the active workspace page; the right-pinned page is separately addressable and its popover does not activate it. R2 retains pinned as a left-only boolean and adds pinSide: "left" | "right" | undefined.

Verified in the working tree: US-1717 and US-1718 are staged. PageModel exposes pinSide, keeps pinned as pinSide === "left", and PagesModel owns popoverPageId, openPopover, closePopover, and pinTab(pageId, side) / unpinTab. The existing script wrapper still exposes only pinned, only one-argument pinTab, and no popover accessors. The ai-vision window list still serializes persisted p.pinned; PageTabNode likewise exposes only pinned. US-1719 is in progress in another session; do not edit source files during task-document authoring.

pages.popoverPage is the preferred wrapper surface, resolving popoverPageId to the page wrapper. The collection and page list remain based on pages[], including right-pinned pages. pages.activePage and root page remain tied to activePage. Extend the listing summary to mark the open popover independently (for example, ← popover) and label right-pinned entries, while preserving ← active on the active page.

## Progress

- [x] Expose side-aware page and collection scripting APIs and public declarations.
- [x] Update ai-vision descriptors, summaries, and root-page guidance.
- [x] Update MCP instructions and agent-facing guides.
- [x] Mirror public declarations to the IntelliSense bundle.
- [x] Confirm board bridge remains out of scope.
- [x] Run typecheck, lint, and production build.

## Implementation Plan

1. **Expose page pin side and side-aware pin actions** in src/renderer/scripting/api-wrapper/PageWrapper.ts, PageCollectionWrapper.ts, and public src/renderer/api/types/page.d.ts, pages.d.ts, and page-tab.d.ts.
   - Add read-only pinSide: "left" | "right" | undefined to PageWrapper and IPage; retain pinned with documentation that it means left-pinned only. Add pinSide to IPageTab and its ai-vision node/summarize output in src/renderer/scripting/ai-vision/page-tab.ts.
   - Change the collection wrapper and typings to accept pinTab(pageId, side?: "left" | "right"); the omitted side uses the model's default left pin. Keep unpinTab(pageId) explicit. Do not invent an API beyond current model semantics.
   - Add collection properties/actions popoverPage, openPopover(pageId), and closePopover(). popoverPage is the wrapper for popoverPageId, or undefined. Opening/closing does not change activePage.

   Before:
   ```ts
   get pinned(): boolean { return this.page?.pinned ?? false; }
   pinTab(pageId: string): void { this.pages.pinTab(pageId); }
   ```
   After:
   ```ts
   get pinSide(): "left" | "right" | undefined { return this.page?.pinSide; }
   get pinned(): boolean { return this.page?.pinned ?? false; } // left pin only
   pinTab(pageId: string, side?: "left" | "right"): void { this.pages.pinTab(pageId, side); }
   ```

2. **Update ai-vision descriptors, summaries, and $help** in PageWrapper.ts, PageCollectionWrapper.ts, src/renderer/scripting/ai-vision/page-tab.ts, and src/main/mcp/ai-vision/main-root.ts.
   - Add pinSide to page member descriptors, getter, aiSummary() object and page-tab member/help/summary. Describe pinned as left-only.
   - Add popoverPage, openPopover(id), and closePopover() to PAGES_MEMBERS, wrapper methods/getter, and IPageCollection typings. Collection $help must explain that activePage is what the user works on; a right-pinned page may display in a popover over it while active identity remains unchanged.
   - Extend aiChildren() labels alongside existing ← active to append ← popover to the popover page and identify right-pinned pages in each summary.
   - In main-process WindowNode.pages summaries, add pinSide and define legacy descriptors as left when pinSide is absent but pinned is true. Retain pinned as the left-only compatibility field. Keep activePageId sourced from persisted active identity.

   Before:
   ```ts
   pinned: this.pinned, active: pagesModel.activePage?.id === this.id,
   // summary suffix: active ? " ← active" : ""
   pinned: p.pinned,
   ```
   After:
   ```ts
   pinSide: this.pinSide, pinned: this.pinned,
   active: pagesModel.activePage?.id === this.id,
   // summary suffixes independently identify right pin, active, and open popover
   pinSide: p.pinSide ?? (p.pinned ? "left" : undefined),
   pinned: p.pinSide ? p.pinSide === "left" : p.pinned,
   ```

3. **Keep ai-vision root page semantics explicit.** In src/renderer/scripting/ai-vision/root.ts and src/renderer/scripting/renderer-script-target.ts, retain the current options.page ?? app.pages.activePage and default renderer target. Clarify root/page help and summaries where they describe page as active: it is the page the user works on; opening a right-pin popover does not replace it. Do not make a popover page the default MCP/script page.

4. **Update MCP server instructions — minimally** in src/main/mcp/manifest.ts (SERVER_INSTRUCTIONS). Add at most ONE sentence: page / pages.activePage address the active work page even while a right-pinned page is open in a popover over it; pages.popoverPage is that popover page. SERVER_INSTRUCTIONS and the `call` tool description are loaded into every agent's context, so do **not** add new examples to src/main/mcp/tools/call-tools.ts; discovery of openPopover / closePopover / pinSide happens through the `pages` node member list and `$help`.

   Before:
   ```text
   path: "page.content" -> text of the active page
   ```
   After:
   ```text
   page / pages.activePage are the page the user works on; a right-pinned page can be
   open in a popover over it without becoming active. Inspect pages.popoverPage or use
   pages[pageId] to work with that page.
   ```

5. **Update MCP agent-facing guide content** in the exact resources verified below. Keep human-facing UI guides out of this task.
   - assets/guides/agents/pages.md: update The page Object table with pinned left-only and pinSide; add the app.pages.popoverPage, openPopover(id), and closePopover() contract plus a short example. Correct statements that showPage / targeting always activates a page: showing a right-pinned page opens its popover while leaving active identity alone. Clarify that window.screen shows the active page with a popover potentially over it.
   - assets/guides/agents/index.md: clarify the page.content shorthand in the mental model and include the active-page/popover distinction near call path examples.
   - assets/guides/agents/ai-vision.md: clarify how page root and pages.activePage resolve while the popover is open, and document pinSide/popover state/actions as discoverable members.
   - src/main/mcp/manifest.ts registers assets/guides/agents/pages.md as guides.pages and assets/guides/agents/index.md as guides.agents.index; retain these paths. Inspect assets/guides/screens/* and assets/guides/formats/ui-push.md during implementation only for stale claims directly about active page/tab pinning; update only if found. Human UI guides such as assets/guides/screens/tabs.md are deferred to /userdoc at epic close.

   Before:
   ```md
   The current page (tab). Available as a global in scripts.
   | pinned | boolean | Whether the page is pinned |
   ```
   After:
   ```md
   page / pages.activePage is the active page the user works on. A right-pinned page
   can be shown in a popover over it; inspect pages.popoverPage.
   | pinned | boolean | Left-pinned only |
   | pinSide | "left" | "right" | undefined | This page's tab pin side |
   ```

6. **Mirror public declarations to the IntelliSense bundle.** assets/editor-types/pages.d.ts, page.d.ts, and page-tab.d.ts are present alongside authoritative src/renderer/api/types/*.d.ts files and must mirror corresponding changes. vite.renderer.config.ts has an editor-types plugin that copies declarations from src/renderer/api/types/ into assets/editor-types/; inspect and use its documented build/copy path during implementation. The source search found no dedicated declaration guard test, so verify this remains true when implementing rather than adding an unrelated test harness.

   Before:
   ```ts
   // src/renderer/api/types/page.d.ts and assets/editor-types/page.d.ts
   readonly pinned: boolean;
   ```
   After:
   ```ts
   readonly pinned: boolean; // left-only
   readonly pinSide: "left" | "right" | undefined;
   ```

7. **Confirm the board bridge is outside this task.** Do not edit src/renderer/editors/board/BoardWebview.ts, board bridge interfaces, board-side PersephonePageApi, or BOARD_BRIDGE_VERSION. EPIC-132 R10 explicitly puts board-side active-page reads and the corresponding version bump out of scope; page / pages.activePage are already the required MCP view of the active work page.

## Concerns

- pinTab(pageId, side?) already exists in PagesModel / PagesLayoutModel, with model default "left". Undefined as an explicit value is not a reliable unpin route because the default parameter selects left; expose unpinTab separately and preserve that behavior.
- PageWrapper can represent editorless pages; implement pinSide using its underlying page model/host just as pinned is resolved so right-pinned empty pages are represented accurately.
- src/main/mcp/ai-vision/main-root.ts reads persisted PageDescriptor values in main process. Maintain compatibility for old descriptors with only pinned.
- assets/editor-types contains direct copies of the three affected declarations. Keep copies synchronized and inspect for a guard/test; do not assume they are generated.
- Board-side active-page reads and BOARD_BRIDGE_VERSION are out of scope under R10. Any request to add that capability belongs in a separate board task.
- Human-facing guide updates are deferred to /userdoc at epic close; this task updates only MCP agent-facing documentation.

## Acceptance Criteria

- page.pinSide and pages[id].pinSide report "left", "right", or undefined; pinned is true only for left pins in wrappers, summaries, and docs.
- app.pages.pinTab(id, "right") pins right, default pinTab(id) pins left, and unpinTab(id) unpins.
- pages.popoverPage returns the currently open right-pinned page wrapper or undefined; openPopover(id) and closePopover() delegate to the model without changing activePage.
- pages.activePage and ai-vision root page remain the active page the user works on while a popover is open.
- Page-list summaries identify right pins and independently mark ← active and ← popover as applicable.
- Ai-vision page and page-tab descriptors expose pinSide; help explains active-versus-popover semantics and right-pin presentation.
- Main-process window page summaries include pinSide and preserve old pinned-only descriptors as left pins.
- SERVER_INSTRUCTIONS (one sentence, no new call-tool examples) and specified MCP agent guides explain access to popover pages without treating them as active.
- Three IntelliSense declaration copies under assets/editor-types/ match src/renderer/api/types/; any discovered declaration guard is updated accordingly.
- No board bridge or BOARD_BRIDGE_VERSION change is planned; the task documents the R10 scope boundary.

## Files Requiring No Changes

- src/renderer/api/pages/PagesModel.ts and PagesLayoutModel.ts: already provide pinSide, pinTab(pageId, side), unpinTab, popoverPageId, openPopover, and closePopover in staged US-1717 model work.
- src/renderer/scripting/renderer-script-target.ts: defaults script page to pagesModel.activePage; preserve this behavior.
- Board bridge files and BOARD_BRIDGE_VERSION: R10 explicitly excludes board-side active-page reads/version bump.
- Human-facing UI guides such as assets/guides/screens/tabs.md and other human docs: defer updates to /userdoc at epic close.

## Files Changed

| File | Planned change |
|---|---|
| src/renderer/scripting/api-wrapper/PageWrapper.ts | Add pinSide, document left-only pinned, add page summaries/help semantics |
| src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts | Add popover property/actions and side-aware pin wrapper; update summary labels/help |
| src/renderer/api/types/pages.d.ts | Type popoverPage, popover actions, and side-aware pinTab |
| src/renderer/api/types/page.d.ts | Add pinSide; clarify left-only pinned |
| src/renderer/api/types/page-tab.d.ts | Add tab pin-side typing |
| src/renderer/scripting/ai-vision/page-tab.ts | Expose pinSide in page-tab node, $help, and summary |
| src/renderer/scripting/ai-vision/root.ts | Clarify default root page remains active under popover |
| src/main/mcp/ai-vision/main-root.ts | Report pin side compatibly in persisted page summaries |
| src/main/mcp/manifest.ts | Explain active page vs popover in SERVER_INSTRUCTIONS; verify resources |
| assets/guides/agents/pages.md | Document pin side, popover controls and active page semantics |
| assets/guides/agents/index.md | Clarify active page shorthand while a popover is open |
| assets/guides/agents/ai-vision.md | Document ai-vision active page and popover semantics |
| assets/editor-types/pages.d.ts | Mirror collection declaration changes |
| assets/editor-types/page.d.ts | Mirror page declaration changes |
| assets/editor-types/page-tab.d.ts | Mirror page-tab declaration changes |
| Verified typing guard/test, if present | Keep IntelliSense declarations synchronized |
