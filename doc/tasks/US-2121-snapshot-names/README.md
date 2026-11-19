# US-2121: Snapshot names

Epic: [EPIC-199: Agent surface fixes from the ai-vision feedback log](../../epics/EPIC-199.md)

## Goal

Give interactive snapshots meaningful accessible names for icon buttons and tree rows, and stable data-name/id handles for the shell and editor elements identified by US-2121.

## Background

IconButtonView owns the root button and uses title to create/update a tooltip (src/renderer/uikit/IconButton/IconButtonView.ts). Its prop type already accepts aria-* through IconButtonProps; applyProps() passes those residual props through applyRestProps(). It does not currently derive an aria-label from title, so the proposed default must preserve a caller-provided aria-label while the tooltip behavior remains as is. This reuses the existing splitProps()/applyRestProps() residual-attribute path in src/renderer/uikit/shared/dom-props.ts.

TreeItemView owns each UIKit tree row (src/renderer/uikit/Tree/TreeItemView.ts). The root is a role=treeitem with aria-selected, aria-expanded, and aria-level; its children include the chevron host, optional icon, label, secondary label, and trailing content. For expandable rows, updateChevronIcon() gives a nested chevron button its localized aria-label (Expand/Collapse). The row currently has no aria-label/aria-labelledby, so Chromium's accessibility tree combines the nested button and visible row content. src/renderer/automation/snapshot.ts obtains the Chromium accessibility tree with Accessibility.getFullAXTree and formats each node's computed name.value. The row label is provided separately from its name/id; use the displayed item label, not identity or a filesystem path. Since TreeItemProps.label is SlotContent (string or rich content), use aria-labelledby to the label host, assigning that host a unique id with nextElementId() from src/renderer/uikit/shared/element-id.ts; that relationship names the displayed label and excludes the icon, chevron, and secondary/trailing content.

The US-2121 feedback entries are recorded under EPIC-188 / US-2074 (prefixed Explorer row name and root path), EPIC-189 / US-2078 (unnamed browser toolbar icon buttons), and EPIC-189 / US-2081 (unnamed download-row actions). Related source-backed gaps are EPIC-188 / US-2071 (MCP Inspector argument fields), EPIC-188 / US-2072 (Folder View mode control), EPIC-189 / US-2082 (browser permission controls), EPIC-190 / US-2089 (site-extension trust action), and EPIC-198 / US-2116 (browser translation popover). src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts owns BROWSER_ELEMENTS; src/renderer/scripting/api-wrapper/GridEditorFacade.ts owns GRID_ELEMENTS and GRID_EDITOR_HELP. The header list is HEADER_ELEMENTS in src/renderer/scripting/ai-vision/namespaces/ui-elements.ts. HeaderStatusIndicatorsView already emits data-name="audio-capture-indicator" and an ARIA label, but that name is absent from HEADER_ELEMENTS.

The browser translation popover discrepancy is specifically between feedback and current source: BrowserToolbarView.translatePopoverProps() passes name="translation-source-popover" to UIKit PopoverView, whose root emits that name as data-name. BrowserTranslationPopoverContentView separately emits data-translation-popover-content on the same supplied host and names its source-language SelectView translation-source-language. The popover is portaled outside the page slot, while EditorFacadeBase scopes BROWSER_ELEMENTS through pageScopeSelector(pageId); therefore keep these transient popover names for window.screen selectors and do not add them to BROWSER_ELEMENTS. The cited feedback asks for a data-name that current source already provides.

For the root-path report, TreeProviderViewModel uses TreeProviderNode.data.title as the row label; provider-tree-store.ts sets the root title to rootLabel ?? provider.displayName, and FileTreeProvider.displayName is path.basename(sourceUrl). The feedback's Folder View test helper separately documents full-path names for tile-mode generic rows. Those Folder View tiles are rendered through CategoryView's links-list/links-tile factories, not TreeItemView; this task scopes the row-name fix to UIKit treeitems and preserves the separate Folder View tile lookup. folder-view.test.mjs still needs the new mode-button selector.

