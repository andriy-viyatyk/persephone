# US-1448: Header quick-settings popover

## Goal

Replace the header three-dot snip menu with an app-owned quick-settings popover that looks like a
context menu: the two existing screen-snip rows first, a separator, and three one-line service
rows with a label on the left and a live switch on the right. Snip rows close the popover after
activation; service rows toggle without closing so several services can be changed in one visit.
The service rows must be data-driven so future quick options can be added as entries rather than
new layout code.

This is a standalone task with no epic. This document is a design and implementation plan only;
no product code is changed by this task-document work.

## Background

### Current header behavior

src/renderer/ui/app/MainPageView.ts owns the application header. The current implementation:

- Defines SNIP_MENU_ITEMS with exactly Snip Screen (hideWindows: true) and Snip Persephone
  (hideWindows: false). Both invoke the existing runSnip() flow, which calls
  app.shell.startScreenSnip() and opens the returned image in a new tab.
- Builds snipButton with data-name="header-snip-button", the more-horiz icon, and the title
  Snip screen or Persephone window.
- Opens the existing Menu through toggleSnipMenu() with placement "bottom-end" and the name
  header-snip.
- Independently updates the existing MCP and Mneme indicators. updateIndicators() controls MCP
  visibility/count/title and preserves its click handler to showMcpRequestLog(). updateMneme()
  controls Mneme visibility/status styling and preserves its click handler to
  pagesModel.showMnemeConfigPage().

The current code shape is:

~~~ts
const SNIP_MENU_ITEMS: MenuItem[] = [
    { label: "Snip Screen", icon: createIconElement("snip"), onClick: (): void => { void runSnip(true); } },
    { label: "Snip Persephone", icon: createIconElement("snip"), onClick: (): void => { void runSnip(false); } },
];

private toggleSnipMenu(): void {
    if (this.snipMenu) {
        this.snipMenu.dispose();
        this.snipMenu = undefined;
        return;
    }
    this.snipMenu = openMenu(this.snipButton, {
        name: "header-snip",
        items: SNIP_MENU_ITEMS,
        placement: "bottom-end",
        onClose: () => { this.snipMenu = undefined; },
    });
}
~~~

The replacement must keep the same anchor button, bottom-end placement, snip behavior, MCP/Mneme
indicator behavior, and settings editor behavior. It should replace only the menu surface and its
owner wiring. The new surface should look like a context menu but must not reuse the shared Menu
component or its styling selectors, leaving this surface free to gain future quick-access options.

### Settings are already the service control plane

The three requested keys are part of AppSettingsKey in src/renderer/api/settings.ts:

| Service | Setting key | Current default | Existing description |
| --- | --- | --- | --- |
| MCP HTTP server | mcp.enabled | false | Starts the loopback MCP server immediately when true. |
| Mneme sidecar | mneme.enabled | false | Runs mneme.exe and connects over loopback HTTP. |
| Clipboard listener | clipboard.enabled | false | Enables the clipboard history tracker. |

The same file documents that appSettings.json edits apply immediately, and its fileChanged() /
loadSettings(true, ...) path emits changes for changed or deleted keys. Therefore a popover switch
must call settings.set(key, value) and must not maintain a second service-control state.

src/renderer/api/app.ts already subscribes to this._settings.onChanged in App.initEvents():

~~~ts
if (key === "mcp.enabled") {
    const port = this._settings.get("mcp.port") as number | undefined;
    api.setMcpEnabled(!!value, port || undefined);
}
if (key === "mneme.enabled") {
    const mnemePort = this._settings.get("mneme.port") as number | undefined;
    api.setMnemeEnabled(!!value, mnemePort || undefined).then((status) => {
        if (!value) return;
        if (status.running) this._ui.notify("Mneme started", "success");
        else this._ui.notify("Mneme failed to start", "error");
    });
}
if (key === "clipboard.enabled" || key === "clipboard.max-items") {
    const clipboardEnabled = !!this._settings.get("clipboard.enabled");
    const clipboardMaxItems = normalizeClipboardMaxItems(this._settings.get("clipboard.max-items"));
    void api.setClipboardEnabled(clipboardEnabled, clipboardMaxItems);
}
~~~

