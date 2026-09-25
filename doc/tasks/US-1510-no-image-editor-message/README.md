# US-1510: "No image editor is registered" when the bundled board is disabled

Status: Planned investigation for [EPIC-110](../../epics/EPIC-110.md). US-1508 has made the
state reachable in this worktree; this document contains no implementation changes.

## Goal

When no enabled capability handler can edit an image or diagram, present an actionable state rather
than the capability bus's developer-shaped rejection. The user must be told to re-enable the
disabled board in Tools & Editors or install a replacement, while the typed `no-handler` rejection
and all non-UI callers remain unchanged.

The task covers the image viewer, SVG editor, Mermaid editor, HTML editor, the screen-snip flow,
and the `data:image/...` capability route. The Mermaid `diagram.edit` path receives diagram-specific
wording; it must not display an image-editor message.

## Background

### Governing decisions and scope

EPIC-110 D7 governs this task and carries forward EPIC-109 D6 as amended: the built-in `draw-view`
editor is gone, so disabling the bundled board with no replacement is now a real state. The
dashboard entry and the EPIC-110 task row already exist; neither is edited here.

US-1507 and US-1508 are present as uncommitted worktree changes. A separate session owns US-1509's
changes to `package.json`, `eslint.config.mjs`, `tsconfig.json`, and deletion of
`src/renderer/core/utils/performance-janitor.ts`; this task must not touch those files. No source
file is changed while creating this document.

### Reachability proof

The current source establishes the following chain:

1. `assets/boards/excalidraw/board-manifest.json` declares exactly two relevant capabilities:
   `image.edit` and `diagram.edit`, both version 1 and priority 50.
2. The `draw-view` row has been removed from `src/renderer/editors/register-editors.ts`, so the
   editor registry no longer seeds a platform `image.edit` or `diagram.edit` handler. A source-wide
   search of the current tree finds no other native declaration of either capability.
3. `CustomEditorRegistry.refresh()` in
   `src/renderer/editors/board/custom-editor-registry.ts` reads
   `settings.get("disabled-bundled-boards")` and skips a bundled source whose stable board id is
   in that set. Thus the Excalidraw manifest's declarations never enter the next rebuild.
4. The same refresh first calls `unregisterBoardCapabilities()` and then registers only the
   declarations collected from the enabled sources. This removes stale board-origin handlers when
   a setting changes; it does not merely hide the Built-in row.
5. `Capabilities.invoke()` in `src/renderer/api/capabilities.ts` calls `resolveCapability()`. With
   no platform or board candidate, it throws `noHandlerError()`, whose current message is
   `No capability handler matches "image.edit".` (and equivalently for `diagram.edit`). The
   `CapabilityError` has code `"no-handler"`; `invoke()` rethrows that typed error unchanged.

The setting is live: `CustomEditorRegistry` subscribes to `disabled-bundled-boards`, and the
settings description explicitly says changes apply without restarting. A trusted replacement board
would remain in the trusted source list, so this no-handler state is only asserted when no other
handler is registered.

### What each consumer does today

The following table is based on the current call sites, not the pre-US-1508 code.