The UI element contract defines data-name as the stable shell addressing handle and says adding names is safe. It requires updating a guide when an already-quoted contractual shell name is renamed. This task adds names and leaves existing contractual names unchanged.

## Implementation Plan

- [x] UIKit icon buttons — src/renderer/uikit/IconButton/IconButtonView.ts. In applyProps(), keep title as the tooltip source and construct residual props so a default aria-label equals title only when the caller did not supply aria-label. Let applyRestProps() continue to own explicit attribute updates/removals on mount and update. This makes the rule reusable for every IconButtonView caller without changing call sites. Existing explicit browser Translate aria-label remains authoritative.

  Before:

      const _rest = splitProps(props, [...checkedOwnKeys, ...ICONBUTTON_LEGACY_KEYS] as const);
      applyRestProps(this.root, _rest as Record<string, unknown>, this.restPropsState);

  After:

      const rest = splitProps(props, [...checkedOwnKeys, ...ICONBUTTON_LEGACY_KEYS] as const);
      if (rest["aria-label"] == null && props.title != null) rest["aria-label"] = props.title;
      applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);

  The example shows the ownership/precedence rule; retain the current complete prop splitting and update semantics.

- [x] UIKit tree rows — src/renderer/uikit/Tree/TreeItemView.ts. Assign the label host a per-instance id with nextElementId("tree-item-label") from src/renderer/uikit/shared/element-id.ts, then set the row's aria-labelledby to that host id in the same row prop/update path that sets role=treeitem. Keep updateChevronIcon() and its nested button's localized aria-label unchanged. TreeItemView owns the row accessible-name rule and reuses nextElementId() to support string and rich SlotContent labels.

  Before:

      root.setAttribute("role", "treeitem");
      root.setAttribute("aria-selected", selected ? "true" : "false");

  After:

      root.setAttribute("role", "treeitem");
      root.setAttribute("aria-labelledby", this.labelHostId);
      root.setAttribute("aria-selected", selected ? "true" : "false");

  Keep the label-host id stable for a pooled view's lifetime, keep the aria-labelledby reference current through updates, and ensure caller residual ARIA props retain established precedence. Intended output changes from treeitem "Expand 📁 project" to treeitem "project"; icon and chevron remain independently rendered and operable.

- [x] Menu action identity — src/renderer/ui/sidebar/menu-bar-folder-ui.ts. Add id: "open-terminal-here" to the genericMenu item whose label is t("shell.openTerminalHere"). MenuItem.id is supported by src/renderer/core/events/context-menu.ts; the menu call tree prefers a unique exact id before matching a label (src/renderer/scripting/ai-vision/menus/index.ts). The menu-bar folder UI owns this action identity; reuse the existing MenuItem.id contract.

- [x] Downloads row handles — src/renderer/editors/browser/BrowserDownloadsPopup.ts. Add name: "downloads-cancel" to the active-download Cancel ButtonView; add name: "downloads-show-in-folder" to the completed-row folder IconButtonView; add name: "downloads-dismiss" to the failed/cancelled-row close IconButtonView. Reuse each view's existing name prop and keep downloads-open, downloads-open-default-app, and downloads-clear unchanged.

- [x] Browser curated element declarations — src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts. Extend BROWSER_ELEMENTS with declarations for existing toolbar-translate, url-site-permissions, browser-permission-prompt, permission-allow, permission-block, permission-origin, and site-extension-trust names. These names are already emitted by BrowserToolbarView.ts and BrowserPromptBars.ts; the facade owns the curated list and reuses its IAiElementDeclaration/createElements() path, which scopes lookups to the owning page. Keep translation-source-popover and translation-source-language as direct window.screen selectors because their popover is portaled outside that page scope. Update assets/guides/editors/browser/layout.md with the prompt/trust controls, the existing translation popover selectors, and downloads-cancel, downloads-dismiss, and downloads-show-in-folder under the transient downloads-popup section; do not claim either popup is a permanent shell element.

- [x] Header curated element — src/renderer/scripting/ai-vision/namespaces/ui-elements.ts. Add audio-capture-indicator to HEADER_ELEMENTS, describing the active-audio-capture indicator and conditional visibility. HeaderStatusIndicatorsView already owns and emits this name; reuse the existing header element declaration format.