This means the toggles need no new service plumbing: writing the setting is the whole normal
mechanism, and every other settings surface receives the same event.

### Verified shutdown paths

The renderer-to-main calls are declared in src/ipc/api-types.ts, forwarded by
src/ipc/renderer/api.ts, and bound to the Controller methods in src/ipc/main/core-handlers.ts.

- MCP: Controller.setMcpEnabled() calls stopMcpHttpServer() when enabled is false.
  src/main/mcp-http-server.ts clears the session sweep timer, closes every active transport,
  clears the session map, cancels pending requests, closes the HTTP server, and broadcasts the
  stopped status.
- Mneme: Controller.setMnemeEnabled() calls stopMneme() when enabled is false.
  src/main/mneme-service.ts delegates to SidecarProcess.stop(), which kills the child process,
  clears the current process reference, and resets the running flag. This is the mneme.exe
  shutdown path.
- Clipboard: Controller.setClipboardEnabled() delegates to src/main/clipboard-service.ts. Its
  false branch sets enabled = false and calls stopWatcher(), which stops ping monitoring, waits for
  the clipboard-watch sidecar to exit gracefully, clears the error, sets health to disabled, and
  broadcasts status.

Thus each service does stop on a normal false transition; no new backend stop implementation is
needed for the ordinary popover toggle. The in-flight startup edge case is investigated below.

Clipboard also has a typed runtime status channel: src/ipc/clipboard-ipc.ts defines
ClipboardStatus.health as disabled, starting, running, healthy, deaf, or error, and
src/ipc/renderer/renderer-events.ts exposes eClipboardStatusChanged. The quick-settings switch
does not need this channel to stay synchronized because clipboard.enabled is the source-of-truth
setting. There is no room for a clipboard health line in this one-line menu row, so that display is
deferred rather than added without a place to render it.

### Existing popover and UIKit precedents

The custom non-Menu popovers in src/renderer/editors/browser/BrowserDownloadsPopup.ts and
src/renderer/editors/grid/components/ColumnsOptions.ts both compose
src/renderer/uikit/Popover/PopoverView.ts with a native content view, createPanelElement(), and
owned VanillaView children. The direct reusable popover precedent in
src/renderer/editors/file-diff/RevisionPickerView.ts keeps a PopoverView as a child,
updates its open/anchor props, and mounts it exactly once.

There is no toggle-switch primitive under src/renderer/uikit/; the only switch-like search hits
are unrelated control-flow uses and the historical SwitchButtons naming entry. The controlled
primitive in src/renderer/uikit/Checkbox/CheckboxView.ts is label-based and renders checkbox
semantics, so it is not the requested switch control.

Per src/renderer/uikit/CLAUDE.md and doc/standards/uikit-vs-components-split.md, the new reusable
primitive belongs in src/renderer/uikit/Switch/, with co-located static CSS, a controlled value,
data-type/state attributes, name?: string, theme tokens only, and a Storybook story following the
existing src/renderer/uikit/Checkbox/Checkbox.story.ts pattern. It must use a native
keyboard-operable control with role="switch"; the app-specific quick-settings panel belongs under
src/renderer/ui/app/, not in UIKit.

## Implementation Plan