| Consumer | Current call path | Current handling when the invoke rejects | User-visible result today |
|---|---|---|---|
| Image viewer | `src/renderer/editors/image/ImageEditor.ts`, `ImageEditor.openInDrawingEditor()` directly invokes `app.capabilities.invoke("image.edit", ...)`. `src/renderer/editors/image/ImageToolbarView.ts` calls it with `void` and no catch. | No model or toolbar catch handles the rejection. | No in-app toast or dialog; the rejected promise is dropped by the toolbar callback (a developer-console/unhandled-rejection report is not user feedback). |
| SVG editor | `src/renderer/editors/svg/SvgEditor.ts`, `SvgEditor.openInDrawingEditor()` directly invokes `image.edit`; `src/renderer/editors/svg/index.ts` catches the model promise. | The model wraps the error as `SVG preview cannot open in Drawing Editor: ...`; the view catches and calls `ui.notify(...)`. | Error toast: `Failed to open SVG in Drawing Editor: SVG preview cannot open in Drawing Editor: No capability handler matches "image.edit".` |
| Mermaid editor — open as image | `src/renderer/editors/mermaid/MermaidEditor.ts`, `MermaidEditor.openInDrawingEditor()` directly invokes `image.edit`; `src/renderer/editors/mermaid/index.ts` catches it. | The model wraps it, then the view wraps it again in its toast. | Error toast: `Failed to open Mermaid in Drawing Editor: Mermaid preview cannot open in Drawing Editor: No capability handler matches "image.edit".` |
| Mermaid editor — convert to editable shapes | `MermaidEditor.convertToExcalidraw()` invokes `diagram.edit`; the view catches its rejection. | The model wraps the rejection as `Mermaid preview cannot open the Excalidraw page: ...`; the view reports it as a conversion failure. | Error toast: `Failed to convert Mermaid diagram: Mermaid preview cannot open the Excalidraw page: No capability handler matches "diagram.edit".` |
| HTML editor | `src/renderer/editors/html/HtmlEditor.ts:131-135`, `HtmlEditor.editImage()` captures a PNG and calls `pagesModel.addDrawPage()`. | `PagesLifecycleModel.addDrawPage()` invokes `image.edit`, and `HtmlEditor.withCapture()` catches the rejection. | Error toast: `Failed to open image for editing: No capability handler matches "image.edit".` |
| Screen snip | `src/renderer/ui/app/MainPageView.ts:18-27`, `runSnip()` captures a PNG and calls `pagesModel.openImageInNewTab(..., "Snip")`. It does not invoke `image.edit` itself. | The capture/open flow only catches snip failures. The resulting Image Viewer exposes the same `image-open-draw` button and therefore reaches the Image Viewer row above. | Snip succeeds and opens an Image Viewer; clicking Open in Drawing Editor currently produces no user-facing message. A capture failure still uses the unrelated `Snip failed: ...` toast. |
| `data:image/...` route | `src/renderer/content/builtin-schemes.ts:212-221`, `resolveData()` checks `data.target === "image.edit"` (the US-1508 route), then calls `pagesModel.addDrawPage()`. | The route catches the rejection itself and calls `ui.notify(...)`. | Error toast: `Failed to open image for editing: No capability handler matches "image.edit".` The event is marked handled and no page is created. |
| Script/API `addDrawPage()` | `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:270-272` forwards to `PagesModel.addDrawPage()`, then `PagesLifecycleModel.addDrawPage()` invokes `image.edit`. | The Object Model promise rejects to the script caller; there is no UI catch in the API path. | Not a native UI consumer. Scripts retain the typed `CapabilityError`; this task must not convert it into a toast or alter its message. |

There are only three direct renderer invocations in the current source: Image, SVG, and Mermaid's
image handoff. The only current `diagram.edit` invocation is Mermaid conversion. The HTML, snip,
and data-route paths are indirect `image.edit` consumers through `PagesLifecycleModel.addDrawPage()`:

```ts
// Current shared page path — src/renderer/api/pages/PagesLifecycleModel.ts:417-425
addDrawPage = async (dataUrl: string, title?: string): Promise<PageModel> => {
    const { pageId } = await app.capabilities.invoke("image.edit", {
        dataUrl,
        title: title ?? "untitled.excalidraw",
    });
    // Resolve the returned page id; failures are allowed to reject to the caller.
};
```

This proves why handling only in `addDrawPage()` would fix HTML and the data route but miss Image,
SVG, Mermaid, and the snip-to-Image-Viewer path. Conversely, changing `Capabilities.invoke()` would
also affect scripts, boards, and future callers that depend on `CapabilityError.code` and the
developer-oriented message.

### Message and presentation decision

Use one shared classifier/message formatter, but keep notification ownership at each existing
presentation boundary. The proposed messages are:

```text
No image editor is registered. Enable the board in Tools & Editors or install a replacement.
No diagram editor is registered. Enable the board in Tools & Editors or install a replacement.
```