- [x] UI element contract — doc/architecture/ui-element-contract.md. Add audio-capture-indicator to the header status-indicator selector table. The contract already enumerates the shell status-indicator names; this existing shell data-name should be reflected alongside its new curated declaration.

- [x] MCP Inspector fields — src/renderer/editors/mcp-inspector/ToolArgForm.ts. Set data-name to mcp-arg-<argument-name> on each ArgFieldView root in its prop/update path. The keyed list uses argument name as its key, so the root remains the stable field wrapper while its control type changes; the form view owns the name and reuses KeyedList's existing argument key. Do not add these dynamic fields to static MCP_INSPECTOR_ELEMENTS: src/renderer/scripting/api-wrapper/McpInspectorFacade.ts explicitly says dynamic rows and argument fields are intentionally not enumerated.

- [x] Folder View mode control — src/renderer/components/tree-provider/CategoryView.ts and src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts. Set name: "folder-view-mode" on viewModeButton in both initial and update props. Add the same name to FOLDER_VIEW_ELEMENTS; CategoryView owns the control and FolderViewEditorFacade owns its curated element list. Reuse IconButtonView's name prop and the existing facade declaration format. In integration-test/tests/editors/folder/folder-view.test.mjs, use [data-name="folder-view-mode"], remove the stale comment that tree rows are prefixed with Expand/icon tokens, and keep the path-suffix matcher only for generic tile rows. Update assets/guides/editors/folder.md's user-facing-label-to-elements list and agent API paragraph with the selector.

- [x] Grid help consistency — src/renderer/scripting/api-wrapper/GridEditorFacade.ts. Keep the existing grid-column-filter entry in GRID_ELEMENTS (it has a reveal selector and is already documented in assets/guides/editors/grid.md); add it to the curated element names enumerated in GRID_EDITOR_HELP. Do not duplicate the declaration or grow a roadmap §2.3 god file. Add a focused assertion to integration-test/tests/editors/grid/grid.test.mjs that editor.elements contains grid-column-filter and $help names it.

- [x] Update affected integration coverage (Claude runs the suite; no unit tests or test harnesses). Update these modules:

  - integration-test/tests/helpers/sidebar-helpers.mjs: replace the "Expand 📁 " and broad substring fallback with an exact treeitem accessible-name match.
  - integration-test/tests/sidebar/explorer/explorer.test.mjs: assert the fixture root is named exactly explorer-navigation in the interactive tree snapshot, alongside the existing exact child-row checks.
  - integration-test/tests/tools/git/git-tree.test.mjs: change the optional-prefix .git matcher to exact treeitem ".git" and assert the ref still resolves.
  - integration-test/tests/browser/downloads/downloads.test.mjs: locate Cancel by [data-name="downloads-cancel"] rather than localized snapshot text.
  - integration-test/tests/tools/mcp-inspector/mcp-inspector.test.mjs: fill the path argument using [data-name="mcp-arg-path"] [data-type="textarea"] instead of nth: 0.
  - integration-test/tests/tools/mneme/mneme.test.mjs: replace nth argument targeting with [data-name="mcp-arg-folder"] [data-type="textarea"] and [data-name="mcp-arg-name"] [data-type="textarea"] for add_root.
  - integration-test/tests/capabilities/terminal/terminal.test.mjs: call menus[0].click with "open-terminal-here" in both cases instead of the localized label.
  - integration-test/tests/browser/permissions/permissions.test.mjs: assert the browser facade declares the existing permission/prompt names and exercise a titled icon-button name in an interactive snapshot.
  - integration-test/tests/capabilities/audio/audio.test.mjs: assert ui.elements declares audio-capture-indicator in addition to its existing DOM-selector behavior.
  - integration-test/tests/editors/grid/grid.test.mjs: add the help/list consistency assertion above.

  The path-based fallback for generic tile rows in integration-test/tests/editors/folder/folder-view.test.mjs is intentionally retained: it targets CategoryView's separate links-tile renderer, outside the TreeItemView accessible-name change. Its treeitem matching/comment and Folder View mode-button selector change; tile-row matching stays path-aware.