- [ ] Add the reusable Switch UIKit primitive:
  - src/renderer/uikit/Switch/SwitchView.ts: define a controlled props surface with checked,
    onChange, optional disabled, optional name, an accessible label, and a compact size variant.
    Render a native focusable control with role="switch", aria-checked, keyboard activation, and
    the required data-type="switch" plus data-checked/data-disabled state attributes. Do not let
    the primitive own the checked value. The quick-settings service rows use the compact/small
    variant so the switch fits inside the 26px menu row without changing the row height. This
    primitive remains fully keyboard-operable and reusable independently of the popover's
    mouse-only interaction decision; its next consumer may be a settings form or dialog.
  - src/renderer/uikit/Switch/Switch.css: style the track/thumb/focus state using existing
    --color-*, --color-border-*, --radius-*, --size-*, --gap-*, and related theme tokens; do not add
    hex, RGB, named colors, or inline styling.
  - src/renderer/uikit/Switch/index.ts: export the view and props.
  - src/renderer/uikit/Switch/Switch.story.ts, src/renderer/editors/storybook/storyRegistry.ts,
    and src/renderer/uikit/index.ts: register and expose the primitive using the existing
    Storybook record pattern.
- [ ] Add an app-owned quick-settings popover view in
  src/renderer/ui/app/HeaderQuickSettingsPopover.ts with co-located styling in
  src/renderer/ui/app/HeaderQuickSettingsPopover.css. Compose PopoverView, the new SwitchView, and
  the existing snip action behavior. Keep the popover anchored to the existing snipButton with
  placement "bottom-end". Render one vertical list with the two snip rows first, a separator,
  then the three service rows; do not render section headings or per-row description text.
- [ ] Drive all three service rows from one declarative entry list in the app-owned view. Each
  entry should carry the setting key and label, with an optional live status projection reserved
  for a future row affordance:

~~~ts
interface QuickServiceEntry {
    key: "mcp.enabled" | "mneme.enabled" | "clipboard.enabled";
    label: string;
    status?: () => string;
}
~~~

The implementation may refine this exact type, but adding a future setting-backed option must mean
adding one entry (its key and label), not adding another row or layout branch. The current menu has
no space for a description or status line, so no current entry should supply or render status;
the only plausible use, a clipboard health line, is deferred until a future row design has room
for it. If a later option genuinely needs a non-setting-backed value, add an explicit override at
that point rather than carrying redundant read/write closures now. The setting key alone determines
both directions: render checked as !!settings.get(entry.key), and write with
settings.set(entry.key, enabled).
- [ ] Subscribe the popover content to settings.onChanged for all three keys and update each
  switch from the current setting value. Do not snapshot values only when the popover opens. Keep
  the subscription owned by the view and release it on disposal. The row renders only from
  settings.get(entry.key): no optimistic local boolean and no pending desired-value field.
  settings.set() emits onChanged synchronously, so the row's own write is re-rendered through this
  same subscription before settings.set() returns; external edits and the row's own edits therefore
  share one update path. Keep mnemeStatusModel.state available for the live Mneme pending/status
  decision below, but do not use it as the switch's checked source.
- [ ] Update src/renderer/ui/app/MainPageView.ts to replace MenuHandle/openMenu usage with the
  app-owned popover lifecycle while preserving the snipButton's stable data-name
  header-snip-button, toggleSnipMenu()'s toggle behavior, the bottom-end placement, and the
  existing runSnip() actions. Change its title to Open quick settings, rename the local CSS class
  from snip-indicator to quick-settings-button, and rename the popover name from header-snip to
  header-quick-settings. Do not modify updateIndicators(), updateMneme(), their click handlers,
  or settings editor code.
- [ ] Apply the required MCP race fix in src/main/mcp-http-server.ts and only in
  stopMcpHttpServer(): copy startPromise, await it with rejection swallowed, then run the existing
  if (!httpServer) return guard and teardown. Do not add cancellation tokens, an operation queue,
  or a generation counter, and do not change startMcpHttpServer()'s concurrent-start guard. This
  makes a rapid false transition wait for a listen that is about to publish before stopping it.
- [ ] Define one menu-shaped list in the app-owned CSS/DOM. The two existing snip rows come first,
  each with its existing icon and label; a separator follows them; the generated service rows are
  one line each with the label on the left and a right-aligned switch. Service rows use an empty
  icon-width spacer matching the snip icon column so all labels align. Clicking either empty row
  space or its switch calls the same setting toggle exactly once, and the service-row handler must
  not call onClose. Only a snip-row activation calls runSnip() and closes the popover. Use static
  CSS and theme tokens; no hardcoded colors.