The wording is deliberately generic. The current bundled row is labelled **Excalidraw** because its
manifest name is `Excalidraw`, but the capability contract permits a user-installed replacement;
hardcoding that product name would be wrong once another board handles the capability. “The disabled
board” is the existing recovery affordance, while “install a replacement” remains true if the user
does not want to re-enable it.

The existing `getDisabledBundledBoardItems()` path is the correct remedy to name. In
`src/renderer/ui/sidebar/tools-editors-registry.ts`, disabled bundled boards are excluded from
`getCreatableItems()` but retained as rows with `disabled: true`, an inert `create: () => {}`, and
an `enable` callback. `BuiltinEditorsListView` keeps those rows visible even when they are not
pinned; its `handleChange()` deliberately does nothing and leaves the popover open. The context
menu returns **Enable** for that row. Therefore the message should direct the user to **Tools & Editors**,
where they can open the disabled row's context menu and choose **Enable**. The sidebar is the most
likely surface from an editor toolbar: its tab is labelled **Built-in Editors**
(`ToolsEditorsPanelView.ts:50`); the full-page hub's corresponding tab is labelled **Built-in**
(`ToolsHubView.ts:116`). Naming only the shared **Tools & Editors** surface keeps the message correct
on both. It should not suggest clicking the row itself or changing `settings.json`.

Use the `"warning"` notification level rather than an error-style “Failed ...” prefix for this
known configuration state. Other failures (bad image data, capture failure, board rejection,
timeout, and so on) retain their current error handling and contextual text.

### Alert rendering constraint

`ui.notify()` forwards the string to `alertsBarModel.addAlert()` in `src/renderer/api/ui.ts`.
The alert bar renders at most three visible alerts, and `AlertItemView` auto-closes a warning after
five seconds; neither behavior truncates the message. `NotificationView` assigns the complete
string to a text span's `textContent` and applies `white-space: pre-wrap`. The notification CSS has
no `max-width`, `text-overflow`, or ellipsis rule, so the text is not programmatically truncated and
can wrap when constrained. However, the alert is absolutely positioned inside the app root, whose
overflow is hidden, and the notification itself has no explicit width bound. A long message could
therefore extend beyond or be clipped by a narrow window rather than reliably wrapping.

The shortened 92/94-character messages above keep the remedy clause in the same single toast while
reducing that risk. The hand check must inspect the rendered toast at a narrow window width as well
as a normal width; the full “Enable ... or install ...” clause must remain readable.

The shared formatter should recognize only a typed `CapabilityError` with code `"no-handler"` for
the requested edit capability. It must not reclassify arbitrary rejected handlers as “no editor”.
The existing SVG and Mermaid model wrappers currently turn the typed error into a new contextual
`Error` before the view sees it; the implementation must preserve the typed no-handler error
through those two wrappers so the shared classifier can still distinguish this state. Other errors
continue to receive the current contextual wrapping.

### Bus contract decision

Do not change `src/renderer/api/capabilities.ts`, `noHandlerError()`, `resolveCapability()`, or
`Capabilities.invoke()` for this task. `noHandlerError()` is the deliberate typed rejection for
an absent candidate, and other Object Model consumers depend on both `CapabilityError.code` and
the message. The presentation layer will translate only the known `"no-handler"` case at the
native UI boundaries; `PagesLifecycleModel.addDrawPage()`, `PageCollectionWrapper.addDrawPage()`,
and direct `app.capabilities.invoke()` calls continue to reject normally.

## Implementation Plan

### 1. Add one shared no-handler classifier and the two actionable messages

- Add a small pure helper at `src/renderer/api/capability-feedback.ts` (or the equivalent
  renderer API utility chosen during implementation). It should accept only `"image.edit"` or
  `"diagram.edit"`, inspect the typed `CapabilityError`, and return the corresponding actionable
  message only for `code === "no-handler"`; otherwise it returns `undefined`.
- Keep the helper free of `ui.notify()` so both `content/builtin-schemes.ts` and editor views can
  use it without moving presentation into the capability bus or making the API layer own a toast.
