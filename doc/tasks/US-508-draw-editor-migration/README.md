# US-508: Draw editor — UIKit migration

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration. Per the deferred-review model, this task
will not run `/review`, `/document`, or `/userdoc` — those run when the
epic closes.

## Goal

Migrate the Draw editor (Excalidraw canvas wrapper) chrome to UIKit
primitives. After this task, `editors/draw/DrawView.tsx` contains no
`@emotion/styled` definitions and imports nothing from
`components/basic/`, `components/form/`, or `components/overlay/`.

The Excalidraw library, library adapter (`drawLibrary.ts`), and export
helpers (`drawExport.ts`) are **out of scope** — only the editor shell
and toolbar migrate.

## Background

### Where the Draw editor renders

- Registered in `register-editors.ts:534-563` as the `"draw-view"`
  content-view editor for `*.excalidraw` files. It hosts inside a
  `TextFileModel`, so the toolbar buttons portal into the
  `editorToolbarRefLast` slot owned by the text-editor chrome (set in
  `TextEditorModel.ts:160` and consumed by `TextToolbar.tsx`). DrawView
  injects its toolbar into that ref via `createPortal(...)` — that
  injection mechanism stays the same.
- The host portal target already lays children out as
  `display: flex; alignItems: center; gap: 4` (see
  `TextToolbar.tsx:28-32`), so portaled buttons sit in a horizontal row
  with the text-editor's other actions. The migration does not change
  the portal-target layout.

### Toolbar buttons (5 in the portal)

| # | Original button                                          | Action                                                                                |
|---|----------------------------------------------------------|---------------------------------------------------------------------------------------|
| 1 | `Sun/MoonIcon`                                           | `vm.toggleDarkMode()` — flips Excalidraw between light/dark.                          |
| 2 | `CopyIcon`                                               | `handleCopyToClipboard` — exports PNG and writes to clipboard.                        |
| 3 | `DownloadIcon` inside `WithPopupMenu` (Save menu)        | "Save as SVG" / "Save as PNG" — open save dialog and write the file.                  |
| 4 | `NewWindowIcon` inside `WithPopupMenu` (Open menu)       | "Open as SVG" / "Open as Image" — open as a new editor page (`pagesModel.addEditorPage` / `openImageInNewTab`). |
| 5 | `SnipIcon`                                               | `handleScreenSnip` — Rust snip → adds image to Excalidraw scene.                      |

Excalidraw renders its own library UI inside its canvas — that library
button is not part of the toolbar and is untouched.

### Loading and error states

- `if (error) return <EditorError>{error}</EditorError>` — `EditorError`
  is a styled component in `editors/base/EditorError.tsx`. Out of scope
  here — that file is not changed by this task.
- `if (loading) return <CircularProgress />` — direct return of a
  32×32 spinner; replaced with `<Spinner />` (also default size 32).

### Reference migration

`editors/settings/SettingsPage.tsx:508-518` is the gold standard for
the `WithPopupMenu → WithMenu` swap and demonstrates the render-prop
shape stays identical:

```tsx
<WithMenu items={getColorMenuItems(profile.name, profile.color)}>
    {(setOpen) => (
        <Dot ... onClick={(e) => setOpen(e.currentTarget)} />
    )}
</WithMenu>
```

`SettingsPage` also already uses `<div style={{...}}>` on plain HTML
elements (lines 41-67, ThemePreview) — confirming Rule 7 only forbids
`style={...}` on UIKit components, not on local plain `<div>`s.

## Files in scope

| File                                               | What changes                                                                 |
|----------------------------------------------------|------------------------------------------------------------------------------|
| `src/renderer/editors/draw/DrawView.tsx`           | Remove styled root + legacy imports, swap to UIKit `Panel`/`IconButton`/`Spinner`/`WithMenu`. |

## Files NOT changed

| File                                                  | Why                                              |
|-------------------------------------------------------|--------------------------------------------------|
| `src/renderer/editors/draw/DrawViewModel.ts`          | Model logic, no chrome.                          |
| `src/renderer/editors/draw/drawExport.ts`             | Pure SVG/PNG export helpers.                     |
| `src/renderer/editors/draw/drawLibrary.ts`            | Excalidraw library adapter.                      |
| `src/renderer/editors/draw/index.ts`                  | Re-export only.                                  |
| `src/renderer/editors/register-editors.ts`            | Editor registration unchanged.                   |
| `src/renderer/editors/text/TextEditorModel.ts`        | Toolbar portal owner — host stays unchanged.     |
| `src/renderer/editors/text/TextToolbar.tsx`           | Portal target — layout (gap 4, flex row) reused. |
| `src/renderer/editors/base/EditorError.tsx`           | Error chrome — separate task if migrated.        |