- [ ] Keep this surface independently styled rather than extending or borrowing the shared Menu.
  Give the root/list/row/separator app-owned data-type values; do not emit
  data-type="menu-list" or data-type="menu-row", and do not depend on Menu.css selectors. Match
  the context-menu appearance intentionally with the same tokens: the 26px row height from
  ROW_HEIGHT in src/renderer/uikit/Menu/MenuModel.ts, --gap-md, --space-md horizontal padding,
  --font-base, --color-text-default, --color-bg-selection, and --color-text-selection. Copy the
  list padding from Menu.css as var(--space-xs, 2px) 0. This token-based match means theme changes
  move both surfaces together, while visual drift from the real Menu is an accepted cost of keeping
  this popover independently enhanceable.
- [ ] Implement the transient-surface dismissal and focus behavior: Escape and outside pointer-down
  dismiss the popover through PopoverView; set outsideClickIgnoreSelector to the existing anchor's
  data-name so the anchor's own click toggles instead of reopening the surface; opening moves focus
  to the first actionable row/control; closing restores focus with restoreFocus(); and Tab and
  Shift+Tab behave natively. This popover is intentionally mouse-driven: do not add bespoke
  ArrowUp/ArrowDown or Enter/Space row handling, boundary detection, keydown interception for Tab,
  or a focus trap. Keep the reusable Switch keyboard-operable and ensure native Tab traversal does
  not make controls unreachable.
- [ ] Render the Mneme row exactly like the other two: the switch shows the live mneme.enabled
  value and nothing else. Do not build a pending/starting presentation. The current
  mnemeStatusModel exposes only enabled, running, url, and modelReady and cannot distinguish a
  start in progress from a failed start, and the one-line row has no status slot to render it in;
  both points are resolved as deferred in Concerns below.
- [ ] Do not add tests or test harnesses. Verify the implementation with the project's existing
  lint/build checks only after the user approves implementation.
- [ ] Keep all new code within the project constraints: TypeScript and native VanillaView
  components, co-located static CSS, theme tokens only, no direct path/fs requires, and
  errMessage() for any caught unknown values.

### Deliberately rejected shared-Menu alternative

Do not extend src/renderer/core/events/context-menu.ts or src/renderer/uikit/Menu/ for this task.
MenuItem currently provides label, onClick, icon, startGroup, hotKey, items, and related disabled,
selection/id, and minor fields; it has no trailing-content slot and no keep-open flag. It is the
app-wide contract consumed by uikit/Menu for every context menu, so adding switch semantics or a
keep-open option to support one header surface would broaden the contract unnecessarily. The new
surface therefore remains an app-owned view over uikit/Popover. It will look like a menu through
its own data-type values and co-located CSS, not by emitting Menu's menu-list/menu-row attributes or
inheriting Menu.css rules.

### Before -> after shape

Before, MainPageView owns a MenuHandle and supplies only SNIP_MENU_ITEMS to openMenu(). After
implementation, the same owner should supply a persistent app-owned popover view whose content is
generated from the service-entry list:

~~~ts
// Before
private snipMenu: MenuHandle | undefined;
this.snipMenu = openMenu(this.snipButton, {
    name: "header-snip",
    items: SNIP_MENU_ITEMS,
    placement: "bottom-end",
    onClose: () => { this.snipMenu = undefined; },
});

// After (planned shape)
private quickSettingsPopover: HeaderQuickSettingsPopoverView | undefined;
this.quickSettingsPopover = this.child(new HeaderQuickSettingsPopoverView({
    anchor: this.snipButton,
    open: true,
    placement: "bottom-end",
    onClose: this.closeQuickSettingsPopover,
}));
this.quickSettingsPopover.mount();
~~~