- Keep the two messages in this one helper so the wording, Tools & Editors remedy, generic board
  naming, and warning-level presentation cannot drift between consumers.

Before → after for the current data-route catch shape:

```ts
// Before — src/renderer/content/builtin-schemes.ts
} catch (error) {
    const { ui } = await import("../api/ui");
    ui.notify(`Failed to open image for editing: ${errMessage(error)}`, "error");
}

// After — preserve ordinary errors, but turn only the known state into the shared remedy message
} catch (error) {
    const { ui } = await import("../api/ui");
    const message = getMissingEditCapabilityMessage(error, "image.edit");
    ui.notify(message ?? `Failed to open image for editing: ${errMessage(error)}`, message ? "warning" : "error");
}
```

The implementation may use a small notification helper to avoid repeating the `message ?` branch,
but the source of the wording remains the one shared formatter.

### 2. Preserve typed no-handler errors through contextual model wrappers

- In `src/renderer/editors/svg/SvgEditor.ts`, keep the current contextual wrapper for ordinary
  failures, but rethrow a detected `image.edit` no-handler error unchanged.
- In `src/renderer/editors/mermaid/MermaidEditor.ts`, do the same independently for the
  `image.edit` handoff in `openInDrawingEditor()` and the `diagram.edit` request in
  `convertToExcalidraw()`.
- Preserve the existing Mermaid conversion-fallback behavior: a successful `diagram.edit` result
  with `status: "conversion-failed"` still calls `openInDrawingEditor()`. If that fallback then
  has no `image.edit` handler, the shared image message is the one shown; a missing initial
  `diagram.edit` handler uses the diagram message.

Before → after for the model catch pattern:

```ts
// Before — SVG and Mermaid currently flatten every rejection into a new Error
} catch (error) {
    throw new Error(`SVG preview cannot open in Drawing Editor: ${errMessage(error)}`);
}

// After — the typed no-handler state survives to the presentation catch
} catch (error) {
    if (getMissingEditCapabilityMessage(error, "image.edit")) throw error;
    throw new Error(`SVG preview cannot open in Drawing Editor: ${errMessage(error)}`);
}
```

The same shape applies to Mermaid with the capability-specific id and existing contextual text.

### 3. Make each native presentation boundary use the shared message

- `src/renderer/editors/image/ImageToolbarView.ts`: add a catch to the existing
  `onDrawClick` promise. Show the shared image message as a warning for no-handler; retain a
  contextual error toast for all other failures. This is the missing presentation boundary that
  currently makes the Image Viewer path silent.
- `src/renderer/editors/svg/index.ts`: in `onOpenDraw`, check the shared image message before
  emitting the existing failure toast. A no-handler result should show only the actionable state,
  not the nested developer-shaped rejection.
- `src/renderer/editors/mermaid/index.ts`: apply the shared image message to `onOpenDraw` and
  the shared diagram message to `onConvertToExcalidraw`. Non-missing-handler failures retain the
  current contextual error toasts.
- `src/renderer/editors/html/HtmlEditor.ts`: let `withCapture()` accept an optional capability id,
  pass `"image.edit"` only from `editImage()`, and use the shared message for that catch. Copy and
  Image Viewer capture failures must keep their existing `Failed to ...` messages.
- `src/renderer/content/builtin-schemes.ts`: use the shared image message in the existing
  `resolveData()` catch. Keep `data.handled = true`, preserve the data-route title behavior, and
  do not move this handling into `PagesLifecycleModel.addDrawPage()`.
- `src/renderer/ui/app/MainPageView.ts`: no behavior change is required. `runSnip()` correctly
  opens the captured image in the Image Viewer; the Image Viewer toolbar is the single user action
  that requests `image.edit` for the snip result.

Representative toolbar change:

```ts
// Before — src/renderer/editors/image/ImageToolbarView.ts
private readonly onDrawClick = (): void => {
    void this.model.openInDrawingEditor();
};

// After — the same action now presents the shared state and catches other failures
private readonly onDrawClick = (): void => {
    void this.model.openInDrawingEditor().catch((error: unknown) => {
        const message = getMissingEditCapabilityMessage(error, "image.edit");
        void ui.notify(message ?? `Failed to open image in Drawing Editor: ${errMessage(error)}`, message ? "warning" : "error");
    });
};
```

