# US-515: Browser editor chrome — UIKit migration

## Status

**Implemented — awaiting epic-close review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration. All three in-scope files migrated; tsc + lint baselines unchanged.

No UIKit precursor task is required — see [UIKit precursor analysis](#uikit-precursor-analysis).

## Goal

Migrate the Browser editor's main chrome (root view, tabs strip, bookmarks drawer) to UIKit primitives. After this task, the in-scope files import nothing from `components/basic|form|layout|overlay/`. Each of the three in-scope files keeps **one** local `styled(Panel)` wrapper holding only that component's chrome CSS quirks via descendant selectors — same Rule 7 documented-exception pattern as US-514's `VPlayer.tsx`. Each file therefore owns its visuals; nothing leaks across files.

The three retained wrappers:
- `BrowserEditorView.tsx` → `BrowserRoot` (loading bar, search-engine chip, Tor indicator + status dot, webview wrapper + click overlay, blank-toolbar hide rules)
- `BrowserTabsPanel.tsx` → `BrowserTabsRoot` (tab item compound state, favicon, title, tab-close reveal on row hover, tab-extension floating panel, group-color stripe)
- `BookmarksDrawer.tsx` → `BookmarksDrawerRoot` (backdrop, slide-in animation via `data-open` attribute)

## Background

The Browser editor is the largest still-legacy screen in the EPIC-025 inventory. Its split-out surfaces (FindBar, TorStatusOverlay, BrowserDownloadsPopup, UrlSuggestionsDropdown) are tracked by sibling tasks; US-515 covers only the three main rendering files.

### In-scope files

- **`src/renderer/editors/browser/BrowserEditorView.tsx`** — top-level editor. URL bar, page toolbar, tabs strip host, webview host, bookmarks rail, splitter, popup-blocked bar, loading bar, blank-page link editor.
- **`src/renderer/editors/browser/BrowserTabsPanel.tsx`** — vertical multi-webview tabs strip with right-click context menu and compact-mode hover-extension tooltip.
- **`src/renderer/editors/browser/BookmarksDrawer.tsx`** — collapsible right-side bookmarks drawer with backdrop, splitter, slide-in animation, and portal-target placeholders for `LinkEditor` toolbar/footer injections.

### Files NOT changed (covered elsewhere)

- `BrowserDownloadsPopup.tsx`, `DownloadButton.tsx` — **US-463** (blocked on US-466 Popover).
- `UrlSuggestionsDropdown.tsx` — **US-464** (blocked on US-468 ListBox).
- `TorStatusOverlay.tsx` — **US-462** (already migrated).
- `FindBar` — **US-461** consolidation.
- `BrowserEditorModel.ts`, `BrowserWebviewModel.ts`, `BrowserUrlBarModel.ts` — model code; only `MenuItem` *type* is imported from `components/overlay/PopupMenu`. That import will switch to UIKit `MenuItem` only when the type re-export is removed under a follow-up cleanup; for now it stays since the type is identical.

### Confirmed import inventory (current)

| File | `@emotion/styled` | components/basic | components/layout | components/overlay | theme/color |
|---|---|---|---|---|---|
| `BrowserEditorView.tsx` | yes | `Button`, `TextField`, `CircularProgress` | `Splitter` | `WithPopupMenu` | yes |
| `BrowserTabsPanel.tsx` | yes | `Button` | — | `PopupMenu` (type only) | yes |
| `BookmarksDrawer.tsx` | yes | — | `Splitter` | — | yes |

## UIKit precursor analysis

**No new UIKit primitives or prop additions are required.** All necessary primitives already exist:

| Need | UIKit primitive | Status |
|---|---|---|
| URL bar with start/end content slots | `Input` with `startSlot` / `endSlot` | shipped (US-471) |
| Page-menu, page-context-menu, search-engine popover anchors | `WithMenu` + `MenuItem` | shipped (US-481) |
| Tabs / webview resize bar; bookmarks-drawer resize bar | `Splitter` (controlled `value` / `onChange`) | shipped (US-486) |
| Loading spinner in URL bar (Tor connecting) | `Spinner` | existing |
| All chrome containers (toolbars, panels, drawers) | `Panel` | existing |
| Tor status dot | `Dot` | existing |
| Toolbar buttons + tab close / mute / new-tab buttons | `IconButton`, `Button` | existing |
| Popup-blocked bar text | `Text` | existing |
| Compact-mode tab hover-extension | `Popover` (or keep `useFloating`) | existing |

Chrome details that cannot be expressed by props (loading-bar `@keyframes`, blank-toolbar `.link-btn-add` / `.link-btn-browser-selector` hide rules, tab `::before` group-color stripe, tab compound state, bookmarks slide-in animation, search-engine chip hover) are scoped into **one local `styled(Panel)` wrapper per in-scope file**. Children inside that file render plain `<div>`s / UIKit primitives carrying `data-*` attributes, and the wrapper's descendant selectors style them. This is a Rule 7 documented exception per file, modeled on US-514's `VPlayer.tsx` retained `styled(Panel)` for video.js descendant CSS — except here the descendant CSS is our own chrome rather than third-party. Each wrapper is independent: BrowserTabsPanel's styles do not depend on living inside BrowserEditorView, and BookmarksDrawer can be lifted into any host. Each is removable later if its component's chrome simplifies.

**Dependencies (status — all satisfied):**
- US-471 UIKit Input start/end slots — **shipped** (marked `[ ]` in dashboard pending epic-close review).
- US-481 UIKit Menu + WithMenu — **shipped**.
- US-486 UIKit Splitter — **shipped**.

## Old → UIKit primitives

Grouped by in-scope file. Each group's "Stylistic hook" rules live inside that file's local `styled(Panel)` wrapper.

### `BrowserEditorView.tsx` → `BrowserRoot = styled(Panel)({...})`

| Old | Structural replacement | Stylistic hook (in `BrowserRoot` CSS) |
|---|---|---|
| `BrowserEditorViewRoot` (`styled.div`) | `BrowserRoot = styled(Panel)({...})` — the retained wrapper for this file | layout via `direction="column" flex={1} overflow="hidden"` props + chrome CSS inside |
| `.browser-toolbar-content` (`<div>`) | `<Panel direction="row" align="center" gap="xs" flex={1}>` inside `<PageToolbar borderBottom>` | — |
| `<Button type="icon" size="small">` | `<IconButton size="sm">` | — |
| `<Button size="small" type="flat">` (Allow on popup bar) | `<Button size="sm" variant="ghost">` | — |
| `<TextField className="url-bar" startButtons endButtons …>` | `<Input startSlot endSlot …>` inside `<Panel flex={1} data-url-bar="">` | `data-url-bar` replaces `.url-bar` className anchor (C2) |
| `<CircularProgress size={14} />` | `<Spinner size={14} />` | — |
| `.search-engine-btn` styled span | plain `<button data-search-engine-chip>` | `[data-search-engine-chip] { … :hover { … } }` (C3) |
| `.tor-indicator` styled span | plain `<span data-tor-indicator>` | `[data-tor-indicator] { position:relative; cursor:pointer; display:flex; … & svg{width:14;height:14} }` |
| `.tor-status-dot` styled span | `<span data-tor-status-dot><Dot size={6} color={…} /></span>` | `[data-tor-status-dot] { position:absolute; bottom:0; right:0 }` (C4) |
| `.loading-bar` + `@keyframes loading-pulse` | plain `<div data-browser-loading-bar>` | `@keyframes browser-loading-pulse` + `[data-browser-loading-bar] { animation:… }` (C5) |
| `.popup-blocked-bar` | `<Panel direction="row" align="center" gap="md" paddingX="md" paddingY="xs" background="light" borderBottom shrink={false}>` | — |
| `.browser-body` | `<Panel direction="row" flex={1} overflow="hidden" position="relative">` | — |
| `.tabs-panel` | `<Panel shrink={false} overflow="hidden" borderRight width={tabsPanelWidth}>` | — |
| `<Splitter type="vertical" initialWidth=… style={{left: tabsPanelWidth}}>` (absolute) | `<Splitter orientation="vertical" value={tabsPanelWidth} onChange={…} side="before" background="default" hoverBackground="light" border="none">` (inline flex) | C1 — drops the absolute-position overlay |
| `.webview-area` | `<Panel flex={1} position="relative" overflow="hidden">` | — |
| `.webview-tabs-host` (PageManager className) | `<PageManager>` rendered inside the relative panel; if `PageManager` needs an absolute wrapper, wrap in plain `<div style={{position:"absolute",top:0,right:0,bottom:0,left:0}}>` | — |
| `.webview-wrapper` | plain `<div data-webview-wrapper>` | `[data-webview-wrapper] { position:absolute; top/right/bottom/left:0; display:flex; & webview { flex:1 1 auto; border:none } }` |
| `.webview-click-overlay` | plain `<div data-webview-click-overlay>` | `[data-webview-click-overlay] { position:absolute; top/right/bottom/left:0; zIndex:1 }` |
| `.blank-page-links` / `.blank-page-toolbar` / `.blank-page-editor` | `<Panel>` stack with `data-blank-toolbar=""` on the toolbar Panel | `[data-blank-toolbar] .link-btn-add { display:none }` / `.link-btn-browser-selector { display:none }` (C6) |

### `BrowserTabsPanel.tsx` → `BrowserTabsRoot = styled(Panel)({...})`

| Old | Structural replacement | Stylistic hook (in `BrowserTabsRoot` CSS) |
|---|---|---|
| `BrowserTabsPanelRoot` (`styled.div`) | `BrowserTabsRoot = styled(Panel)({...})` with `direction="column" overflow="hidden" background="default" height="100%"` props | layout via props + chrome CSS inside |
| `.tabs-list` (`<div>`) | `<Panel flex={1} overflowY="auto" overflowX="hidden" direction="column">` | — |
| `.tab-item` (`<div>`) with hover/active/dragging/drop-target classNames | plain `<div data-tab-item data-active={…} data-compact={…} data-dragging={…} data-drop-target={…} data-hover-extended={…} style={{"--group-color":…}}>` | All `[data-tab-item]` rules: base layout, `:hover`, `&[data-active]`, `&[data-compact]`, `&[data-dragging]`, `&[data-drop-target]`, `&[data-hover-extended]`, `&::before` group-color stripe (C10) |
| `::before` group-color stripe | (kept) `&::before` inside `[data-tab-item]` rule consuming `var(--group-color)` | — |
| `.tab-favicon` (`<div>`) | plain `<div data-tab-favicon>` | `[data-tab-favicon] { width:14; height:14; flex-shrink:0; & svg{…}; & img{…} }` |
| `.tab-title` (`<div>`) | plain `<div data-tab-title>` | `[data-tab-title] { flex:1 1 auto; fontSize:12; … }` |
| `.tab-close` wrapping `<Button>` | `<IconButton data-tab-close size="sm">` directly (no wrapping div) | `[data-tab-item] [data-tab-close] { opacity:0; transition:opacity 80ms }` + `[data-tab-item]:hover [data-tab-close], [data-tab-item][data-active] [data-tab-close] { opacity:1 }` (C11) |
| `.add-tab-button` (`<div>`) wrapping `<Button>` | `<Panel direction="row" align="center" paddingX="xs" height={28} justify={compact?"center":"start"}>` + `<IconButton>` | — |
| `.tab-extension` floating panel | plain `<div ref={refs.setFloating} data-tab-extension data-active={…} style={floatingStyles}>` (kept `useFloating`) | `[data-tab-extension] { width:140; height:28; … }` + `[data-tab-extension][data-active] { … }` (C9) |

### `BookmarksDrawer.tsx` → `BookmarksDrawerRoot = styled(Panel)({...})`

| Old | Structural replacement | Stylistic hook (in `BookmarksDrawerRoot` CSS) |
|---|---|---|
| `BookmarksDrawerRoot` (`styled.div`) | `BookmarksDrawerRoot = styled(Panel)({...})` with `position="absolute" top/right/bottom/left={0} zIndex={6} direction="row"` + `data-open={isAnimating ? "" : undefined}` on render | layout via props + drawer chrome CSS inside |
| `.bookmarks-backdrop` (`<div>`) | plain `<div data-bookmarks-backdrop>` onClick | `[data-bookmarks-backdrop] { flex:1; backgroundColor:rgba(0,0,0,0.3) }` (C8) |
| `.bookmarks-panel` with slide-in transform | plain `<div data-bookmarks-panel-wrap style={{width,maxWidth:"90%"}}>` wrapping `<Panel direction="column" background="default" borderLeft height="100%" overflow="hidden">` | `[data-bookmarks-panel-wrap] { height:100%; transform:translateX(100%); transition:transform 80ms ease-in-out }` + `&[data-open] [data-bookmarks-panel-wrap] { transform:translateX(0) }` (C7) |
| `.bookmarks-toolbar` / `.bookmarks-footer` | `<Panel direction="row" align="center" gap="xs" paddingX="md" paddingY="xs" background="dark" border{Top,Bottom} minHeight={…} shrink={false}>` | — |
| `<Splitter type="vertical" borderSized="left">` (bookmarks) | `<Splitter orientation="vertical" value={width} onChange={onChangeWidth} side="after" background="default" hoverBackground="light" border="none">` | — |
| `theme/color` direct imports | each `styled(Panel)` wrapper imports `theme/color` for token colors used in its CSS rules | — |

## Debug naming (`name` prop)

US-515 is the first migration to opportunistically adopt the [US-521](../US-521-uikit-name-debug-attribute/README.md) `name` prop. Every UIKit primitive accepts an optional `name?: string` emitted as `data-name="…"` on the same DOM element as `data-type`. The browser chrome renders many `Panel`s and `IconButton`s side-by-side; without a debug label they all show as `<div data-type="panel">` in DevTools and become very hard to tell apart.

**Authoring rule for this task:** every `Panel`, `Splitter`, `Input`, `IconButton`, `Button`, `WithMenu`, `Spinner`, `Dot`, and `Text` that plays a *role* in the chrome — i.e., would be looked up in the inspector when debugging layout or interaction issues — MUST carry a meaningful `name` prop. Use lowercase-kebab values namespaced to the file/section (e.g. `name="browser-toolbar-content"`, `name="bookmarks-backdrop"`).

**When to set `name`:**
- A `Panel` that defines a layout region (toolbar, body, tabs list, webview area, blank-page toolbar, bookmarks panel, etc.).
- An `IconButton`/`Button` that represents a *named action* and is one of several in the same toolbar (back, forward, reload, home, more, star, bookmarks, devtools, close).
- A `Splitter`, `Input`, or other primitive that appears more than once on the screen.
- The retained `styled(Panel)` wrappers (`BrowserRoot`, `BrowserTabsRoot`, `BookmarksDrawerRoot`) — pass through a `name` so their `data-type="panel"` element is identifiable.

**When to skip `name`:**
- Trivial inline `Panel flex={1}` spacers and gap fillers.
- Primitives whose `data-type` already uniquely identifies them on the screen (e.g. a single `Spinner` inside a non-repeating slot).

**Suggested names per file** (use these unless a better label suggests itself during implementation):

| File | Primitive | `name` |
|---|---|---|
| `BrowserEditorView.tsx` | `BrowserRoot` (root `styled(Panel)`) | `browser-root` |
| | toolbar-content `<Panel direction="row">` | `browser-toolbar-content` |
| | URL-bar wrapping `<Panel data-url-bar="">` | `url-bar` |
| | URL `<Input>` | `url-input` |
| | each toolbar `<IconButton>` | `toolbar-back`, `toolbar-forward`, `toolbar-reload`, `toolbar-home`, `toolbar-go`, `toolbar-star`, `toolbar-bookmarks`, `toolbar-more`, `toolbar-devtools`, `toolbar-close` |
| | popup-blocked-bar `<Panel>` | `popup-blocked-bar` |
| | popup-blocked Allow `<Button>` | `popup-allow` |
| | browser-body row `<Panel>` | `browser-body` |
| | tabs-panel host `<Panel width=…>` | `tabs-panel-host` |
| | main `<Splitter>` (tabs ↔ webview) | `tabs-webview-splitter` |
| | webview-area `<Panel>` | `webview-area` |
| | `BlankPageLinks` outer `<Panel>` | `blank-page` |
| | blank-toolbar `<Panel data-blank-toolbar>` | `blank-page-toolbar` |
| `BrowserTabsPanel.tsx` | `BrowserTabsRoot` (root `styled(Panel)`) | `browser-tabs-root` |
| | tabs-list `<Panel>` | `browser-tabs-list` |
| | add-tab `<Panel>` + its `<IconButton>` | `add-tab-row` / `add-tab-button` |
| | per-tab close `<IconButton>` | `tab-close` |
| | per-tab mute `<IconButton>` | `tab-mute` |
| | tab-extension close/mute `<IconButton>`s | `tab-extension-close`, `tab-extension-mute` |
| `BookmarksDrawer.tsx` | `BookmarksDrawerRoot` (root `styled(Panel)`) | `bookmarks-drawer-root` |
| | drawer `<Splitter>` | `bookmarks-splitter` |
| | bookmarks panel `<Panel borderLeft>` | `bookmarks-panel` |
| | toolbar `<Panel>` | `bookmarks-toolbar` |
| | footer `<Panel>` | `bookmarks-footer` |
| | editor host `<Panel flex={1}>` | `bookmarks-editor-host` |

If a primitive isn't in the table but matches a "When to set" rule above, invent a meaningful name in the same style. If a primitive isn't in the table and matches "When to skip", leave `name` off.

### Phase 1 — `BrowserEditorView.tsx`

**Imports — final state:**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
const { ipcRenderer } = require("electron");
import styled from "@emotion/styled";  // retained Rule 7 exception — see BrowserRoot below
import { IEditorState, EditorType } from "../../../shared/types";
import { EditorModel, PageToolbar } from "../base";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { Panel, Input, Button, IconButton, Spinner, Text, Dot, Splitter, WithMenu } from "../../uikit";
import {
    ArrowLeftIcon, ArrowRightIcon, BookmarkIcon, CloseIcon, HomeIcon,
    MoreVertIcon, RefreshIcon, SettingsIcon, StarFilledIcon, StarIcon, StopIcon,
} from "../../theme/icons";
import { IncognitoIcon, TorIcon } from "../../theme/language-icons";
import color from "../../theme/color";
import { TorStatusOverlay } from "./TorStatusOverlay";
import { BrowserEditorModel, BrowserEditorState, BrowserTabData, getDefaultBrowserPageState } from "./BrowserEditorModel";
import { BrowserChannel, BrowserRegisterRequest } from "../../../ipc/browser-ipc";
import { BrowserTabsPanel } from "./BrowserTabsPanel";
import { UrlSuggestionsDropdown } from "./UrlSuggestionsDropdown";
import { BookmarksDrawer } from "./BookmarksDrawer";
import { LinkEditor } from "../link-editor/LinkEditor";
import { BrowserBookmarks } from "./BrowserBookmarks";
import { DownloadButton } from "./DownloadButton";
import { FindBar } from "../shared/FindBar";
import { PageManager } from "../../components/page-manager/PageManager";
```

Drop: `components/basic/{Button,TextField,CircularProgress}`, `components/layout/Splitter`, `components/overlay/WithPopupMenu`. Drop the legacy `BrowserEditorViewRoot` styled definition (replaced by `BrowserRoot` styled(Panel) below).

**Steps:**

1. **Define the `BrowserRoot` styled wrapper.** This is the file's one retained `styled(Panel)` (Rule 7 documented exception). It holds all chrome CSS owned by this file: loading-bar keyframes, search-engine chip, Tor indicator + status dot positioning, webview wrapper + click overlay, blank-toolbar hide rules.

    ```ts
    // styled(Panel) wrapper — Rule 7 exception, scoped to this file's chrome quirks.
    // Children render plain <div>s / UIKit primitives with data-* attributes; the
    // descendant selectors below style them. Removable when chrome simplifies.
    const BrowserRoot = styled(Panel)({
        "@keyframes browser-loading-pulse": {
            "0%":  { opacity: 0.3 },
            "50%": { opacity: 1 },
            "100%": { opacity: 0.3 },
        },
        "[data-browser-loading-bar]": {
            height: 2,
            backgroundColor: color.border.active,
            animation: "browser-loading-pulse 1.5s ease-in-out infinite",
        },
        "[data-search-engine-chip]": {
            cursor: "pointer",
            fontSize: 11,
            color: color.text.light,
            padding: "0 4px",
            borderRadius: 3,
            whiteSpace: "nowrap",
            userSelect: "none",
            lineHeight: "20px",
            background: "transparent",
            border: "none",
            "&:hover": {
                color: color.text.default,
                backgroundColor: color.background.light,
            },
        },
        "[data-tor-indicator]": {
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 2px",
            position: "relative",
            "& svg": { width: 14, height: 14 },
        },
        "[data-tor-status-dot]": {
            position: "absolute",
            bottom: 0,
            right: 0,
        },
        "[data-webview-wrapper]": {
            position: "absolute",
            top: 0, right: 0, bottom: 0, left: 0,
            display: "flex",
            "& webview": {
                flex: "1 1 auto",
                border: "none",
            },
        },
        "[data-webview-click-overlay]": {
            position: "absolute",
            top: 0, right: 0, bottom: 0, left: 0,
            zIndex: 1,
        },
        "[data-blank-toolbar] .link-btn-add": { display: "none" },
        "[data-blank-toolbar] .link-btn-browser-selector": { display: "none" },
    });
    ```

2. **Root** — replace `<BrowserEditorViewRoot onKeyDown={webview.handleKeyDown} tabIndex={-1}>` with:

    ```tsx
    <BrowserRoot direction="column" flex={1} overflow="hidden" onKeyDown={webview.handleKeyDown} tabIndex={-1}>
    ```

    `BrowserRoot` is `styled(Panel)` so all Panel props pass through. Legacy `outline:"none"` is dropped — `tabIndex={-1}` doesn't add a focus ring on render; verify in manual smoke.

3. **Page toolbar** — keep `<PageToolbar borderBottom>` (`EditorToolbar` re-export; out of scope). Replace inner `<div className="browser-toolbar-content">` with `<Panel direction="row" align="center" flex={1} gap="xs">`.

4. **Each toolbar `<Button type="icon" size="small">…</Button>`** → `<IconButton size="sm" icon={<IconComponent />} title="…" onClick={…} disabled={…} />`. Eleven such buttons total (Home, Back, Forward, Reload/Stop, Go, Star, Bookmarks, More, DevTools, Close, +Allow in popup bar).

5. **Star button color override** — legacy: `style={isBookmarked ? { color: color.misc.blue } : undefined}`. UIKit IconButton forbids `style`. Resolution: use `active={isBookmarked}` so the icon uses `color.icon.active`. The icon swap (`StarFilledIcon` vs `StarIcon`) already signals state visually.

6. **URL bar** — replace `<WithPopupMenu items={searchEngineMenuItems} offset={[-4, 4]}>(openEngineMenu) => (<TextField …>)</WithPopupMenu>` with:

    ```tsx
    <WithMenu items={searchEngineMenuItems}>
        {(openEngineMenu) => (
            <Panel flex={1} data-url-bar="">
                <Input
                    ref={urlBar.setUrlInputRef}
                    value={urlInput}
                    onChange={urlBar.handleUrlChange}
                    onKeyDown={urlBar.handleUrlKeyDown}
                    onFocus={urlBar.handleUrlFocus}
                    onBlur={urlBar.handleUrlBlur}
                    onContextMenu={urlBar.handleUrlContextMenu}
                    placeholder="Enter URL or search term..."
                    size="sm"
                    startSlot={renderStartSlot(isTor, torStatus, isIncognito, showSearchEngineSelector, currentEngineName, openEngineMenu, model)}
                    endSlot={renderEndSlot(urlBar.handleNavigate, isBookmarked, bookmarksUI.handleStarClick)}
                />
            </Panel>
        )}
    </WithMenu>
    ```

    `Input.onChange` receives the value string (not an event). `handleUrlChange` in the model already accepts a string; if it takes an event, adapt to `(v: string) => model.urlBar.handleUrlChange(v)`. Verify in `BrowserUrlBarModel.ts`.

    `WithMenu`'s default offset is `[-4, 4]` (same as legacy default). ✅

    `data-url-bar=""` on the wrapping Panel replaces the `.url-bar` className anchor used by `UrlSuggestionsDropdown` lookup (see C2 / step 12).

7. **`startSlot` content** — extract into a helper function for readability. Each slot child is plain DOM carrying `data-*` attributes; `BrowserRoot`'s descendant selectors handle styling. No inline style for chrome rules (positioning + cursor still uses inline style where needed):

    ```tsx
    function renderStartSlot(...): React.ReactNode {
        const out: React.ReactNode[] = [];
        if (isTor) {
            const dotColor = torStatus === "connected" ? "success" : torStatus === "error" ? "error" : "warning";
            out.push(
                <span
                    key="tor"
                    data-tor-indicator
                    onClick={(e) => { e.stopPropagation(); model.toggleTorOverlay(); }}
                    title="Tor status"
                >
                    {torStatus === "connecting" ? <Spinner size={14} /> : <TorIcon />}
                    {torStatus !== "connecting" && (
                        <span data-tor-status-dot><Dot size={6} color={dotColor} /></span>
                    )}
                </span>,
            );
        }
        if (isIncognito) out.push(<IncognitoIcon key="incognito" color={color.icon.light} />);
        if (showSearchEngineSelector) {
            out.push(
                <button
                    key="se"
                    type="button"
                    data-search-engine-chip
                    onClick={(e) => { e.stopPropagation(); openEngineMenu(e.currentTarget); }}
                    title="Change search engine"
                >
                    {currentEngineName} ▾
                </button>,
            );
        }
        return out.length ? <>{out}</> : undefined;
    }
    ```

    The search-engine chip is a plain `<button>` styled by `BrowserRoot`'s `[data-search-engine-chip]` rule — CSS `:hover` handles hover without React state. ✓

8. **`endSlot` content**:

    ```tsx
    function renderEndSlot(onNavigate, isBookmarked, onStar) {
        return (
            <>
                <IconButton key="go" size="sm" icon={<ArrowRightIcon />} title="Navigate" onClick={onNavigate} />
                <IconButton key="star" size="sm" icon={isBookmarked ? <StarFilledIcon /> : <StarIcon />} title={isBookmarked ? "Edit Bookmark" : "Add Bookmark"} active={isBookmarked} onClick={onStar} />
            </>
        );
    }
    ```

9. **More-menu** — replace `<WithPopupMenu items={webview.getPageMenuItems()}>(openMenu) => (<Button …>)` with `<WithMenu items={webview.getPageMenuItems()}>(openMenu) => (<IconButton ref={…} icon={<MoreVertIcon />} onClick={(e) => openMenu(e.currentTarget)} />)</WithMenu>`.

10. **Loading bar** — replace `{loading ? <div className="loading-bar" /> : <div className="loading-bar-placeholder" />}` with:

    ```tsx
    {loading ? (
        <div data-browser-loading-bar />
    ) : (
        <div style={{ height: 2 }} />
    )}
    ```

    `BrowserRoot`'s `[data-browser-loading-bar]` rule provides height, color, and animation. The placeholder is a plain `<div style={{ height: 2 }}>` since it doesn't need any selector — single inline-style declaration.

11. **Popup-blocked bar** — replace `<div className="popup-blocked-bar">` block with:

    ```tsx
    {blockedPopupCount > 0 && (
        <Panel direction="row" align="center" gap="md" paddingX="md" paddingY="xs" background="light" borderBottom shrink={false}>
            <Text size="sm" flex={1}>
                {blockedPopupCount === 1 ? "A popup was blocked on this page" : `${blockedPopupCount} popups were blocked on this page`}
            </Text>
            <Button size="sm" variant="ghost" onClick={model.allowPopups}>Allow</Button>
            <IconButton size="sm" icon={<CloseIcon />} onClick={model.dismissBlockedPopups} title="Dismiss" />
        </Panel>
    )}
    ```

    Verify `Text` accepts `flex` prop — check `Text.tsx` once during implementation; if not, wrap in a `Panel flex={1}`.

12. **Browser body** — replace `<div className="browser-body">` and its children. Layout becomes inline-flex (no absolute splitter):

    ```tsx
    <Panel direction="row" flex={1} overflow="hidden" position="relative">
        <Panel shrink={false} overflow="hidden" borderRight width={tabsPanelWidth}>
            <BrowserTabsPanel model={model} tabs={tabs} activeTabId={activeTabId} width={tabsPanelWidth} />
        </Panel>
        <Splitter
            orientation="vertical"
            value={tabsPanelWidth}
            onChange={model.setTabsPanelWidth}
            side="before"
            min={32}
            background="default"
            hoverBackground="light"
            border="none"
        />
        <Panel flex={1} position="relative" overflow="hidden">
            <PageManager
                pageIds={tabs.map((t) => t.id)}
                activeId={activeTabId}
                renderPage={(tabId) => { /* unchanged inner render — see step 13 */ }}
                /* PageManager still accepts className; drop className. Inner host is positioned absolute by PageManager itself, no wrapper needed. */
            />
            {isTor && torOverlayVisible && (<TorStatusOverlay model={model} torStatus={torStatus} torLog={torLog} />)}
            {popupOpen && (<div data-webview-click-overlay />)}
            {findBarVisible && (<FindBar text={findText} currentMatch={findActiveMatch} totalMatches={findTotalMatches} onTextChange={webview.setFindText} onNext={webview.findNext} onPrev={webview.findPrev} onClose={webview.closeFind} placeholder="Find in page..." />)}
        </Panel>
        {bookmarksReady && model.bookmarks && (
            <BookmarksDrawer
                open={bookmarksOpen}
                bookmarks={model.bookmarks}
                width={bookmarksWidth}
                onChangeWidth={(w) => model.state.update((s) => { s.bookmarksWidth = w; })}
                onClose={bookmarksUI.handleCloseBookmarks}
            />
        )}
    </Panel>
    ```

    Verify `PageManager` still positions its host correctly without the `webview-tabs-host` className overriding to `position:absolute; inset:0`. If `PageManager` relies on that selector internally, it owns its own positioning — read `components/page-manager/PageManager.tsx` during implementation. If it expects an absolute wrapper, wrap it in a `<div style={{ position:"absolute", top:0,right:0,bottom:0,left:0 }}>`.

13. **`BlankPageLinks` subcomponent** — convert to UIKit. Outer container becomes:

    ```tsx
    function BlankPageLinks({ bookmarks }: BlankPageLinksProps) {
        const [toolbarFirstRef, setToolbarFirstRef] = useState<HTMLDivElement | null>(null);
        const [toolbarLastRef,  setToolbarLastRef]  = useState<HTMLDivElement | null>(null);

        return (
            <Panel position="absolute" top={0} right={0} bottom={0} left={0} zIndex={3} direction="column" background="default">
                <Panel direction="row" align="center" gap="xs" paddingX="md" paddingY="xs" background="dark" borderBottom shrink={false} minHeight={32} data-blank-toolbar="">
                    <Panel direction="row" align="center" gap="xs"><div ref={setToolbarFirstRef} /></Panel>
                    <Panel flex={1} />
                    <Panel direction="row" align="center" gap="xs"><div ref={setToolbarLastRef} /></Panel>
                </Panel>
                <Panel flex={1} overflow="hidden">
                    <LinkEditor model={bookmarks.textModel} toolbarRefFirst={toolbarFirstRef} toolbarRefLast={toolbarLastRef} />
                </Panel>
            </Panel>
        );
    }
    ```

    `data-blank-toolbar=""` activates the injected hide rules for `.link-btn-add` / `.link-btn-browser-selector`. Inner refs stay as plain `<div>`s — `LinkEditor` `ReactDOM.createPortal`s into them.

14. **`BrowserWebviewItem` subcomponent** — replace `<div className="webview-wrapper">` with:

    ```tsx
    <div data-webview-wrapper>
        <webview
            ref={webviewRef as any}
            src={initialUrl.current}
            style={{
                backgroundColor: !tab.url || tab.url === "about:blank" ? color.background.default : "#ffffff",
            }}
            partition={partition}
            preload={WEBVIEW_PRELOAD_URL}
            // @ts-expect-error -- webview boolean attribute not in React types
            allowpopups="true"
        />
    </div>
    ```

    `BrowserRoot`'s `[data-webview-wrapper]` rule handles positioning + descendant `<webview>` flex sizing. Only the dynamic per-tab background stays as inline style on the `<webview>` itself.

    Same pattern for `popupOpen` overlay: `<div data-webview-click-overlay />` consumes the `[data-webview-click-overlay]` rule.

15. **`UrlSuggestionsDropdown` anchor lookup** — change:

    ```tsx
    anchorEl={urlBar.urlInputRef?.closest('.url-bar') ?? null}
    // →
    anchorEl={urlBar.urlInputRef?.closest('[data-url-bar]') ?? null}
    ```

### Phase 2 — `BrowserTabsPanel.tsx`

**Imports — final state:**

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import { useFloating, offset as floatingOffset, autoUpdate } from "@floating-ui/react";
import styled from "@emotion/styled";  // retained Rule 7 exception — see BrowserTabsRoot below
import color from "../../theme/color";
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits";
import { CloseIcon, GlobeIcon, PlusIcon, VolumeIcon, VolumeMutedIcon } from "../../theme/icons";
import { BrowserEditorModel, BrowserTabData } from "./BrowserEditorModel";
import { Panel, IconButton } from "../../uikit";
import type { MenuItem } from "../../uikit/Menu";  // switch type-only import from components/overlay/PopupMenu
import { ContextMenuEvent } from "../../api/events/events";
```

Drop: `components/basic/Button`. Drop the legacy `BrowserTabsPanelRoot` styled definition (replaced by `BrowserTabsRoot` styled(Panel) below).

**Steps:**

1. **Define `BrowserTabsRoot` styled wrapper.** Holds all tab-related chrome CSS. Drives state via `data-*` attributes on plain `<div data-tab-item>` rows — no per-row React state, no inline-style state computation.

    ```ts
    // styled(Panel) wrapper — Rule 7 exception, scoped to tabs strip chrome.
    // TabItem renders plain <div data-tab-item> with data-active / data-compact /
    // data-dragging / data-drop-target / data-hover-extended attributes; CSS below
    // drives all visual states. Per-row :hover comes from CSS, not React state.
    const BrowserTabsRoot = styled(Panel)({
        "[data-tab-item]": {
            display: "flex",
            alignItems: "center",
            height: 28,
            boxSizing: "border-box",
            padding: "0 4px 0 6px",
            margin: "0 4px 0 8px",
            gap: 6,
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid transparent",
            position: "relative",
            "&::before": {
                content: '""',
                position: "absolute",
                left: -5, top: 2, bottom: 2,
                width: 2,
                borderRadius: 1,
                backgroundColor: "var(--group-color)",
            },
            "&:hover": { backgroundColor: color.background.light },
            "&[data-active]": {
                backgroundColor: color.background.dark,
                borderColor: color.border.active,
            },
            "&[data-compact]": {
                justifyContent: "center",
                padding: "0 4px",
                margin: "0 4px",
            },
            "&[data-hover-extended]": { borderRadius: "4px 0 0 4px" },
            "&[data-dragging]": { opacity: 0.4 },
            "&[data-drop-target]": { borderColor: color.border.active },

            // Per-row close-button reveal on hover (was &:hover .tab-close { opacity:1 })
            "& [data-tab-close]": {
                opacity: 0,
                transition: "opacity 80ms",
            },
            "&:hover [data-tab-close], &[data-active] [data-tab-close]": {
                opacity: 1,
            },
        },
        "[data-tab-favicon]": {
            width: 14,
            height: 14,
            flexShrink: 0,
            "& svg": {
                width: 14,
                height: 14,
                color: color.icon.default,
                "&[data-hidden]": { display: "none" },
            },
            "& img": {
                width: 14,
                height: 14,
                display: "block",
                objectFit: "contain",
                filter: "drop-shadow(0 0 1.5px rgba(255,255,255,0.9))",
            },
        },
        "[data-tab-title]": {
            flex: "1 1 auto",
            fontSize: 12,
            color: color.text.default,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        "[data-tab-extension]": {
            display: "flex",
            alignItems: "center",
            width: 140,
            height: 28,
            boxSizing: "border-box",
            padding: "0 4px 0 6px",
            gap: 6,
            borderRadius: "0 4px 4px 0",
            border: `1px solid ${color.border.default}`,
            borderLeft: "none",
            backgroundColor: color.background.light,
            "& [data-part='title']": {
                flex: "1 1 auto",
                fontSize: 12,
                color: color.text.default,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            },
            "&[data-active]": {
                backgroundColor: color.background.dark,
                borderColor: color.border.active,
                borderLeft: "none",
            },
        },
    });
    ```

2. **Root** — replace `<BrowserTabsPanelRoot>` with `<BrowserTabsRoot direction="column" overflow="hidden" background="default" height="100%">`.

3. **Tabs list** — replace `<div className="tabs-list">` with `<Panel direction="column" flex={1} overflowY="auto" overflowX="hidden">`.

4. **`TabItem`** — plain `<div data-tab-item …>` driven by `data-*` attributes. No `useState` for hover; CSS `:hover` handles it. Drop the `isLocalHover` state introduced in the earlier draft entirely.

    ```tsx
    function TabItem({ tab, model, isActive, compact, showClose, isHovered, groupColorIndex,
                      onSwitch, onClose, onToggleMute, onContextMenu, onMouseEnter, onMouseLeave }: TabItemProps) {
        const [isDragging, setIsDragging] = useState(false);
        const [isOver, setIsOver] = useState(false);
        const dragEnterCount = useRef(0);

        // ... drag handlers unchanged (existing useCallbacks) ...

        const groupBorderColor = GROUP_COLORS[groupColorIndex % GROUP_COLORS.length];

        return (
            <div
                draggable
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-tab-item
                data-active={isActive || undefined}
                data-compact={compact || undefined}
                data-dragging={isDragging || undefined}
                data-drop-target={isOver || undefined}
                data-hover-extended={isHovered || undefined}
                style={{ "--group-color": groupBorderColor } as React.CSSProperties}
                onClick={() => onSwitch(tab.id)}
                onContextMenu={(e) => onContextMenu(e, tab.id)}
                onMouseEnter={onMouseEnter ? (e) => onMouseEnter(e, tab.id) : undefined}
                onMouseLeave={onMouseLeave}
            >
                <div data-tab-favicon>
                    {tab.favicon ? (
                        <img
                            src={tab.favicon}
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                                (e.target as HTMLImageElement).nextElementSibling?.setAttribute("data-hidden", "");
                            }}
                        />
                    ) : null}
                    <GlobeIcon data-hidden={tab.favicon ? "" : undefined} />
                </div>
                {!compact && <div data-tab-title>{tab.pageTitle || tab.url || "New Tab"}</div>}
                {!compact && (tab.audible || tab.muted) && (
                    <IconButton size="sm" icon={tab.muted ? <VolumeMutedIcon /> : <VolumeIcon />} title={tab.muted ? "Unmute Tab" : "Mute Tab"} onClick={(e) => onToggleMute(e, tab.id)} />
                )}
                {showClose && (
                    <IconButton data-tab-close size="sm" icon={<CloseIcon />} title="Close Tab" onClick={(e) => onClose(e, tab.id)} />
                )}
            </div>
        );
    }
    ```

    `IconButton` extends HTMLAttributes so `data-tab-close` passes through via `{...rest}`. The `[data-tab-item] [data-tab-close] { opacity:0 }` + `[data-tab-item]:hover [data-tab-close] { opacity:1 }` rules in `BrowserTabsRoot` handle the reveal — no wrapping `<div>` needed.

    The `::before` group-color stripe stays as a pseudo-element driven by the `--group-color` CSS custom property set via inline `style`. ✓

5. **Add-tab button** — replace `<div className={\`add-tab-button${compact ? " compact" : ""}\`}>` + Button with `<Panel direction="row" align="center" paddingX="xs" height={28} justify={compact ? "center" : "start"}> <IconButton size="sm" icon={<PlusIcon />} title="New Tab" onClick={handleNewTab} /> </Panel>`.

6. **Tab-extension floating panel** — keep `useFloating` setup. Replace `<div ref={refs.setFloating} className={…} style={…}>` with:

    ```tsx
    <div
        ref={refs.setFloating}
        data-tab-extension
        data-active={hoveredTabId === activeTabId || undefined}
        style={{ ...floatingStyles, zIndex: 1000 }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onClick={() => handleSwitchTab(hoveredTabId!)}
    >
        <span data-part="title">{hoveredTab.pageTitle || hoveredTab.url || "New Tab"}</span>
        {(hoveredTab.audible || hoveredTab.muted) && (
            <IconButton size="sm" icon={hoveredTab.muted ? <VolumeMutedIcon /> : <VolumeIcon />} title={hoveredTab.muted ? "Unmute Tab" : "Mute Tab"} onClick={(e) => handleToggleMute(e, hoveredTabId!)} />
        )}
        <IconButton size="sm" icon={<CloseIcon />} title="Close Tab" onClick={(e) => handleExtensionClose(e, hoveredTabId!)} />
    </div>
    ```

    `useFloating` doesn't portal — the floating element is rendered inside `BrowserTabsRoot`, so `[data-tab-extension]` descendant selectors reach it. ✓ Only `floatingStyles` (top/left from floating-ui) + `zIndex` stay as inline style — those are dynamic per-frame and can't move into CSS.

### Phase 3 — `BookmarksDrawer.tsx`

**Imports — final state:**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";  // retained Rule 7 exception — see BookmarksDrawerRoot below
import { Panel, Splitter } from "../../uikit";
import { LinkEditor } from "../link-editor/LinkEditor";
import { BrowserBookmarks } from "./BrowserBookmarks";
```

Drop: `clsx`, `theme/color`, `components/layout/Splitter`. Drop the legacy `BookmarksDrawerRoot` styled.div (replaced by `BookmarksDrawerRoot` styled(Panel) below — same name, new implementation).

**Steps:**

1. **Define `BookmarksDrawerRoot` styled wrapper.** Holds backdrop and slide-in animation CSS. The animation is driven by a `data-open` attribute on the root (set from the existing `isAnimating` React state).

    ```ts
    // styled(Panel) wrapper — Rule 7 exception, scoped to drawer chrome.
    // Slide-in animation: backdrop fades in via opacity (optional), panel-wrap
    // slides from translateX(100%) to translateX(0) when [data-open] is set.
    const BookmarksDrawerRoot = styled(Panel)({
        "[data-bookmarks-backdrop]": {
            flex: "1 1 auto",
            backgroundColor: "rgba(0, 0, 0, 0.3)",
        },
        "[data-bookmarks-panel-wrap]": {
            height: "100%",
            transform: "translateX(100%)",
            transition: "transform 80ms ease-in-out",
        },
        "&[data-open] [data-bookmarks-panel-wrap]": {
            transform: "translateX(0)",
        },
    });
    ```

2. **Root** — replace `<BookmarksDrawerRoot ref={rootRef} className={…} onKeyDown={handleKeyDown} tabIndex={-1}>` with:

    ```tsx
    <BookmarksDrawerRoot
        ref={rootRef}
        position="absolute" top={0} right={0} bottom={0} left={0} zIndex={6}
        direction="row"
        data-open={isAnimating || undefined}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
    >
    ```

    Conditional `if (!open) return null;` stays.

3. **Backdrop** — replace `<div className="bookmarks-backdrop" onClick={onClose} />` with:

    ```tsx
    <div data-bookmarks-backdrop onClick={onClose} />
    ```

4. **Splitter** — replace legacy `<Splitter type="vertical" initialWidth={width} onChangeWidth={onChangeWidth} borderSized="left" />` with UIKit:

    ```tsx
    <Splitter
        orientation="vertical"
        value={width}
        onChange={onChangeWidth}
        side="after"
        background="default"
        hoverBackground="light"
        border="none"
    />
    ```

    `side="after"` matches `borderSized="left"` direction math (drag-right shrinks, drag-left grows the right panel).

5. **Bookmarks panel + slide-in animation** — wrap the Panel in a `<div data-bookmarks-panel-wrap>`. The wrapper's transform is driven by `BookmarksDrawerRoot`'s `&[data-open] [data-bookmarks-panel-wrap] { transform: translateX(0) }` rule. No inline-style animation needed.

    ```tsx
    <div data-bookmarks-panel-wrap style={{ width, maxWidth: "90%" }}>
        <Panel ref={panelRef} direction="column" background="default" borderLeft height="100%" overflow="hidden">
            {/* toolbar / editor / footer — see step 6 */}
        </Panel>
    </div>
    ```

    Only `width` and `maxWidth` stay as inline style (dynamic via the splitter); animation is pure CSS.

6. **Toolbar / footer / editor container**:

    ```tsx
    <Panel direction="row" align="center" gap="xs" paddingX="md" paddingY="xs" background="dark" borderBottom shrink={false} minHeight={32}>
        <Panel direction="row" align="center" gap="xs"><div ref={setToolbarFirstRef} /></Panel>
        <Panel flex={1} />
        <Panel direction="row" align="center" gap="xs"><div ref={setToolbarLastRef} /></Panel>
    </Panel>
    <Panel flex={1} overflow="hidden">
        <LinkEditor model={bookmarks.textModel} swapLayout toolbarRefFirst={toolbarFirstRef} toolbarRefLast={toolbarLastRef} footerRefLast={footerLastRef} />
    </Panel>
    <Panel direction="row" align="center" gap="xs" paddingX="md" paddingY="xs" background="dark" borderTop shrink={false} minHeight={22}>
        <Panel direction="row" align="center" gap="xs"><div ref={setFooterLastRef} /></Panel>
    </Panel>
    ```

    Drop legacy `fontSize: 11; color: color.text.light` on the footer — LinkEditor footer content carries its own typography.

### Phase 4 — Validation

1. `npx tsc --noEmit` — fix any new TS errors (chrome refactor may flip `Panel` flex math; resolve case by case).
2. `npm run lint` — no new warnings.
3. **Manual smoke** (see [Test surface](#test-surface-manual-smoke)).
4. Visual diff vs. pre-migration: tabs panel border-right and main splitter occupy adjacent 1px+6px instead of 6px-overlay; the webview-area starts 6px further right. Verify the tabs default width is still visually appropriate; bump `BrowserEditorModel.defaultTabsPanelWidth` by 6 if a side-by-side comparison shows a regression.

## Concerns

### C1 — Main splitter chrome shift (absolute → inline flex) `[recommendation: accept]`

The legacy splitter is `position: absolute; left: tabsPanelWidth` overlaying the right 6px of the tabs panel. Migration to inline flex means the splitter occupies its own 6px in the row, shifting `webview-area` 6px right. Functionally identical resize behavior. Visually a 6px shift in the splitter seam location, which the user will notice in a side-by-side compare but not in normal use.

**Recommendation: accept the inline-flex layout.** Cleaner, no inline-style hacks on UIKit Splitter. If the user pushes back during manual smoke, fall back to a wrapping plain `<div style={{ position:"absolute", left: tabsPanelWidth, top:0, bottom:0, zIndex:2 }}>` around the UIKit Splitter — that's allowed because the wrapper is plain DOM, but the Splitter itself remains a UIKit primitive.

### C2 — UrlSuggestionsDropdown anchor lookup `[recommendation: accept]`

`urlBar.urlInputRef?.closest('.url-bar')` won't find the legacy wrapper className. **Resolution: add `data-url-bar=""` to the wrapping `Panel` and change the lookup to `closest('[data-url-bar]')`.** Single-line change in BrowserEditorView.

### C3 — Search-engine-btn chip `[recommendation: plain <button data-search-engine-chip>]`

A clickable chip showing the current search engine (e.g. "Google ▾"). Legacy CSS uses `fontSize: 11; padding: 0 4px; lineHeight: 20px`. UIKit Button size="sm" is 24px tall with 8px horizontal padding — doesn't match. **Resolution: render as a plain `<button data-search-engine-chip>`; styling (including `:hover`) lives in `BrowserRoot`'s `[data-search-engine-chip]` rule.** No React state, no inline style, ~5 lines of JSX.

### C4 — Tor status dot positioning `[recommendation: data-attribute + BrowserRoot rule]`

UIKit Dot has no absolute-position prop. **Resolution: wrap `<Dot size={6} color={…} />` in `<span data-tor-status-dot>`; `BrowserRoot`'s `[data-tor-status-dot] { position:absolute; bottom:0; right:0 }` rule handles positioning.** The parent `.tor-indicator` becomes `<span data-tor-indicator>` consumed by `[data-tor-indicator] { position:relative; … }` in `BrowserRoot`.

### C5 — Loading-bar pulse keyframes `[recommendation: BrowserRoot styled(Panel)]`

`@keyframes loading-pulse` lives inside `BrowserRoot`'s `styled(Panel)` definition along with the `[data-browser-loading-bar] { animation: browser-loading-pulse … }` rule. Apply via plain `<div data-browser-loading-bar />`. No injected `<style>` tag; no `useEffect` for injection. Emotion handles the keyframe block + scopes the class automatically.

### C6 — Blank-page-toolbar hide rules `[recommendation: BrowserRoot styled(Panel)]`

Legacy hides `.link-btn-add` and `.link-btn-browser-selector` (classes injected by `LinkEditor` into the portal target). **Resolution: include `[data-blank-toolbar] .link-btn-add { display: none } [data-blank-toolbar] .link-btn-browser-selector { display: none }` in `BrowserRoot`'s styled(Panel) definition.** Add `data-blank-toolbar=""` to the wrapping Panel in `BlankPageLinks`. Same single styled wrapper as C5.

### C7 — Bookmarks drawer slide-in animation `[recommendation: BookmarksDrawerRoot styled(Panel) + data-open]`

The drawer renders inside `BookmarksDrawer.tsx`, not `BrowserEditorView.tsx`. **Resolution: file-local `BookmarksDrawerRoot = styled(Panel)({...})` with `[data-bookmarks-panel-wrap] { transform: translateX(100%); transition: transform 80ms ease-in-out }` and `&[data-open] [data-bookmarks-panel-wrap] { transform: translateX(0) }`.** Trigger via `data-open={isAnimating || undefined}` on the styled root. No inline-style animation; no wrapping `<div>` carrying transform.

### C8 — Bookmarks drawer backdrop tint `[recommendation: BookmarksDrawerRoot styled(Panel)]`

Legacy uses `rgba(0, 0, 0, 0.3)`. Panel `background="overlay"` resolves to `color.background.overlay`, which is a theme-defined token (may not be 30% black on light themes). **Resolution: `[data-bookmarks-backdrop] { flex: 1; background-color: rgba(0,0,0,0.3) }` rule inside `BookmarksDrawerRoot`.** Plain `<div data-bookmarks-backdrop onClick={onClose} />` in JSX.

Optional follow-up: add `color.background.scrim` to the palette so a future drawer/modal primitive can use the token. Out of scope here.

### C9 — Compact-mode tab hover-extension `[recommendation: keep useFloating + data-tab-extension]`

The extension renders a 140px-wide floating panel to the right of a hovered compact tab, with mouse-enter cancelling close. Behavior is bespoke. **Resolution: keep the `useFloating` setup; render the extension as `<div ref={refs.setFloating} data-tab-extension data-active={…} style={{...floatingStyles, zIndex:1000}}>`.** Layout chrome (width 140, height 28, borderRadius "0 4px 4px 0", border, backgrounds for default vs active) lives in `BrowserTabsRoot`'s `[data-tab-extension]` rule. Only `floatingStyles` (top/left from floating-ui per frame) + `zIndex` stay as inline style.

### C10 — Tab item compound state `[recommendation: data-* attributes + BrowserTabsRoot]`

The .tab-item has many stateful styles (hover, active, dragging, drop-target, hover-extended, group-color stripe). **Resolution: render plain `<div data-tab-item data-active={…} data-compact={…} data-dragging={…} data-drop-target={…} data-hover-extended={…} style={{"--group-color":…}}>`. All visual rules live in `BrowserTabsRoot`'s `[data-tab-item]` block** (base layout, `&:hover`, `&[data-active]`, `&[data-compact]`, `&[data-dragging]`, `&[data-drop-target]`, `&[data-hover-extended]`, `&::before` group stripe). No `useState` for per-row hover — CSS `:hover` works.

### C11 — Per-row close-button reveal `[recommendation: descendant selector in BrowserTabsRoot]`

Legacy `&:hover .tab-close { opacity: 1 }` was scoped to one row. **Resolution: rules in `BrowserTabsRoot`:**

```ts
"[data-tab-item] [data-tab-close]": { opacity: 0, transition: "opacity 80ms" },
"[data-tab-item]:hover [data-tab-close], [data-tab-item][data-active] [data-tab-close]": { opacity: 1 },
```

Render the close button as `<IconButton data-tab-close size="sm" …>`. IconButton extends `HTMLAttributes` so `data-tab-close` passes through via `{...rest}`. No wrapping `<div>`, no React state.

### C12 — `MenuItem` type import path `[recommendation: switch to UIKit]`

`BrowserTabsPanel.tsx` imports `type { MenuItem } from "../../components/overlay/PopupMenu"`. UIKit `Menu/types.ts` re-exports the same canonical `MenuItem`. **Resolution: switch the type-only import to `import type { MenuItem } from "../../uikit/Menu";`.** Mechanical — same type shape.

## Acceptance criteria

- [ ] Each in-scope file has **at most one** `styled(Panel)` definition (`BrowserRoot`, `BrowserTabsRoot`, `BookmarksDrawerRoot`), each documented as a Rule 7 exception scoped to that file's chrome.
- [ ] Every chrome-bearing UIKit primitive (per [Debug naming](#debug-naming-name-prop)) carries a meaningful `name` prop — spot-check in DevTools that key elements (`browser-root`, `url-input`, `toolbar-back`, `tabs-webview-splitter`, `browser-tabs-root`, `bookmarks-drawer-root`, etc.) are distinguishable by `data-name`.
- [ ] No `styled.div` / `styled.span` / other `styled.*` in any in-scope file — only `styled(Panel)`.
- [ ] No imports from `components/basic|form|layout|overlay/` in those three files (UIKit `MenuItem` is canonical).
- [ ] No injected `<style>` tags; no `useEffect`-driven CSS injection.
- [ ] Per-row hover state is CSS-driven (no `useState` for visual hover in `TabItem` or `SearchEngineChip`).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (Test surface) passes.
- [ ] `UrlSuggestionsDropdown` still anchors to the URL bar wrapper via `[data-url-bar]`.
- [ ] `DownloadButton`, `BrowserDownloadsPopup`, `TorStatusOverlay` render unchanged.
- [ ] Loading bar pulses while loading; 2px placeholder reserves the strip when idle.
- [ ] Tab right-click context menu items appear via the `ContextMenuEvent.items` pattern.
- [ ] Compact-mode tab hover-extension appears to the right of the hovered tab; mouse-leave closes after 100ms.
- [ ] Bookmarks drawer slides in from the right; splitter resizes width; backdrop click closes; Escape closes.
- [ ] `BlankPageLinks` renders `LinkEditor` toolbar with `.link-btn-add` and `.link-btn-browser-selector` hidden.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at EPIC-025 close per the epic's deferred review model.

## Test surface (manual smoke)

- Open the built-in browser: URL bar, tabs strip, webview render. Tab key flows through toolbar buttons cleanly.
- Type a URL and press Enter: navigation works; loading bar pulses; placeholder appears when idle.
- Open a new tab; close a tab; right-click a tab → "Close Tab", "Close Other Tabs", "Close Tabs Below" appear and work.
- Drag a tab over another tab: drop-target highlight appears; drop reorders.
- Narrow the tabs panel below ~70px → compact mode; hover a compact tab → extension appears with title + close button.
- Toggle bookmarks drawer (Star icon): drawer slides in; splitter resizes; backdrop click closes; Escape closes.
- Add / remove a bookmark via the Star button: state persists across reload.
- Click a bookmark in the drawer: navigates active tab.
- Find-bar opens on Ctrl+F (host unchanged).
- Downloads button (US-463) and Tor overlay (US-462) render through unchanged portal targets.
- Open Tor browser session: Tor icon + status dot appear in URL bar start slot; click → Tor overlay opens.
- Incognito session: incognito icon appears in URL bar start slot.
- Search-engine chip: clicking opens engine menu; selecting an engine updates the chip label.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/browser/BrowserEditorView.tsx` | full migration; legacy `BrowserEditorViewRoot` (styled.div) replaced by `BrowserRoot = styled(Panel)({...})` (Rule 7 exception) holding loading-bar keyframes, search-engine chip, Tor indicator + status dot, webview wrapper + click overlay, blank-toolbar hide rules; toolbar/URL bar/popup-blocked bar/body migrated to UIKit |
| `src/renderer/editors/browser/BrowserTabsPanel.tsx` | full migration; legacy `BrowserTabsPanelRoot` (styled.div) replaced by `BrowserTabsRoot = styled(Panel)({...})` (Rule 7 exception) holding tab-item compound state (`data-*` attributes drive hover/active/dragging/drop-target/hover-extended/group-color/close-reveal), favicon, title, tab-extension floating panel; tabs list + add-tab migrated to UIKit; switch `MenuItem` import to UIKit; **no per-row `useState`** |
| `src/renderer/editors/browser/BookmarksDrawer.tsx` | full migration; legacy `BookmarksDrawerRoot` (styled.div) replaced by `BookmarksDrawerRoot = styled(Panel)({...})` (Rule 7 exception) holding backdrop tint + slide-in animation via `&[data-open] [data-bookmarks-panel-wrap]` rule; splitter migrated to UIKit |

## Dependencies

All shipped (marked `[ ]` pending epic-close review):

- **US-471** UIKit Input start/end slots
- **US-481** UIKit Menu / WithMenu
- **US-486** UIKit Splitter

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related (split-out browser surfaces):
  [US-461 FindBar](../US-461-shared-findbar-consolidation/README.md),
  [US-462 TorStatusOverlay](../US-462-tor-status-overlay-migration/README.md),
  [US-463 BrowserDownloadsPopup](../US-463-browser-downloads-migration/README.md),
  [US-464 UrlSuggestionsDropdown](../US-464-url-suggestions-dropdown-migration/README.md)
- Precedent for retained `styled(Panel)` Rule 7 exception: [US-514](../US-514-video-audio-player-migration/README.md) (VPlayer.tsx for video.js descendant CSS)