The exact constructor/update wiring may follow the established RevisionPickerView lifecycle, but
the final code must preserve the same anchor and placement, must use
name: "header-quick-settings" for the new popover, and must not duplicate service start/stop calls
outside settings.set(). The content list must have this order and interaction contract:

~~~text
Snip Screen       [snip icon]
Snip Persephone   [snip icon]
-------------------------------
MCP                         [switch]
Mneme                       [switch]
Clipboard listener          [switch]
~~~

The service rows use an empty icon-width spacer before each label. The switch is right-aligned;
clicking its control or empty row space invokes the same setting toggle once and leaves the
popover open. A snip row invokes runSnip() and closes it. The service-row handler must not call
onClose.

The planned MCP lifecycle change is deliberately narrow:

~~~ts
// Before
export async function stopMcpHttpServer(): Promise<void> {
    if (!httpServer) return;
    // existing teardown
}

// After
export async function stopMcpHttpServer(): Promise<void> {
    const pending = startPromise;
    if (pending) await pending.catch(() => undefined);
    if (!httpServer) return;
    // existing teardown
}
~~~

## Concerns / Open Questions

### Startup race when disabling

Normal false transitions are safe for all three services, but the source exposes one race that this
task must fix because the quick switch deliberately makes rapid on/off changes easy to reach:

- src/main/mcp-http-server.ts assigns httpServer only in the HTTP listen callback while tracking
  the in-flight operation in startPromise. stopMcpHttpServer() returns immediately when httpServer
  is still undefined. If mcp.enabled changes false during that window, the pending listen can still
  complete and leave MCP running after the setting is false.
- Mneme's SidecarProcess.stop() nulls and kills the current child even while pendingStart is
  resolving, so its pending start is stopped rather than continued. The resulting status should
  still be checked by the final UI projection.
- Clipboard serializes enable/disable operations through mutationQueue/enqueue() in
  src/main/clipboard-service.ts, and its false branch waits for the watcher shutdown, so its
  queued transitions are ordered.

Decision: implement the narrow stopMcpHttpServer() change in the Implementation Plan. It awaits an
in-flight startPromise, swallowing its rejection, before checking !httpServer and running the
existing teardown. This is sufficient to stop a server that is about to be published without
adding a cancellation token, operation queue, or generation counter. Mneme needs no equivalent
change because SidecarProcess.stop() kills the child while pendingStart is resolving, and
clipboard needs none because mutationQueue serializes its transitions. Closing the popover itself
must not cancel or duplicate a setting operation.

### Mneme starting state and toast

src/renderer/api/mneme-status.ts exposes reactive enabled, running, url, and modelReady.
enabled: true plus running: false currently means enabled but not running in the existing header
indicator; it does not distinguish startup from a failed start or a stopped sidecar. The
main-process MnemeStatus type likewise has running, url, and optional error, but no starting field.
Therefore the switch cannot honestly show a distinct starting state from the current model alone.

Recommendation: in this menu-shaped version, show the live enabled value in the compact switch
and do not infer a distinct starting state from enabled && !running. There is no per-row status
text slot, so a pending indicator should be deferred unless the compact Switch design gains an
explicit pending presentation. If a distinct pending state is required, add an explicit status
field through the main-process IPC and mnemeStatusModel first, then decide how that state fits the
single-line row.

The existing App.initEvents() success toast (Mneme started) and failure toast should remain the
authoritative result feedback for now. The popover should not add a second success toast. Whether
the success toast should later be suppressed for a popover-originated toggle is a product choice,
but the current setting event does not carry the origin, so suppression would require an explicit
origin/correlation design and should not be guessed in the UI plan.

The clipboard status event is more expressive than the Mneme model: it can report starting and
failure health, and src/renderer/editors/explorer/ClipboardSecondaryView.ts consumes it for its
health badge and notifications. The quick-settings row has no status-text slot, so using that
event for a clipboard status line is explicitly deferred and is not necessary to satisfy the
requested live switch.