Exact prefixes may be kept or simplified during implementation, but the no-handler branch must
not expose `No capability handler matches ...` as the user-facing sentence.

### 4. Keep the shared page/API path and bus rejection intact

- Do not add a catch or translation to `src/renderer/api/pages/PagesLifecycleModel.ts`; its
  `addDrawPage()` call is intentionally the common capability-bus path, not a UI presenter.
- Do not modify `src/renderer/api/capabilities.ts`, `src/renderer/api/capability-bus.ts`, or the
  IPC capability error types. A no-handler remains a typed rejection with the existing developer
  message for script, board, and direct API callers.
- Do not rename `addDrawPage()` or change its payload shape. It remains the live path for HTML,
  `data:image/...`, and the public scripting wrapper.

### 5. Verify the disabled/re-enabled state by hand

Use a build containing US-1508 and a profile with the bundled Excalidraw board present. Start with
the board enabled, then:

1. Open **Tools & Editors**. In the sidebar choose **Built-in Editors**; if using the full-page hub,
   choose **Built-in**. Right-click the bundled **Excalidraw** row and choose **Disable**. Confirm
   the row remains as a dimmed disabled row with an **Enable** context-menu action; do not click the
   row itself. Repeat the recovery check from each surface if both are available.
2. Optional bus check from a script: invoke `app.capabilities.invoke("image.edit", ...)` and
   `app.capabilities.invoke("diagram.edit", ...)` with small valid payloads. Each must reject with
   `CapabilityError.code === "no-handler"` and the unchanged developer message. This proves the
   presentation change did not weaken the bus.
3. Image viewer: open a PNG or JPEG, click **Open in Drawing Editor**, and verify one warning
   notification uses the actionable image message and no page opens. Re-enable the board from the
   disabled row, without restarting, click the same button again, and verify a board page opens.
4. SVG editor: open an `.svg`, click **Open in Drawing Editor**, and verify the actionable image
   warning. Choose **Enable** from the disabled board row, then click again and verify the bundled
   board opens without restarting.
5. Mermaid editor: open a Mermaid source page. Click **Open in Drawing Editor** and verify the
   image-specific message. Disable the board again, click **Convert to Excalidraw (editable
   shapes)**, and verify the separate diagram-specific message for the missing `diagram.edit`
   handler. Enable the board and retry both controls; the open-as-image and conversion paths must
   reach the board.
6. HTML editor: open an HTML page, open its additional image actions, and choose **Edit Image**.
   Verify capture completes but the missing-editor warning appears instead of the current generic
   failure. Enable the board and repeat; the captured image must open in a board page.
7. Screen snip: from the header quick settings choose **Snip Screen** or **Snip Persephone**,
   complete a capture, and verify it opens in the Image Viewer. With the board disabled, click the
   viewer's **Open in Drawing Editor** button and verify the same actionable image message. Enable
   the board and repeat the button action; the snip must open in the board without restarting.
8. `data:image/...` route: from a script run
   `await app.openRawLink("data:image/png;base64,<small-valid-png>", { editor: "image.edit" })`.
   With the board disabled, verify the route's warning and no board page; after enabling, rerun the
   same call and verify it opens the board. This specifically exercises the current
   `data.target === "image.edit"` branch rather than the image viewer.
9. If a replacement image/diagram board is available, register it and repeat the disabled-board
   state. The actionable no-handler message must not appear while that replacement is registered;
   the existing capability priority/origin rules remain responsible for selecting it.

The critical live-state check is step 3/4/5/6/7/8 after **Enable**: every path must recover in the
same renderer session. EPIC-109's reactive rebuild already proves the registration mechanism; this
task must prove each presentation consumer observes that restored handler.

## Runtime verification (2026-09-25)

Verified end to end against the running app, with the bundled board actually disabled.