## Old → UIKit primitives

| Old                                                        | New                                            |
|------------------------------------------------------------|------------------------------------------------|
| `styled.div` (`DrawViewRoot`)                              | UIKit `Panel` (`direction="column" flex={1} overflow="hidden" position="relative"`) |
| `& .excalidraw-wrapper` styled-descendant rule             | `style={{ flex: "1 1 auto", width: "100%", height: "100%" }}` on the local `<div>` (plain HTML, not a UIKit component) |
| `components/basic/CircularProgress`                        | UIKit `Spinner` (default size 32 — same)       |
| `components/basic/Button` (`type="icon" size="small"`)     | UIKit `IconButton` (`size="sm"`)               |
| `components/overlay/WithPopupMenu`                         | UIKit `WithMenu`                               |
| `import type { MenuItem } from ".../PopupMenu"`            | `import type { MenuItem } from "../../uikit/Menu"` (same underlying type, re-exported from `api/types/events`) |

## Sizing reference (no behaviour change)

| Token                              | Old `Button type="icon" size="small"` | New `IconButton size="sm"` |
|------------------------------------|---------------------------------------|----------------------------|
| Button frame (width × height)      | 24 × 24 (`.small` rule)               | 24 × 24 (`height.controlSm`) |
| Icon size                          | 16 × 16 (`.small` svg rule)           | 16 × 16 (`height.iconMd`)  |
| Hover/active feedback              | svg color → `icon.default` / `icon.dark` | same — IconButton uses identical color tokens |

Visual output of the toolbar is unchanged.

## Implementation plan

### Step 1 — Imports

**Remove:**

```ts
import styled from "@emotion/styled";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import type { MenuItem } from "../../components/overlay/PopupMenu";
```

**Add:**

```ts
import { Panel } from "../../uikit/Panel";
import { IconButton } from "../../uikit/IconButton";
import { Spinner } from "../../uikit/Spinner";
import { WithMenu } from "../../uikit/Menu";
import type { MenuItem } from "../../uikit/Menu";
```

All other imports (`@excalidraw/excalidraw`, theme icons, `vm`,
`apiRef`, `pagesModel`, `ui`, `fs`, `api`, `settings`, etc.) are
unchanged.

### Step 2 — Drop the styled component, swap the loading branch

**Delete** the `DrawViewRoot = styled.div(...)` block (`DrawView.tsx:40-51`).

**Loading branch** — replace:

```tsx
if (loading) return <CircularProgress />;
```

with:

```tsx
if (loading) return <Spinner />;
```

### Step 3 — Migrate root element + toolbar portal

**Before** (`DrawView.tsx:306-388` — abridged):

```tsx
return (
    <DrawViewRoot>
        {Boolean(model.editorToolbarRefLast) &&
            createPortal(
                <>
                    <Button type="icon" size="small" title={...} onClick={vm.toggleDarkMode}>
                        {darkMode ? <SunIcon /> : <MoonIcon />}
                    </Button>
                    <Button type="icon" size="small" title="Copy Image to Clipboard" onClick={handleCopyToClipboard}>
                        <CopyIcon />
                    </Button>
                    <WithPopupMenu items={saveMenuItems}>
                        {(setOpen) => (
                            <Button type="icon" size="small" title="Save as file" onClick={(e) => setOpen(e.currentTarget)}>
                                <DownloadIcon />
                            </Button>
                        )}
                    </WithPopupMenu>
                    <WithPopupMenu items={openMenuItems}>
                        {(setOpen) => (
                            <Button type="icon" size="small" title="Open in new tab" onClick={(e) => setOpen(e.currentTarget)}>
                                <NewWindowIcon />
                            </Button>
                        )}
                    </WithPopupMenu>
                    <Button type="icon" size="small" title="Screen Snip" onClick={handleScreenSnip}>
                        <SnipIcon />
                    </Button>
                </>,
                model.editorToolbarRefLast!
            )}
        <div className="excalidraw-wrapper" onContextMenu={(e) => e.stopPropagation()} onClick={handleWrapperClick}>
            <Excalidraw ... />
        </div>
    </DrawViewRoot>
);
```

**After:**