### Other consumers and live external changes

The settings editor sections already subscribe to the same keys and refresh their controls:
src/renderer/editors/settings/sections/ClipboardSection.ts listens for
clipboard.enabled/clipboard.max-items, and
src/renderer/editors/settings/sections/McpSection.ts listens for MCP, Mneme, and related port
keys. src/renderer/editors/explorer/ExplorerSecondaryView.ts also updates its clipboard action
when clipboard.enabled changes. src/renderer/api/mneme-connection.ts and
src/renderer/api/mneme-status.ts subscribe to mneme.enabled for connection and health
synchronization. src/renderer/api/settings.ts explicitly emits watcher-triggered file changes, so
edits to appSettings.json and changes from another UI surface reach the popover through the proposed
subscription.

No inspected consumer assumes these three enable settings are startup-only or settings-editor-only.
The popover must still subscribe directly so its switches update while it remains open.

### Accessibility and dismissal

src/renderer/uikit/Popover/PopoverView.ts already dismisses on Escape and document pointerdown
outside its internal root. It does not itself implement focus restoration or a modal focus trap. Its
outsideClickIgnoreSelector prop exists specifically to exempt an anchor or other selector from
outside dismissal. src/renderer/uikit/Menu/MenuView.ts focuses its search/list root on mount, while
src/renderer/ui/dialogs/poppers/showPopupMenu.ts demonstrates restoring the previously focused
element with restoreFocus() after a popper closes. The new non-modal panel should follow the latter
restoration pattern without trapping focus: focus the first actionable control when the panel opens,
allow native Tab and Shift+Tab traversal, and restore the anchor on Escape, outside pointer-down,
or action-driven close. There is no boundary detection or keydown interception. Every switch must
have an accessible name from its row label and expose role="switch" plus aria-checked.

### Accepted keyboard-navigation trade-off

The replaced surface is a real uikit/Menu, whose keyboard navigation includes arrow-key movement
and keyboard activation. The new app-owned popover intentionally drops that bespoke row navigation
and is accepted as a mouse-driven surface by this task's user decision. This is an explicit loss,
not an unexamined omission. Escape and outside pointer-down dismissal remain required PopoverView
behavior, and restoreFocus() on close plus native Tab/Shift+Tab traversal remain required so the
popover does not strand focus or swallow browser navigation. The reusable uikit/Switch remains
fully keyboard-operable with role="switch", aria-checked, and native keyboard activation; its
mouse-only consumer must not weaken that library contract. If row keyboard navigation is needed
later, add a roving-focus implementation to this app-owned view rather than re-adopting uikit/Menu,
which remains rejected for the shared-contract reasons above.

### Header naming decisions

The stable data-name header-snip-button is not safe to rename. It is listed as a shell contract in
doc/architecture/ui-element-contract.md, described in
src/renderer/scripting/ai-vision/namespaces/ui-elements.ts and assets/guides/screens/header.md,
and referenced by qa/surfaces/shell.md. Keep it as a legacy stable handle even though the control
now opens a broader quick-settings panel; update those descriptions during implementation so the
documented purpose says quick settings with Snip actions and service switches.

The CSS class snip-indicator has no references outside src/renderer/ui/app/MainPageView.ts and
src/renderer/ui/app/MainPage.css, so rename it to quick-settings-button and update both local
selectors. The popover debug name header-snip likewise has no external references, so rename it to
header-quick-settings. The visible title should change from Snip screen or Persephone window to
Open quick settings.

### Scope boundaries

Do not change the existing MCP/Mneme header indicators, their click behavior, the settings editor,
or the settings keys/defaults. Do not add a generic quick-settings API, tests, or a new backend
service-control path for the ordinary toggle flow.

## Changes made after the plan, during user review

Three adjustments came from the user testing the implemented popover. All are in the working tree
and are the shipped behaviour; the plan above otherwise held.