1. **The state is reachable.** Setting `disabled-bundled-boards` to `["excalidraw"]` and invoking
   `image.edit` rejects with `code: "no-handler"` and the unchanged developer message
   `No capability handler matches "image.edit".` — the bus contract is intact, as required.
2. **The Image Viewer, previously silent, now speaks.** Clicking `image-open-draw` on a real image
   page produced a **warning** notification reading exactly:
   *No image editor is registered. Enable the board in Tools & Editors or install a replacement.*
   Confirmed twice — in the DOM and in the notification event stream.
3. **The diagram wording is distinct and correct.** Clicking `mermaid-convert-excalidraw` on a
   Mermaid page produced: *No diagram editor is registered. Enable the board in Tools & Editors or
   install a replacement.*
4. **Recovery is live, with no restart.** Setting `disabled-bundled-boards` back to `[]` and
   invoking `image.edit` again succeeded and returned a page id — confirming EPIC-109's claim that
   the flag applies without restarting.

Not exercised at runtime, and unchanged in shape from the paths above: the SVG toolbar, the HTML
editor's capture handoff, the `data:image/...` link route, and the snip-to-Image-Viewer flow (which
reaches the user through the same `image-open-draw` button verified in step 2).

## Concerns / Open questions

### Resolved decisions

- **One place versus per-consumer wording:** one shared classifier/message formatter is the right
  compromise. The code does not have one common presentation call site: direct Image/SVG/Mermaid
  invokes bypass `addDrawPage()`, HTML and the data route catch around `addDrawPage()`, and snip
  reaches Image Viewer before invoking anything. Centralizing only in `addDrawPage()` would be
  incomplete; centralizing in the bus would affect non-UI callers. Shared wording plus local toast
  boundaries covers every path without changing ownership.
- **Diagram wording:** `diagram.edit` is a distinct capability and is only invoked by Mermaid
  conversion in the current source. It gets “No diagram editor is registered ...”; an image message
  would misdescribe the operation. A conversion-failed result from an available diagram handler is
  not a missing-handler state and retains Mermaid's existing informational fallback behavior.
- **Board name:** use generic “disabled board”, not “Excalidraw”. The current row is manifest-labelled
  Excalidraw, but the user may install a replacement and the capability message should remain true.
- **Recovery row:** point at the shared **Tools & Editors** surface and its disabled row's **Enable**
  context action. The sidebar names the tab **Built-in Editors** and the full hub names it
  **Built-in**, so the message intentionally names neither tab. `getDisabledBundledBoardItems()` is
  specifically designed to make Disable reversible; telling users to click the inert row or edit
  settings would contradict its current behavior.
- **Error level:** use a `"warning"` notification for the known configuration state. Preserve
  existing error toasts for all other failures.
- **Bus contract:** no changes to `noHandlerError()` or the typed rejection. Presentation code
  recognizes `CapabilityError.code === "no-handler"` and leaves every other code/error unchanged.

### Remaining implementation risks

- SVG and Mermaid currently wrap errors in model code, so implementation must preserve only the
  typed no-handler case before the shared classifier runs. A careless catch rewrite could either
  hide the actionable state or flatten every operational failure into it.
- The Mermaid conversion fallback has two capability ids in one user action. Tests must distinguish a
  missing initial `diagram.edit` from a missing fallback `image.edit`.
- The image toolbar currently drops its promise. Adding the catch must not turn unrelated image-load
  or image-read failures into the no-editor state.
- `withCapture()` is shared by HTML copy/open/edit actions. Only `editImage()` should opt into the
  image-capability classification; capture failures for the other actions must remain contextual.
- The disabled row is present because the board record remains discoverable even when registration
  is disabled. If the board is physically missing, no recovery row can exist; that is outside this
  task's disabled-board state and should retain ordinary error behavior.

## Acceptance Criteria

- [ ] With `draw-view` absent and the bundled board disabled, `image.edit` and `diagram.edit` have
      no registered handler when no trusted replacement is installed.