```tsx
return (
    <Panel direction="column" flex={1} overflow="hidden" position="relative">
        {Boolean(model.editorToolbarRefLast) &&
            createPortal(
                <>
                    <IconButton
                        size="sm"
                        title={darkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}
                        icon={darkMode ? <SunIcon /> : <MoonIcon />}
                        onClick={vm.toggleDarkMode}
                    />
                    <IconButton
                        size="sm"
                        title="Copy Image to Clipboard"
                        icon={<CopyIcon />}
                        onClick={handleCopyToClipboard}
                    />
                    <WithMenu items={saveMenuItems}>
                        {(setOpen) => (
                            <IconButton
                                size="sm"
                                title="Save as file"
                                icon={<DownloadIcon />}
                                onClick={(e) => setOpen(e.currentTarget)}
                            />
                        )}
                    </WithMenu>
                    <WithMenu items={openMenuItems}>
                        {(setOpen) => (
                            <IconButton
                                size="sm"
                                title="Open in new tab"
                                icon={<NewWindowIcon />}
                                onClick={(e) => setOpen(e.currentTarget)}
                            />
                        )}
                    </WithMenu>
                    <IconButton
                        size="sm"
                        title="Screen Snip"
                        icon={<SnipIcon />}
                        onClick={handleScreenSnip}
                    />
                </>,
                model.editorToolbarRefLast!
            )}
        <div
            style={{ flex: "1 1 auto", width: "100%", height: "100%" }}
            onContextMenu={(e) => e.stopPropagation()}
            onClick={handleWrapperClick}
        >
            <Excalidraw ... />
        </div>
    </Panel>
);
```

The `<Excalidraw>` props block (`excalidrawAPI`, `libraryReturnUrl`,
`initialData`, `theme`, `onChange`, `UIOptions`) is unchanged.

The `excalidraw-wrapper` className is dropped — it existed only to
target the descendant CSS rule in the (now removed) styled root. The
wrapper `<div>` keeps its `onClick`/`onContextMenu` handlers and gains
the inline `style` (allowed because it's a plain HTML element, not a
UIKit component — Rule 7 forbids `style=` only on UIKit components).

### Step 4 — Verify

- `npm run lint` clean (the pre-existing
  `react-hooks/exhaustive-deps not found` ESLint quirk seen in US-505 /
  US-507 is unrelated to this migration; the file already has the same
  disable comments on `useEffect`/`useMemo` deps and they continue to
  work).
- `npx tsc --noEmit` reports no new type errors.
- Open a `.excalidraw` file: Excalidraw mounts; toolbar buttons render
  in the same slot with the same icons/tooltips/sizes.

## Resolved concerns

1. **Icon and frame size match.** Old `Button type="icon" size="small"`
   renders 24×24 with svg 16×16 (`Button.tsx:53-60`). New `IconButton
   size="sm"` is also 24×24 with svg 16×16 (`IconButton.tsx:62-69`,
   `tokens.ts: controlSm=24, iconMd=16`). No visual size change.
2. **Hover/active colors.** Old icon button cycles svg color through
   `icon.light → icon.default → icon.dark` on hover/press; UIKit
   IconButton uses the same three tokens (`IconButton.tsx:46-60`).
   Visually identical.
3. **Tooltip behaviour.** Old `Button` wraps in a `Tooltip` when
   `title` is set; UIKit `IconButton` does the same when `title` is
   provided (`IconButton.tsx:110`). Hover-tooltip UX preserved.
4. **WithMenu API parity.** `WithMenu` exposes `(setOpen) =>
   ReactElement` with `setOpen(anchor: Element | null)` — exact same
   shape as `WithPopupMenu`. Default offset `[-4, 4]` is the same
   (`WithMenu.tsx:17`). `MenuItem` type is re-exported from the same
   `api/types/events` source (`uikit/Menu/types.ts`), so existing
   `saveMenuItems` / `openMenuItems` arrays compile without edits.
5. **`style={...}` on `.excalidraw-wrapper` div.** Permitted —
   Rule 7's "no `style=`" applies only to UIKit components. Plain HTML
   elements (here a third-party-canvas wrapper) may use inline
   `style=`. Precedent: `editors/settings/SettingsPage.tsx:41-67`
   already does this for ThemePreview chrome. The wrapper still owns
   the `onClick`/`onContextMenu` handlers needed for the
   `library-menu-browse-button` interception.
6. **Loading spinner placement.** Original returns `<CircularProgress />`
   directly with no flex parent. `<Spinner />` renders as a 32-px
   `<span>` — visually identical (small spinner anchored at the
   editor body's natural origin). Out of scope to "improve" centering.
7. **`excalidraw-wrapper` className removed.** The class existed only
   to satisfy the styled-root's `& .excalidraw-wrapper` rule. It is
   not referenced from Excalidraw's library code (verified by
   greppable string check — only inside the local styled rule). Safe
   to drop along with the styled root.