1. **The checked switch dissolved into a hovered row.** `Switch.css` set the checked track's
   `border-color` to `--color-bg-selection` — the same token the hovered row paints its background
   with — so on hover only the thumb remained visible. The checked rule no longer overrides
   `border-color` at all: it keeps the base `--color-border-default`, which every one of the nine
   themes defines as a value distinct from its own selection background. An interim fix used
   `--color-text-selection`, which read clearly but looked wrong as a white ring; the user chose the
   default border colour. The rule carries a comment so the fill colour is not reinstated as the
   border. Note that in the two dark-blue themes (Abyss, Tomorrow Night Blue) border and selection
   are both deep blues, so the outline there is correct but subtle.

2. **The service rows now carry icons.** They were built with an empty icon-width spacer, which
   aligned the labels but left the rows looking like they had lost their icons. No new artwork was
   needed: `mcp`, `memory` (with `MEMORY_ICON_COLOR`) and `paste` already exist in the registry and
   are what MCP Inspector, Mneme and Clipboard use in Tools & Editors, so a service now reads the
   same in both places. `QuickServiceEntry` gained `icon: IconName` and optional `iconColor`.

   The entry carries the icon's **registry name, never a built node**. An icon element is
   single-use — appending it to a second host moves it and blanks the first — so each row builds its
   own at the point of use. A shared `icon: Node` on a module-level entry list is precisely the
   caching pattern `src/renderer/uikit/CLAUDE.md` records as having caused disappearing-icon defects
   four times.

3. `HeaderQuickSettingsPopover.css` extends its icon-sizing rule to the service rows.

### Verified in the running app

Rows render with icons and the separator; toggling a switch leaves the popover open; clicking the
row body toggles it exactly as clicking the switch does; Escape closes and returns focus to the
anchor; and the clipboard tracker genuinely stopped and restarted across a toggle pair, observed
through the `clipboard` MCP node appearing and disappearing. The MCP switch was deliberately not
exercised, because turning it off drops the connection the verification runs over, and the snip
rows were not activated because the capture flow waits on a user drag. Note that synthetic hover
does not trigger CSS `:hover`, so the hovered-row appearance was confirmed by temporarily forcing
the hover declarations onto two rows.

## Acceptance Criteria

- [ ] The ... button opens a designed popover at the existing bottom-end anchor position and closes
  on Escape, outside pointer-down, or a second activation of the anchor.
- [ ] The popover is one vertical menu-shaped list: the two existing snip rows appear first with
  their existing icons and labels, followed by a separator and three one-line service rows. There
  are no section headings or per-row descriptions; service rows use an empty icon-width spacer so
  their labels align with the snip rows, with the switch right-aligned.
- [ ] Both existing snip rows retain their labels, icons, behavior, and error handling; activating
  either row closes the popover.
- [ ] Services contains live, keyboard-operable switches for mcp.enabled, mneme.enabled, and
  clipboard.enabled; each switch writes only its corresponding setting. Clicking a service row's
  empty space and clicking its switch have the same single-toggle result, and neither closes the
  popover.
- [ ] Changes made through appSettings.json, the settings editor, or another surface update an
  already-open popover without reopening it.
- [ ] Disabling MCP closes its active HTTP sessions/server; disabling Mneme stops mneme.exe; and
  disabling clipboard stops the clipboard watcher. stopMcpHttpServer() awaits an in-flight
  startPromise before its existing no-server guard, so rapid disable cannot leave MCP serving while
  mcp.enabled is false.
- [ ] The existing MCP and Mneme indicators, their click behavior, and the settings editor are
  unchanged.
- [ ] The service rows are generated from a declarative entry list, and the document/code make it
  clear what one new entry must provide.
- [ ] The switch primitive follows UIKit rules: controlled state, role="switch", keyboard
  operation, compact size suitable for the 26px menu row, data-type/state attributes, co-located
  static CSS, theme tokens only, and a story.