- [x] Menu id guide — assets/guides/screens/menu-bar.md. Document the open-terminal-here id next to the existing “Open Terminal here” context-menu action so agents can call the item by its stable id. The user-facing assets/guides/tabs-and-navigation/menu-bar.md continues to describe the visible label and needs no change.

### Files that need no changes

- src/renderer/automation/snapshot.ts: already reads Chromium's computed AX name.value; the UI must supply the accessible-name relation.
- src/renderer/uikit/shared/dom-props.ts: splitProps() and applyRestProps() already own residual ARIA attribute updates; IconButtonView reuses these helpers.
- src/renderer/editors/browser/BrowserToolbarView.ts and src/renderer/editors/browser/BrowserTranslationPopoverContentView.ts: the popover root already receives data-name="translation-source-popover"; the source select already has translation-source-language.
- src/renderer/ui/app/HeaderStatusIndicatorsView.ts: already sets the indicator's data-name and ARIA label; only HEADER_ELEMENTS lacks the declaration.
- src/renderer/editors/category/CategoryEditor.ts: the mode button is created and updated by CategoryView, which is the planned owner.
- src/renderer/scripting/api-wrapper/McpInspectorFacade.ts: help explicitly keeps dynamic argument fields out of the static element list; the new data-name is directly addressable by window.screen.
- assets/guides/editors/grid.md: it already lists grid-column-filter and describes its temporary reveal behavior.
- assets/guides/tabs-and-navigation/menu-bar.md: it already describes the user-facing Open Terminal here action; the agent-facing stable id belongs in screens/menu-bar.md.
- src/shared/board/**, board registries, src/board-shim.ts, and src/shared/board-bridge-version.ts: no board rule or window.persephone surface changes are planned, so no bridge version/history bump is needed.
- src/renderer/scripting/ai-vision/root.ts, src/main/mcp/tools/call-tools.ts, and src/test-host/client.ts: US-2121 adds no call-tree methods, protocol/result shape, or test-host behavior.
- node_modules/ai-vision/** and C:\projects\persephone-boards: read-only for this task; do not modify, publish, or bump the package or separate repository.
- doc/reviews/refactoring-roadmap.md: no roadmap change; keep the §2.3 god files listed there from growing.
- src/shared/i18n/en/** and assets/languages/**: no new English UI text is planned; if implementation unexpectedly adds text, put English in the catalog and leave translations for epic close.
- integration-test/run.mjs, package.json, and test harness files: do not add or change a harness. Claude runs affected integration suites; this planning task does not run tests or start Persephone/Electron.

## Concerns

- The tree label is SlotContent, so String(label) would be incorrect for DOM nodes/rich labels. Use a row-to-label-host aria-labelledby relationship and keep its generated host id stable for the pooled view lifetime.
- The feedback's translation-popover statement is stale against current source: the UIKit popover root already carries data-name="translation-source-popover". Because it is portaled outside the page scope used by BROWSER_ELEMENTS, document and target it through window.screen while open.
- The folder-view test helper comments report a full-path Explorer root name, while current FileTreeProvider source sets the root label from displayName, which is path.basename(sourceUrl). The plan adds a root-label assertion in the fixture integration test so Claude can verify the snapshot behavior without changing provider path data preemptively.
- The reported full-path Folder View tile row is not a TreeItemView treeitem. Keep its current folder-view.test.mjs lookup as-is; the required treeitem change addresses the chevron/icon prefix and row label.
- No unresolved scope or ownership questions remain after source inspection. The task adds no protocol code, board rule, window.persephone member, English message, or test harness.

## Acceptance Criteria

- [x] Snapshot icon buttons with title have that title as their accessible name unless caller supplies aria-label; explicit labels continue to win during updates.
- [x] UIKit treeitem names resolve only from the row label (including rich SlotContent), without chevron Expand/Collapse or icon text; row selection, expansion, and keyboard behavior remain intact.
- [x] The menu action has id open-terminal-here; download actions expose downloads-cancel, downloads-dismiss, and downloads-show-in-folder; MCP argument wrappers expose mcp-arg-<argument-name>; Folder View mode exposes folder-view-mode.
- [x] BROWSER_ELEMENTS, HEADER_ELEMENTS, FOLDER_VIEW_ELEMENTS, and GRID_EDITOR_HELP describe the verified names above; no static declaration is fabricated for the dynamic MCP argument wildcard.
- [ ] Listed integration assertions/locators and agent-facing guide entries are updated, and Claude runs the affected integration suite. Do not add unit tests or a test harness.
- [x] No protocol code, board rule outside src/shared/board/ and board registries, roadmap §2.3 god-file growth, import-zone workaround, or window.persephone change is introduced. No bridge bump is needed unless scope expands to such a change, in which case BOARD_BRIDGE_VERSION and its history line are mandatory.
- [x] No null-check fix changes runtime behavior; no English text is translated in this task; ai-vision and C:\projects\persephone-boards remain untouched; Persephone and integration-test/run.mjs are not run by the planning agent.

## Files Changed

| File | Planned change |
|---|---|
| doc/tasks/US-2121-snapshot-names/README.md | This US-2121 plan; only file edited in planning session A. |
| src/renderer/uikit/IconButton/IconButtonView.ts | Derive the default accessible name from title, preserving explicit caller aria-label. |
| src/renderer/uikit/Tree/TreeItemView.ts | Name each treeitem from its label host using aria-labelledby. |
| src/renderer/ui/sidebar/menu-bar-folder-ui.ts | Assign the open-terminal-here menu action id. |
| src/renderer/editors/browser/BrowserDownloadsPopup.ts | Add stable names to Cancel, Dismiss, and Show in Folder row buttons. |
| src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts | Add existing Browser toolbar, permission-prompt, and trust names to BROWSER_ELEMENTS. |
| src/renderer/scripting/ai-vision/namespaces/ui-elements.ts | Add audio-capture-indicator to HEADER_ELEMENTS. |
| doc/architecture/ui-element-contract.md | List the existing audio capture indicator in the header selector table. |
| src/renderer/editors/mcp-inspector/ToolArgForm.ts | Add per-argument data-name to the field wrapper. |
| src/renderer/components/tree-provider/CategoryView.ts | Name the Folder View mode button. |
| src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts | Add folder-view-mode to FOLDER_VIEW_ELEMENTS. |
| src/renderer/scripting/api-wrapper/GridEditorFacade.ts | Bring GRID_EDITOR_HELP into sync with declared grid-column-filter. |
| integration-test/tests/helpers/sidebar-helpers.mjs | Match exact treeitem label names. |
| integration-test/tests/sidebar/explorer/explorer.test.mjs | Assert the root row has the fixture's item label. |
| integration-test/tests/tools/git/git-tree.test.mjs | Assert the exact .git treeitem name. |
| integration-test/tests/browser/downloads/downloads.test.mjs | Locate Cancel by its stable name. |
| integration-test/tests/tools/mcp-inspector/mcp-inspector.test.mjs | Locate the path argument by stable field name. |
| integration-test/tests/tools/mneme/mneme.test.mjs | Locate folder and name arguments by stable field names. |
| integration-test/tests/capabilities/terminal/terminal.test.mjs | Invoke Open Terminal by stable menu id. |
| integration-test/tests/browser/permissions/permissions.test.mjs | Verify browser declarations and a titled icon-button snapshot name. |
| integration-test/tests/capabilities/audio/audio.test.mjs | Verify the header capture indicator declaration. |
| integration-test/tests/editors/grid/grid.test.mjs | Verify the grid help/list declaration match. |
| integration-test/tests/editors/folder/folder-view.test.mjs | Match treeitems by exact accessible name, use [data-name="folder-view-mode"], and retain generic tile-row path matching. |
| assets/guides/editors/browser/layout.md | Document browser prompt/trust controls, the existing translation popover selector, and transient download actions. |
| assets/guides/editors/folder.md | Document the Folder View mode control. |
| assets/guides/screens/menu-bar.md | Document the stable Open Terminal menu action id. |