8. **`React` namespace import.** Existing code uses
   `React.MouseEvent` in `handleWrapperClick` without an explicit
   `import React from "react"` — works because React 19's global
   namespace is available without import. The migration does not need
   to add or change a React import.
9. **No model / library / event-channel changes.** `useSyncExternalStore`,
   `useHandleLibrary`, `browserUrlChanged` subscription, `apiRef`
   wiring, debounced `updateFromExcalidraw`, and `handleWrapperClick`
   logic are untouched.

## Test surface (manual smoke)

Run the app with `npm start`, open `D:\Test\persephone\sample.excalidraw`
(or any `.excalidraw` file) and verify:

- [ ] Excalidraw mounts; existing content restores.
- [ ] Theme toggle (Sun/Moon) flips the canvas between light and dark
      and tracks app-theme changes via `settings.use("theme")`.
- [ ] Copy button puts a PNG of the scene on the clipboard
      (paste-test in another app).
- [ ] Save menu — "Save as SVG" and "Save as PNG" both open the save
      dialog and write the file at the chosen path.
- [ ] Open menu — "Open as SVG" opens an SVG editor page; "Open as
      Image" opens an image editor page.
- [ ] Screen Snip button launches the Rust snip; the captured image is
      added to the canvas at `IMAGE_OFFSET_X/Y` and capped at
      1200 px on the longer side.
- [ ] Excalidraw library — open the library panel, install a library
      via "Browse libraries" (URL handoff to internal browser → return
      URL), library items persist via `createLibraryAdapter`.
- [ ] Loading — open a `.excalidraw` file with the editor closed, and
      while the model is loading the Spinner shows briefly.
- [ ] Error path — corrupt the JSON intentionally (bad `"type"`) and
      confirm `EditorError` still renders (separate component, not
      changed here).

## Acceptance criteria

- [ ] No `@emotion/styled` import in `editors/draw/DrawView.tsx`.
- [ ] No imports from `components/basic/`, `components/form/`, or
      `components/overlay/` in `editors/draw/DrawView.tsx`.
- [ ] Toolbar renders 5 IconButtons with identical icons, tooltips,
      and 24×24 frames — visually unchanged.
- [ ] Save and Open menus open via `WithMenu`, fire the same handlers,
      and produce the same output files / pages.
- [ ] Loading spinner shows during model load.
- [ ] All toolbar actions (theme, copy, save SVG/PNG, open SVG/image,
      snip) work end-to-end.
- [ ] Excalidraw library install/return URL flow still works.
- [ ] `npm run lint` clean (no new errors); `npx tsc --noEmit` reports
      no new errors.

## Files Changed (planned)

| File                                          | Lines (approx) | Change                                                                                       |
|-----------------------------------------------|----------------|----------------------------------------------------------------------------------------------|
| `src/renderer/editors/draw/DrawView.tsx`      | ~70 ↓          | Remove styled root + 4 legacy imports; add 5 UIKit imports; swap CircularProgress → Spinner; swap 5 Buttons → IconButtons; swap 2 WithPopupMenu → WithMenu; replace `.excalidraw-wrapper` styled rule with inline style on the wrapper div. |

## Files Unchanged

| File                                                | Why                                                       |
|-----------------------------------------------------|-----------------------------------------------------------|
| `src/renderer/editors/draw/DrawViewModel.ts`        | Model state and dark-mode logic untouched.                |
| `src/renderer/editors/draw/drawExport.ts`           | SVG/PNG export pipeline untouched.                        |
| `src/renderer/editors/draw/drawLibrary.ts`          | Excalidraw library adapter untouched.                     |
| `src/renderer/editors/draw/index.ts`                | Re-export only.                                           |
| `src/renderer/editors/register-editors.ts`          | Editor registration untouched.                            |
| `src/renderer/editors/text/TextEditorModel.ts`      | Hosts `editorToolbarRefLast` — wiring unchanged.          |
| `src/renderer/editors/text/TextToolbar.tsx`         | Portal-target layout unchanged.                           |
| `src/renderer/editors/base/EditorError.tsx`         | Error chrome unchanged.                                   |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference migrations: [US-505 Archive](../US-505-archive-editor-migration/README.md), [US-506 Category](../US-506-category-editor-migration/README.md), [US-507 Explorer/Search](../US-507-explorer-secondary-editors-migration/README.md), [US-498 Settings](../US-498-settings-page-migration/README.md) (`WithMenu` precedent).