- [ ] The quick-settings surface has its own data-type values and co-located CSS; it does not emit
  Menu's menu-list/menu-row attributes or modify the shared Menu. Its context-menu appearance is
  matched with the verified Menu tokens and list padding, with visual drift accepted as the cost
  of independent future enhancement.
- [ ] Escape and outside pointer-down dismiss through PopoverView; focus enters at the first
  actionable row/control; Tab and Shift+Tab remain native with no focus trap; and closing restores
  the anchor with restoreFocus(). No bespoke row keyboard navigation is added, while the reusable
  Switch primitive remains keyboard-operable.
- [ ] The setting key alone determines each row's checked value and write target; the row holds no
  optimistic local boolean or pending desired-value state.
- [ ] The required stopMcpHttpServer() change awaits an in-flight startPromise before its existing
  no-server guard, so a rapid disable cannot leave MCP serving while mcp.enabled is false.
- [ ] No unit tests, test harnesses, commits, or unrelated documentation changes are added.

## Files Changed

| File | Planned change |
| --- | --- |
| doc/tasks/US-1448-header-quick-settings-popover/README.md | This task document. |
| doc/active-work.md | Add the standalone task under Active / *(no epic)*. |
| src/renderer/ui/app/MainPageView.ts | Replace the plain snip menu attachment with the quick-settings popover owner wiring; preserve header-snip-button, update the title, rename the local CSS class and popover name, and preserve existing indicators and snip flow. |
| src/renderer/ui/app/MainPage.css | Rename the local snip-indicator selectors to quick-settings-button. |
| src/renderer/ui/app/HeaderQuickSettingsPopover.ts | New app-owned popover content and declarative service-entry integration. |
| src/renderer/ui/app/HeaderQuickSettingsPopover.css | New app-owned menu-shaped list, separator, spacer, row, and switch alignment styling using the verified Menu tokens without Menu selectors. |
| src/renderer/uikit/Switch/SwitchView.ts | New controlled, accessible switch primitive. |
| src/renderer/uikit/Switch/Switch.css | New token-based switch styling. |
| src/renderer/uikit/Switch/Switch.story.ts | Storybook story for the new primitive. |
| src/renderer/uikit/Switch/index.ts | New primitive exports. |
| src/renderer/uikit/index.ts | Export SwitchProps. |
| src/renderer/editors/storybook/storyRegistry.ts | Register the switch story. |
| src/main/mcp-http-server.ts | Required narrow fix in stopMcpHttpServer(): await an in-flight startPromise before the existing !httpServer guard; no changes to startMcpHttpServer(). |
| doc/architecture/ui-element-contract.md | Update the stable header-snip-button purpose without renaming its selector. |
| src/renderer/scripting/ai-vision/namespaces/ui-elements.ts | Update the stable element's purpose from a snip menu to the quick-settings panel. |
| assets/guides/screens/header.md | Update the header control description while retaining the stable selector. |
| **No changes** | src/renderer/api/settings.ts, src/renderer/api/app.ts, src/renderer/api/mneme-status.ts, src/main/mneme-service.ts, src/main/clipboard-service.ts, src/ipc/api-types.ts, src/ipc/renderer/api.ts, src/ipc/main/core-handlers.ts, src/ipc/clipboard-ipc.ts, src/ipc/renderer/renderer-events.ts, src/renderer/editors/settings/sections/ClipboardSection.ts, src/renderer/editors/settings/sections/ClipboardSectionModel.ts, src/renderer/editors/settings/sections/McpSection.ts, src/renderer/editors/settings/sections/McpSectionModel.ts, src/renderer/editors/explorer/ExplorerSecondaryView.ts, src/renderer/uikit/Menu/MenuModel.ts, src/renderer/uikit/Menu/MenuView.ts, src/renderer/uikit/Menu/Menu.css, src/renderer/core/events/context-menu.ts, and the existing MCP/Mneme indicator update methods in src/renderer/ui/app/MainPageView.ts: these already provide the required reactive plumbing, existing Menu behavior to match, or shared contracts that must remain unchanged. |