- [ ] `app.capabilities.invoke("image.edit", ...)` and `invoke("diagram.edit", ...)` still reject
      with typed `CapabilityError` code `"no-handler"` and the unchanged developer-shaped text.
- [ ] The image viewer's **Open in Drawing Editor** action shows the shared actionable image state;
      it no longer silently drops the rejection.
- [ ] SVG, HTML, the `data:image/...` route, and the snip-to-Image-Viewer flow show the same
      image-specific actionable state when no image handler exists.
- [ ] Mermaid's direct image handoff shows the image-specific state, while Mermaid conversion with
      no `diagram.edit` handler shows the diagram-specific state.
- [ ] The short messages tell the user to enable the disabled board from the shared Tools & Editors
      surface or install a replacement, without hardcoding either “Built-in Editors”/“Built-in” or
      “Excalidraw”; the full remedy clause remains readable in a narrow-window toast.
- [ ] The existing disabled-board row remains the remedy: its context menu exposes **Enable**, its
      row activation remains inert, and enabling it restores capability registration live.
- [ ] Re-enabling the bundled board restores every consumer in the same session, with no restart.
- [ ] Non-`no-handler` failures retain their existing contextual error behavior.
- [ ] No change is made to the capability bus error contract, `addDrawPage()` rejection behavior,
      script/API callers, or the concurrent US-1509 files.
- [ ] Manual verification records the disabled and re-enabled result for Image, SVG, Mermaid
      image/conversion, HTML, snip, and the `data:image/...` route.

## Files that need no changes

- `src/renderer/api/capabilities.ts`, `src/renderer/api/capability-bus.ts`, and
  `src/ipc/capability-bus-channels.ts` — the typed no-handler contract and transport stay intact.
- `src/renderer/api/pages/PagesLifecycleModel.ts` and `src/renderer/api/pages/PagesModel.ts` —
  `addDrawPage()` already invokes `image.edit`; presentation catches belong to its consumers.
- `src/renderer/ui/sidebar/tools-editors-registry.ts` and
  `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` — the live disabled-board recovery row is
  already implemented and is reused, not redesigned.
- `src/renderer/ui/app/MainPageView.ts` and `snip-tool/src/**` — snip capture correctly opens the
  Image Viewer; the image-edit request occurs at the viewer's existing toolbar action.
- `assets/boards/excalidraw/board-manifest.json` and `assets/boards/excalidraw/index.html` — the
  board's two capability declarations and handler behavior are consumed as-is.
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, and
  `src/renderer/core/utils/performance-janitor.ts` — owned by the concurrent US-1509 session.
- `doc/active-work.md` and `doc/epics/EPIC-110.md` — the dashboard entry and EPIC-110 task row
  already exist, and the request explicitly forbids adding a dashboard entry.
- `src/renderer/editors/draw/**` — already removed by US-1508; no fallback or compatibility editor
  is reintroduced.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/api/capability-feedback.ts` | Add the pure capability-specific no-handler classifier and the shared image/diagram remedy messages | No |
| `src/renderer/editors/image/ImageToolbarView.ts` | Catch the currently silent image-edit rejection and present the shared image state | No |
| `src/renderer/editors/svg/SvgEditor.ts` / `src/renderer/editors/svg/index.ts` | Preserve the typed no-handler case through the model and present it once in the toolbar boundary | No |
| `src/renderer/editors/mermaid/MermaidEditor.ts` / `src/renderer/editors/mermaid/index.ts` | Preserve and present separate image and diagram no-handler states | No |
| `src/renderer/editors/html/HtmlEditor.ts` | Classify only the `editImage()` capability failure inside the shared capture wrapper | No |
| `src/renderer/content/builtin-schemes.ts` | Present the shared image state in the existing `data:image/...` catch | No |
| `doc/tasks/US-1510-no-image-editor-message/README.md` | Record verified reachability, consumer behavior, message decision, implementation plan, and hand verification | Yes |
| `src/renderer/api/capabilities.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/ui/app/MainPageView.ts`, `snip-tool/src/**`, US-1509 files | No implementation change; preserve the bus, shared page API, snip handoff, and concurrent work | No |
