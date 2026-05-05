# US-478: PageTabs / PageTab — UIKit migration

## Goal

Migrate `src/renderer/ui/tabs/PageTabs.tsx` and `src/renderer/ui/tabs/PageTab.tsx` (the top tab strip rendered on every Persephone window) so that:

1. All **reusable primitives** they render — buttons, icon buttons, tooltips — come from UIKit (`src/renderer/uikit/`), not from `src/renderer/components/basic/`.
2. All conditional UI state is expressed via `data-*` attributes (UIKit Rule 1), not CSS class names.
3. The two files **stay in `src/renderer/ui/tabs/`** — they are application chrome unique to Persephone, not reusable primitives. They keep their own local `@emotion/styled` for the tab-strip / tab-body chrome layout (rounded top corners, sticky pinned positioning, scroll wrapper, split-button wrapper, etc.). See **Concern #1** for the policy decision behind this.

After this task: legacy `Button`, `Tooltip`, `WithPopupMenu`, `clsx` className-driven state, and `data-tooltip-id` linking are gone from these two files. The two files no longer import from `components/basic/` or `components/overlay/`. The legacy `WithPopupMenu`/`PopupMenu` files themselves stay in the codebase for other (yet-to-be-migrated) consumers — US-483 will sweep and delete them.

## Background

### Files in scope

- `src/renderer/ui/tabs/PageTabs.tsx` — the top tab strip. Renders scroll-arrows (`Button` icon-only), the scrolling row of `<PageTab>`s, and the split add-page button (Plus + ChevronDown).
- `src/renderer/ui/tabs/PageTab.tsx` — a single tab. Renders language-picker `Button` (icon-only), title label (with `data-tooltip-id` pointing at a portaled `<Tooltip>`), optional encryption-icon span, optional sound `Button` (icon-only), close `Button` (icon-only) holding both `CloseIcon`/`GroupIcon` and a `CircleIcon` modified-dot whose visibility flips via CSS class state. Drag-and-drop, context menu, tooltip wiring, and pinned-tab sticky positioning all live here.
- `src/renderer/ui/tabs/index.ts` — exports `{ PageTabs, PageTab, minTabWidth }`. Stays unchanged in shape.

### Where these files are consumed

- `PageTabs` → `src/renderer/ui/app/MainPage.tsx` only.
- `PageTab` → `PageTabs.tsx` only.
- `pinnedTabWidth`, `pinnedTabEncryptedWidth` → only inside `PageTabs.tsx` (so they need to stay exported from `PageTab.tsx` as today, but are not part of any external API surface).

### Legacy primitives currently used (to be replaced)

- `import { Button } from "../../components/basic/Button"` → UIKit `Button` (text+icon use cases) / `IconButton` (icon-only use cases).
- `import { Tooltip } from "../../components/basic/Tooltip"` → UIKit `Tooltip` (wrap-the-trigger pattern, no `data-tooltip-id` linking).
- `import clsx from "clsx"` → removed; replaced by `data-*` attributes.
- `import { WithPopupMenu } from "../../components/overlay/WithPopupMenu"` → UIKit `WithMenu` (US-481, drop-in render-prop API, same default offset `[-4, 4]`).
- `import { MenuItem } from "../../components/overlay/PopupMenu"` → `import type { MenuItem } from "../../uikit"` (re-exported from the canonical `api/types/events.d.ts` shape; legacy and UIKit see the same type).

### UIKit primitives available today (relevant subset)

- `Button` (`src/renderer/uikit/Button/Button.tsx`) — `variant`, `size: "sm" | "md"`, `icon`, `background: "default" | "light" | "dark"`, `block`, `title` (auto-wraps in `<Tooltip>`). **Forbids `style` / `className` at the type level.**
- `IconButton` (`src/renderer/uikit/IconButton/IconButton.tsx`) — `icon`, `size: "sm" | "md"`, `active`, `title` (auto-wraps in `<Tooltip>`). No `background` prop. **Forbids `style` / `className` at the type level.**
- `Tooltip` (`src/renderer/uikit/Tooltip/Tooltip.tsx`) — wraps a child element via cloneElement+ref; `content`, `placement`, `delayShow`, `delayHide`. When `content` is null/undefined/false, the trigger renders unwrapped (so a falsy `content` is the same as "no tooltip").
- `Divider` (`src/renderer/uikit/Divider/`) — supports `orientation: "vertical"`. Will replace the inline `.split-divider` 1-pixel line.
- `WithMenu` (`src/renderer/uikit/Menu/WithMenu.tsx`, US-481) — render-prop trigger pattern: `(setOpen: (anchor: Element | null) => void) => React.ReactElement`. `placement?: Placement` (default `"bottom-start"`), `offset?: [number, number]` (default `[-4, 4]` — matches legacy `WithPopupMenu`), `items: MenuItem[]`. Drop-in replacement for the two `WithPopupMenu` call sites in PageTab/PageTabs.
- `MenuItem` type (`src/renderer/uikit/Menu/types.ts`) — re-exported from `api/types/events.d.ts`. Same canonical shape as the legacy `MenuItem` from `components/overlay/PopupMenu`; no field changes.

### Legacy `Button` features actually used by these two files

| Use site | Legacy props | UIKit replacement |
|----------|--------------|-------------------|
| `PageTabs` scroll-left arrow | `size="small" background="dark"` icon-only | `IconButton size="sm"` |
| `PageTabs` scroll-right arrow | `size="small" background="dark"` icon-only | `IconButton size="sm"` |
| `PageTabs` add-page main | `size="medium" background="dark"` icon-only, custom border-radius via parent CSS | `IconButton size="sm"` *(see Concern #4 — split-button geometry)* |
| `PageTabs` add-page dropdown | `size="medium" background="dark"` icon-only, custom border-radius + minWidth via parent CSS | `IconButton size="sm"` |
| `PageTab` language picker | `size="small" type="icon" title={language}` | `IconButton size="sm" title={language}` |
| `PageTab` sound button | `size="small" type="icon" title=… background=…` + `sound-active` className | `IconButton size="sm" active={muted-or-audible} title=…` *(no `background` prop — see Concern #5)* |
| `PageTab` close button | `size="small" type="icon" title=… background=… className="close-button"` | `IconButton size="sm" title=…` with custom inline icon node *(see Concern #6)* |

### State currently expressed via class names (becomes `data-*` per Rule 1)

| Legacy class on `PageTabRoot` | New attribute |
|--------------------------------|---------------|
| `.isActive` | `data-active` |
| `.modified` | `data-modified` |
| `.isDraggOver` | `data-drag-over` |
| `.temp` | `data-temp` |
| `.deleted` | `data-deleted` |
| `.pinned` | `data-pinned` |
| `.grouped` | `data-grouped` |
| `.pinned-encrypted` | `data-pinned` + `data-has-encryption` (CSS uses `&[data-pinned][data-has-encryption]`) |
| `.empty-language.withIcon` | `data-part="empty-language"` + `data-with-icon` |
| inner `.title-label` | `data-part="title-label"` |
| inner `.encryption-icon` | `data-part="encryption-icon"` |
| inner `.modified-icon` | `data-part="modified-icon"` |
| inner `.close-icon` | `data-part="close-icon"` |
| inner `.close-button` | `data-part="close-button"` *(set by us on the IconButton via `data-part` rest prop)* |
| inner `.sound-button` | `data-part="sound-button"` |

All booleans use the present/absent convention: `data-active={isActive || undefined}` (passing `false` would still match `[data-active]`).

## Implementation plan

### Step 1 — `src/renderer/ui/tabs/PageTab.tsx` rewrite

#### 1a. Imports

**Remove:**
```ts
import clsx from "clsx";
import { Button } from "../../components/basic/Button";
import { Tooltip } from "../../components/basic/Tooltip";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import { MenuItem } from "../../components/overlay/PopupMenu";
```

**Add:**
```ts
import { IconButton, Tooltip, WithMenu } from "../../uikit";
import type { MenuItem } from "../../uikit";
```

Keep all other imports as-is (`pagesModel`, `appWindow`, `settings`, `PageModel`, icons, `LanguageIcon`, `TComponentModel`, `useComponentModel`, `ContextMenuEvent`, `monacoLanguages`, `useMemo/useState/useCallback/useRef`, traits, `api`, text-editor types, `parseObject`, `ui`, `useOptionalState`).

#### 1b. Styled root — convert state → `data-*`

Replace the current `PageTabRoot` styled block with one that uses `data-*` attribute selectors. The state-attribute selectors below replace `&.isActive`, `&.modified`, `&.isDraggOver`, `&.pinned`, etc. Visual rules stay the same.

```tsx
const PageTabRoot = styled.div(
    {
        display: "flex",
        alignItems: "center",
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        border: "1px solid transparent",
        borderBottom: "none",
        padding: "4px 2px 3px 2px",
        minHeight: 22,
        WebkitAppRegion: "no-drag",
        userSelect: "none",
        width: 200,
        minWidth: minTabWidth,
        flexShrink: 1,
        overflow: "hidden",

        '& [data-part="title-label"]': {
            flex: "1 1 auto",
            fontSize: 13,
            color: color.text.light,
            flexShrink: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        '&[data-temp] [data-part="title-label"]': {
            fontStyle: "italic",
        },
        '&[data-deleted] [data-part="title-label"]': {
            color: color.misc.red,
        },
        '&[data-deleted] [data-part="modified-icon"]': {
            color: color.misc.red,
        },

        '& [data-part="close-button"]': {
            flexShrink: 0,
            visibility: "hidden",
        },
        '& [data-part="sound-button"]': {
            flexShrink: 0,
            visibility: "hidden",
        },
        '& [data-part="sound-button"][data-active]': {
            visibility: "visible",
        },

        "&[data-active]": {
            backgroundColor: color.background.default,
            borderColor: color.border.default,
            color: color.text.default,
            '&:not([data-deleted]) [data-part="title-label"]': {
                color: color.text.default,
            },
            '& [data-part="close-button"]': {
                visibility: "visible",
            },
        },
        "&:hover": {
            borderColor: color.border.default,
            '& [data-part="close-button"]': {
                visibility: "visible",
            },
            '& [data-part="sound-button"]': {
                visibility: "visible",
            },
        },
        "&[data-drag-over]": {
            backgroundColor: color.background.default,
        },
        '& [data-part="modified-icon"]': {
            display: "none",
        },
        '&[data-modified] [data-part="close-button"]': {
            visibility: "visible",
        },
        "&[data-modified]:not(:hover)": {
            '& [data-part="modified-icon"]': {
                display: "inline-block",
            },
            '& [data-part="close-icon"]': {
                display: "none",
            },
        },
        '& [data-part="encryption-icon"]': {
            paddingBottom: 4,
            marginRight: 2,
        },
        '& [data-part="empty-language"]': {
            width: 6,
            height: 14,
            flexShrink: 0,
        },
        '& [data-part="empty-language"][data-with-icon]': {
            width: 15,
            margin: "0 4px 0 4px",
            "& svg, & img": {
                width: 15,
                height: 15,
            },
        },
        "&:not([data-active]) > button": {
            cursor: "default",
        },

        "&[data-pinned]": {
            width: pinnedTabWidth,
            minWidth: pinnedTabWidth,
            flexShrink: 0,
            position: "sticky",
            zIndex: 1,
            backgroundColor: color.background.dark,
            "&[data-active], &[data-drag-over]": {
                backgroundColor: color.background.default,
            },
            '& [data-part="title-label"]': {
                flex: "0 0 auto",
            },
            '& [data-part="close-button"]': {
                visibility: "visible",
                pointerEvents: "none",
            },
            '& [data-part="close-icon"]': {
                display: "none",
            },
        },
        '&[data-pinned][data-grouped] [data-part="close-button"]': {
            pointerEvents: "auto",
        },
        '&[data-pinned][data-grouped] [data-part="close-icon"]': {
            display: "inline-block",
        },
        '&[data-pinned][data-modified] [data-part="modified-icon"]': {
            display: "inline-block",
        },
        "&[data-pinned][data-has-encryption]": {
            width: pinnedTabEncryptedWidth,
            minWidth: pinnedTabEncryptedWidth,
        },

        '& [data-part="pinned-tooltip-trigger"]': {
            position: "absolute",
            inset: 0,
        },
        '&[data-pinned] > *:not([data-part="pinned-tooltip-trigger"])': {
            position: "relative",
            zIndex: 1,
        },
    },
    { label: "PageTabRoot" },
);
```

The constants `minTabWidth`, `pinnedTabWidth`, `pinnedTabEncryptedWidth` and the imports for `color` stay exactly where they are today.

#### 1c. Component body — replace `Button` with `IconButton`, drop `clsx`, drop `data-tooltip-id`

The model class (`PageTabModel`), the `useOptionalState` hook call, the drag/drop ref counter, and the menu-item builders all stay as they are. Only the JSX returned by `PageTab(props)` changes.

Replace the legacy return JSX:

```tsx
// BEFORE — current line 602-710
return (
    <PageTabRoot
        className={clsx("page-tab", { isActive: tabModel.isActive, modified, isDraggOver: isOver, temp, deleted, pinned, grouped: tabModel.isGrouped, "pinned-encrypted": isPinnedEncrypted })}
        style={pinned && props.pinnedLeft !== undefined ? { left: props.pinnedLeft } : undefined}
        onClick={tabModel.handleClick}
        onContextMenu={tabModel.handleContextMenu}
        draggable
        onDragStart={tabModel.handleDragStart}
        onDragEnd={tabModel.handleDragEnd}
        onDrop={tabModel.handleDrop}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
    >
        {pinned && filePath && (<span className="pinned-tooltip-trigger" data-tooltip-id={id} />)}
        {editor?.noLanguage ? (
            <span className={clsx("empty-language", { withIcon: editor.getIcon })}>
                {editor.getIcon ? editor.getIcon() : null}
            </span>
        ) : (
            <WithPopupMenu items={languageMenuItems}>
                {(setOpen) => (
                    <Button size="small" type="icon" onClick={…} title={language}>
                        <LanguageIcon language={language} fileName={title} />
                    </Button>
                )}
            </WithPopupMenu>
        )}
        <span className="title-label" data-tooltip-id={pinned ? undefined : id}>
            {(encrypted || decrypted) && (
                <span className="encryption-icon" onClick={…} title={…}>
                    {encrypted ? "🔒" : "🔓"}
                </span>
            )}
            {!pinned && title}
        </span>
        {(_anyTabAudible || _pageMuted || (editor as any)?.toggleMuteAll) && (
            <Button size="small" type="icon" className={clsx("sound-button", { "sound-active": _anyTabAudible || _pageMuted })} onClick={…} title={…} background={tabModel.isActive ? "default" : "dark"}>
                {_pageMuted ? <VolumeMutedIcon /> : <VolumeIcon />}
            </Button>
        )}
        <Button size="small" type="icon" onClick={tabModel.closeClick} title={…} className="close-button" background={tabModel.isActive ? "default" : "dark"}>
            {tabModel.isGrouped ? (<GroupIcon className="close-icon" />) : (<CloseIcon className="close-icon" />)}
            <CircleIcon className="modified-icon" />
        </Button>
        {filePath && (<Tooltip id={id} place="bottom" delayShow={1500}>{filePath}</Tooltip>)}
    </PageTabRoot>
);
```

with:

```tsx
// AFTER
const hasEncryption = Boolean(encrypted || decrypted);
const showSoundButton = _anyTabAudible || _pageMuted || (editor as any)?.toggleMuteAll;
const closeIcon = tabModel.isGrouped
    ? <GroupIcon data-part="close-icon" />
    : <CloseIcon data-part="close-icon" />;

return (
    <PageTabRoot
        data-type="page-tab"
        data-active={tabModel.isActive || undefined}
        data-modified={modified || undefined}
        data-drag-over={isOver || undefined}
        data-temp={temp || undefined}
        data-deleted={deleted || undefined}
        data-pinned={pinned || undefined}
        data-grouped={tabModel.isGrouped || undefined}
        data-has-encryption={hasEncryption || undefined}
        style={pinned && props.pinnedLeft !== undefined ? { left: props.pinnedLeft } : undefined}
        onClick={tabModel.handleClick}
        onContextMenu={tabModel.handleContextMenu}
        draggable
        onDragStart={tabModel.handleDragStart}
        onDragEnd={tabModel.handleDragEnd}
        onDrop={tabModel.handleDrop}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
    >
        {pinned && filePath && (
            <Tooltip content={filePath} placement="bottom" delayShow={1500}>
                <span data-part="pinned-tooltip-trigger" />
            </Tooltip>
        )}
        {editor?.noLanguage ? (
            <span data-part="empty-language" data-with-icon={editor.getIcon ? "" : undefined}>
                {editor.getIcon ? editor.getIcon() : null}
            </span>
        ) : (
            <WithMenu items={languageMenuItems}>
                {(setOpen) => (
                    <IconButton
                        size="sm"
                        title={language}
                        icon={<LanguageIcon language={language} fileName={title} />}
                        onClick={(e) => {
                            if (!tabModel.isActive && e.ctrlKey) {
                                tabModel.handleClick(e);
                                return;
                            }
                            pagesModel.showPage(page.id);
                            if (tabModel.isActive) {
                                setOpen(e.currentTarget);
                            }
                        }}
                    />
                )}
            </WithMenu>
        )}
        <Tooltip
            content={!pinned && filePath ? filePath : null}
            placement="bottom"
            delayShow={1500}
        >
            <span data-part="title-label">
                {hasEncryption && (
                    <span
                        data-part="encryption-icon"
                        onClick={tabModel.encryptionClick}
                        title={encrypted ? "Decrypt File" : "Encrypt File"}
                    >
                        {encrypted ? "🔒" : "🔓"}
                    </span>
                )}
                {!pinned && title}
            </span>
        </Tooltip>
        {showSoundButton && (
            <IconButton
                size="sm"
                data-part="sound-button"
                data-active={(_anyTabAudible || _pageMuted) ? "" : undefined}
                title={_pageMuted ? "Unmute Page" : "Mute Page"}
                icon={_pageMuted ? <VolumeMutedIcon /> : <VolumeIcon />}
                onClick={(e) => {
                    e.stopPropagation();
                    (editor as any)?.toggleMuteAll?.();
                }}
            />
        )}
        <IconButton
            size="sm"
            data-part="close-button"
            title={tabModel.isGrouped ? "Ungroup" : "Close Page"}
            icon={
                <>
                    {closeIcon}
                    <CircleIcon data-part="modified-icon" />
                </>
            }
            onClick={tabModel.closeClick}
        />
    </PageTabRoot>
);
```

Notes:
- The legacy `id = useMemo(crypto.randomUUID)` is no longer needed and **removed** — UIKit `Tooltip` does not use ID linking.
- The legacy bottom-of-component `<Tooltip id={id} place="bottom" delayShow={1500}>{filePath}</Tooltip>` block is **removed** — replaced by the two inline `<Tooltip>` wrappers above.
- `data-part="sound-button"` and `data-part="close-button"` are passed through `IconButton` via the `...rest` spread (the prop-types `Omit<…, "title">` keeps `data-*` attributes valid since they are HTMLAttributes). UIKit `IconButton` already sets its own `data-type="icon-button"` and `data-active`; our `data-part` and our `data-active` (on sound) co-exist on the same element. **Sub-concern:** UIKit `IconButton` sets `data-active={active || undefined}` from its own `active` prop. Since we want the same semantic ("active = highlight icon") we use the IconButton `active` prop instead of writing `data-active` ourselves on the sound button:

  ```tsx
  <IconButton
      size="sm"
      data-part="sound-button"
      active={(_anyTabAudible || _pageMuted) || undefined}
      title={…}
      icon={…}
      onClick={…}
  />
  ```

  This way the sound button's "active" gets UIKit's icon-active color (`color.icon.active`) for free, and the `[data-part="sound-button"][data-active]` selector in the styled root still matches because UIKit writes `data-active="" ` on the underlying button. Use this form.
- `useMemo` import becomes single-use (only `getLanguageMenuItems`'s `useMemo` callsite). The line `const id = useMemo(() => crypto.randomUUID(), []);` is gone.

#### 1d. Imports cleanup checklist

After 1a–1c, the resulting file:
- ✅ no `import clsx from "clsx"`
- ✅ no `import { Button } from "../../components/basic/Button"`
- ✅ no `import { Tooltip } from "../../components/basic/Tooltip"`
- ✅ no `import { WithPopupMenu } from "../../components/overlay/WithPopupMenu"`
- ✅ no `import { MenuItem } from "../../components/overlay/PopupMenu"`
- ✅ adds `import { IconButton, Tooltip, WithMenu } from "../../uikit"` and `import type { MenuItem } from "../../uikit"`
- ✅ keeps `import styled from "@emotion/styled"` — local Emotion for the chrome layout (per Concern #1 resolution)
- ✅ keeps everything else

### Step 2 — `src/renderer/ui/tabs/PageTabs.tsx` rewrite

#### 2a. Imports

**Remove:**
```ts
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import { MenuItem } from "../../components/overlay/PopupMenu";
```

**Add:**
```ts
import { IconButton, Divider, WithMenu } from "../../uikit";
import type { MenuItem } from "../../uikit";
```

`MenuItem` is used at line 169 as the return type of the `addPageMenuItems` useMemo. The shape is identical (re-exported from `api/types/events.d.ts`), so no body changes are needed.

Keep `import styled from "@emotion/styled"` and all other imports.

#### 2b. Styled root — convert nested className selectors

The `& .tabs-wrapper`, `& .add-page-split` selectors stay (those classes are on plain `<div>`s and will keep their classNames inside this file — the Rule 7 "no className on UIKit components" doesn't apply because these classNames are on local `<div>`s, not on UIKit components). The descendant `& button` selectors that targeted legacy `<Button>` need to be retargeted at UIKit `IconButton` instead. The simplest and most stable selector is `& [data-type="icon-button"]`.

```tsx
const PageTabsRoot = styled.div(
    {
        display: "flex",
        alignItems: "center",
        alignSelf: "flex-end",
        columnGap: 2,
        paddingTop: 6,
        overflow: "hidden",
        marginLeft: 4,
        "& .tabs-wrapper": {
            display: "flex",
            alignItems: "center",
            columnGap: 2,
            overflowX: "auto",
            overflowY: "hidden",
            scrollBehavior: "smooth",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": {
                display: "none",
            },
        },
        "& .add-page-split": {
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            height: 26,
            marginLeft: 2,
            // Treat the two IconButtons as a connected split-button:
            // left side rounded on the left, right side rounded on the right.
            '& [data-type="icon-button"]': {
                height: 26,
                borderRadius: 0,
            },
            '& [data-part="add-page-main"]': {
                borderRadius: "4px 0 0 4px",
                padding: "0 3px",
            },
            '& [data-part="add-page-dropdown"]': {
                borderRadius: "0 4px 4px 0",
                padding: "0 1px",
                minWidth: 14,
                "& svg": {
                    width: 13,
                    height: 13,
                    opacity: 0.5,
                },
                "&:hover svg": {
                    opacity: 1,
                },
            },
        },
    },
    { label: "PageTabsRoot" },
);
```

The `.split-divider` styled rule is removed — replaced by UIKit `<Divider orientation="vertical" />` which already paints a 1px line in `color.border.default`.

#### 2c. Component body — replace `Button`

Replace the JSX returned by `PageTabs(props)`:

```tsx
return (
    <PageTabsRoot data-type="page-tabs" className="page-tabs">
        {tabsState.showScrollButtons && (
            <IconButton
                size="sm"
                onClick={model.scrollLeft}
                icon={<ArrowLeftIcon />}
            />
        )}
        <div className="tabs-wrapper" ref={model.setScrollingDiv}>
            {state.pages?.map((page) => {
                let pinnedLeft: number | undefined;
                if (page.pinned) {
                    pinnedLeft = 0;
                    for (const p of state.pages) {
                        if (p === page) break;
                        if (p.pinned) {
                            const editor = p.mainEditor;
                            const isEnc = editor && isTextFileModel(editor) && (editor.encrypted || editor.decrypted);
                            pinnedLeft += (isEnc ? pinnedTabEncryptedWidth : pinnedTabWidth) + 2;
                        }
                    }
                }
                return <PageTab key={page.id} model={page} pinnedLeft={pinnedLeft} />;
            })}
        </div>
        {tabsState.showScrollButtons && (
            <IconButton
                size="sm"
                onClick={model.scrollRight}
                icon={<ArrowRightIcon />}
            />
        )}
        <div className="add-page-split">
            <IconButton
                data-part="add-page-main"
                size="sm"
                title="Add Page (Ctrl+N)"
                onClick={() => pagesModel.addEmptyPage()}
                icon={<PlusIcon />}
            />
            <Divider orientation="vertical" />
            <WithMenu items={addPageMenuItems}>
                {(setOpen) => (
                    <IconButton
                        data-part="add-page-dropdown"
                        size="sm"
                        title="New editor page"
                        onClick={(e) => setOpen(e.currentTarget)}
                        icon={<ChevronDownIcon />}
                    />
                )}
            </WithMenu>
        </div>
    </PageTabsRoot>
);
```

Notes:
- `data-type="page-tabs"` is set on the root for Rule 1.
- The `className="page-tabs"` is **kept** because it is a legacy stylesheet-of-intent class used by external CSS (search the codebase: it's referenced in `MainPage.tsx`'s region selectors). Verify with a grep before deletion. If no external consumer, remove the className. *(See Concern #7 for verification step.)*
- The `<Divider orientation="vertical" />` inside `.add-page-split` paints the same separator that was the legacy `<div className="split-divider" />`.

### Step 3 — `src/renderer/ui/tabs/index.ts`

No changes. Re-export shape stays:
```ts
export { PageTabs } from './PageTabs';
export { PageTab, minTabWidth } from './PageTab';
```

### Step 4 — Update `src/renderer/uikit/CLAUDE.md` Rule 7 *(only if Concern #1 is resolved as Path B)*

If the user agrees with Path B in Concern #1, add a carve-out paragraph to the bottom of Rule 7 documenting that one-off application chrome surfaces in `src/renderer/ui/` may keep local Emotion for layout that is not reusable. Exact wording is proposed in **Concern #1**.

If Concern #1 resolves as Path A, this step is skipped and Step 1b/2b are rewritten to express the chrome in pure UIKit primitives.

### Step 5 — Manual smoke test

Run `npm start` and verify each acceptance-criteria item in the Acceptance Criteria section.

## Files NOT changed

These were investigated and confirmed to need no edits:

- `src/renderer/api/pages/PagesModel.ts`, `PageModel.ts`, `pages/index.ts` — model and state APIs unchanged.
- `src/renderer/api/window.ts`, `settings.ts`, `app.ts` — consumed APIs unchanged.
- `src/renderer/api/events/events.ts` (`ContextMenuEvent`) — context-menu handoff unchanged.
- `src/renderer/api/ui.ts` — only `ui.input` is used, signature unchanged.
- `src/renderer/core/state/model.ts` — `TComponentModel`, `useComponentModel`.
- `src/renderer/core/state/state.ts` — `useOptionalState`.
- `src/renderer/core/traits/*` — drag-data still flows through traits unchanged.
- `src/renderer/core/utils/monaco-languages.ts`, `parse-utils.ts` — unchanged.
- `src/renderer/components/icons/LanguageIcon.tsx` — unchanged. Domain icon, not a UIKit candidate; remains the only legacy import after migration.
- `src/renderer/components/overlay/WithPopupMenu.tsx`, `PopupMenu.tsx`, `Popper.tsx` — **NOT modified by US-478**, but no longer imported by these two files. The files themselves remain in the codebase for other consumers; US-483 will sweep remaining consumers and delete these files.
- `src/renderer/editors/text/*` — `isTextFileModel`, `TextFileModel`.
- `src/renderer/editors/video/VideoPlayerEditor.tsx`, `editors/browser/BrowserEditorModel.ts` — `toggleMuteAll`, `_anyTabAudible` shape unchanged.
- `src/renderer/theme/icons/*`, `theme/color.ts` — unchanged.
- `src/renderer/ui/app/MainPage.tsx` — consumer of `<PageTabs />`; renders unchanged.
- `src/ipc/renderer/api.ts` — `addDragEvent`, `showItemInFolder` unchanged.

## Concerns / Open questions

### #1 — Rule 7 vs application chrome surfaces *(blocks implementation — needs user decision)*

**Tension.** EPIC-025 Phase 4 mandates that migrated screens "use only `uikit/` components, no `styled.*`, `style=`, or `className=`" (epic line 301). Strict reading: PageTab.tsx and PageTabs.tsx must drop `@emotion/styled` entirely.

**But.** PageTab is highly bespoke application chrome — rounded top corners, sticky pinned positioning with caller-controlled `left` offset, custom z-index stacking, drag-over highlight, dirty-dot/close-icon swap by hover state, hidden `::-webkit-scrollbar`, split-button border-radius geometry. Expressing all this through a generalized UIKit primitive would either bloat `Panel`/`IconButton`'s prop surface for one consumer or force creation of `TabStrip` / `Tab` UIKit primitives that — per the user's framing — will never be reused (Persephone has only one tab strip).

**Path A (strict Rule 7).** Compose entirely from UIKit primitives. Likely requires extending `Panel` with `position: "sticky"`, `customRadius`, custom paddings, `hideScrollbar`, etc. — and/or creating UIKit `Tab` / `TabStrip`. Bloats UIKit surface for a one-off use. *(Cost: high. Reuse value: none.)*

**Path B (pragmatic — recommended; user-suggested).** Keep `PageTab.tsx` and `PageTabs.tsx` in `src/renderer/ui/tabs/` with their own local `@emotion/styled` for chrome layout. Replace usages of legacy `Button`/`Tooltip` with UIKit `IconButton`/`Tooltip`. Apply Rule 1 (`data-*` attributes). Drop `clsx`. Add a documented carve-out to UIKit Rule 7 for application-level chrome surfaces in `ui/` whose layout is unique-to-app and not reusable. *(Cost: low. Faithfully captures user intent.)*

**Resolution (assumed Path B).** Path B per the user's stated direction. Rule 7 in `src/renderer/uikit/CLAUDE.md` gets a new "Exception: application chrome" paragraph. Proposed wording (added at the end of Rule 7, after the "When this rule may be relaxed" paragraph):

> **Application chrome exception (`src/renderer/ui/`)**
>
> Files in `src/renderer/ui/` that render the Persephone application's one-of-a-kind chrome surfaces (page tab strip, sidebar, navigation bar, etc.) are not subject to the no-Emotion clause. Their visual layout is unique to Persephone, will not be reused elsewhere, and would distort the UIKit surface if every chrome quirk became a `Panel` prop or a new UIKit primitive.
>
> Such files MAY use `@emotion/styled`, `style={…}`, and `className=…` on their own local elements (plain `<div>`s, etc.) for chrome layout. They MUST still:
>
> - Use only UIKit components (`Button`, `IconButton`, `Tooltip`, `Divider`, `Panel`, …) for primitive rendering — no imports from `src/renderer/components/basic/` or `components/form/` for new code.
> - Apply Rule 1 (`data-*` for state) on their own elements.
> - Avoid passing `style={…}` or `className=…` to UIKit components (that's still a TypeScript error).
>
> This exception does **not** apply to anything that could plausibly be reused (forms, dialogs, settings panels, list rows). For those, the strict rule still holds — extend a UIKit primitive instead of styling around it.

**Action:** if Path B is approved, Step 4 of the plan applies (CLAUDE.md edit). If Path A is preferred, the plan needs significant rework and US-478 should be re-investigated with a focus on building UIKit `TabStrip`/`Tab` primitives.

### #2 — `WithPopupMenu` migration *(resolved by US-481)*

**Original concern.** UIKit had no `Menu` primitive, so the legacy `WithPopupMenu` (`components/overlay/WithPopupMenu.tsx`) + `PopupMenu` (`components/overlay/PopupMenu.tsx`) had to stay as Phase-5 adopt-in-place imports.

**Resolution.** US-481 added UIKit `Menu` and `WithMenu` (`src/renderer/uikit/Menu/`). `WithMenu` is a drop-in replacement for `WithPopupMenu`:

- Same render-prop API: `(setOpen: (anchor: Element | null) => void) => React.ReactElement`.
- Same default offset: `[-4, 4]`.
- Same `MenuItem` shape — re-exported from the canonical `api/types/events.d.ts`, so legacy and UIKit point at the same type.
- Behavior parity: search at >20 items, sub-menus with hover delay, keyboard navigation, hotkey display, disabled, `startGroup`, `minor`, focus restoration, selected-item initial highlight.

The two `WithPopupMenu` call sites in `PageTab.tsx` (language picker) and `PageTabs.tsx` (add-page dropdown) become mechanical swaps. The legacy `WithPopupMenu`/`PopupMenu` files themselves remain in the codebase for other yet-to-be-migrated consumers (US-483 will sweep and delete them).

The right-click context menu on a tab (`tabModel.handleContextMenu` → `ContextMenuEvent`) is a separate code path that flows through the script-API event channel — **not** in scope for US-478. That's US-482's territory (`showMenu(x,y,items)` + refactor `showAppPopupMenu`).

**Acceptance criteria tightened.** "No imports from `components/`" now extends to `components/basic/` AND `components/overlay/`. The only allowed legacy import in these two files after the migration is `LanguageIcon` from `components/icons/` (a domain icon, not a UIKit candidate).

### #3 — Tooltip API change: `data-tooltip-id` linking → wrap-the-trigger

Legacy `Tooltip` is portal-rendered and linked to triggers by `data-tooltip-id` matching. UIKit `Tooltip` clones a child element and forwards a ref. This means:

- The bottom-of-component `<Tooltip id={id} place="bottom" delayShow={1500}>{filePath}</Tooltip>` block is replaced by **two** wrapping `<Tooltip>` elements: one around the pinned-tooltip-trigger span, one around the title-label span.
- The `crypto.randomUUID()` `id` is no longer needed.
- Behavior parity: pinned tabs show file-path tooltip when hovering the body (same as today via the trigger overlay). Non-pinned tabs show file-path tooltip when hovering the title label (same as today). Falsy `content` suppresses the tooltip (so `<Tooltip content={null}>` is a no-op wrap).

**Resolution.** Use the wrap-the-trigger pattern in Step 1c. No behavioral change.

### #4 — Split-button geometry on UIKit IconButton

The "Add Page" split (PlusIcon main + ChevronDown dropdown) is currently a connected pill: left half rounded on the left, right half rounded on the right, divider in middle. UIKit `IconButton` has a fixed border-radius and no API for asymmetric corners.

**Resolution (consistent with Concern #1, Path B).** The `.add-page-split` styled wrapper applies `border-radius: 4px 0 0 4px` to its first IconButton via `& [data-part="add-page-main"]` and `0 4px 4px 0` to `& [data-part="add-page-dropdown"]`. These are CSS overrides on the IconButton's `<button>` element, not props on the IconButton — Rule 7 forbids passing `style`/`className` to UIKit components, but a parent's descendant selector targeting `data-type="icon-button"` is allowed (per the application-chrome carve-out).

**Visual delta.** None expected — geometry is preserved exactly via the wrapper CSS.

### #5 — IconButton has no `background` prop

Legacy `Button` had `background="default" | "light" | "dark"` to adjust hover background contrast. UIKit `Button` has it; UIKit `IconButton` does not. Legacy PageTab passes `background={tabModel.isActive ? "default" : "dark"}` to icon-only Buttons, but in legacy `Button` this was a **no-op for `type="icon"`** (the `.icon` class sets `background-color: transparent` and the `&.notIcon` rules don't apply). So in legacy, the `background=` prop on icon-only PageTab buttons does literally nothing.

**Resolution.** Drop the `background` prop on the migration; IconButton inherits parent background and only changes icon color on hover. No visual regression expected.

### #6 — Close button has two stacked icons (close + modified-dot)

Legacy renders both `CloseIcon`/`GroupIcon` and `CircleIcon` as direct children of the close-Button, with CSS toggling display by tab state. UIKit `IconButton` accepts a single `icon` prop (rendered inside `<span data-part="icon">`), but a React fragment with multiple children is fine.

**Resolution.** Pass `icon={<>{closeIcon}<CircleIcon data-part="modified-icon" /></>}`. The styled root's selectors target `[data-part="modified-icon"]` and `[data-part="close-icon"]` regardless of the wrapping span IconButton inserts — descendant selectors don't care about depth.

**Sub-concern.** The icon components from `theme/icons` need to forward `data-part` to their underlying `<svg>`. If they don't, wrap each icon in a `<span data-part="…">` instead. Verify during implementation by inspecting one rendered tab in DevTools.

### #7 — Is `className="page-tabs"` consumed externally?

The legacy `<PageTabsRoot className="page-tabs">` adds an external-CSS class. Quick grep needed during implementation:

```bash
grep -r "\.page-tabs" src/   # selector-style references
grep -r "page-tabs" src/     # any reference (will include the source)
```

If consumed, keep the className. If not, remove it (one less className-driven anchor). The plan defaults to keeping it — safer, low cost.

### #8 — Encryption icon is an emoji; `LockIcon`/`UnlockIcon` are imported but unused

PageTab imports `LockIcon`, `UnlockIcon`, `KeyOffIcon` from `theme/icons` (used in the right-click context menu items), but renders the emoji `🔒`/`🔓` in the encryption-icon span. Replacing the emoji with the icon component would unify the visual. **Out of scope for US-478** — purely cosmetic, would need a separate pre-existing-bug task. Keep emojis.

### #9 — Drag-and-drop / context-menu wiring unchanged

The DnD code (`handleDragStart`, `handleDragEnd`, `handleDrop`, `handleDragEnter/Over/Leave`) and the context-menu builder (`handleContextMenu`) are unchanged. The only DnD-related visual change is `isDraggOver` (className) → `data-drag-over` (attribute), already covered in Step 1b.

## Acceptance criteria

1. `src/renderer/ui/tabs/PageTab.tsx` no longer imports from `src/renderer/components/basic/` or `src/renderer/components/overlay/`. The only allowed `src/renderer/components/` import is `LanguageIcon` from `components/icons/`.
2. `src/renderer/ui/tabs/PageTabs.tsx` no longer imports from `src/renderer/components/basic/` or `src/renderer/components/overlay/`.
3. Both files use `IconButton`, `Tooltip`, and `WithMenu` from `src/renderer/uikit/` (and `Divider` for PageTabs split-button). `MenuItem` type is imported from `src/renderer/uikit/`, not from `components/overlay/PopupMenu`.
4. Both files no longer import `clsx`. All conditional state on the styled roots is expressed via `data-*` attributes per Rule 1.
5. The `id = useMemo(() => crypto.randomUUID(), …)` is removed from PageTab.tsx; no `data-tooltip-id` attributes remain.
6. `src/renderer/uikit/CLAUDE.md` Rule 7 includes the new "Application chrome exception" paragraph (Concern #1, Path B).
7. `npx tsc --noEmit` reports the same baseline error count as before this task — no new TypeScript errors introduced. *(Baseline at task start: 41 errors per US-477 README.)*
8. `npm run lint` reports the same baseline error count as before this task — no new ESLint errors in `ui/tabs/`.
9. Visual smoke test: open Persephone with `npm start` and verify each of the following:
10. **Active tab styling** — the active tab has the lighter background and a visible border-top.
11. **Hover state** — hovering an inactive tab shows the border and reveals the close button.
12. **Modified dot** — open a file, type something to mark it modified. The close button shows a yellow `CircleIcon` instead of `CloseIcon`. Hover the tab — the dot is replaced by the X.
13. **Pinned tabs** — pin a tab. It becomes narrow (≈44px), sticks to the left when scrolling, shows a darker background. The X is hidden (no close on a pinned single-grouped tab).
14. **Pinned + grouped** — group a pinned tab. The X (group icon) becomes clickable; clicking ungroups.
15. **Pinned + encrypted** — open a `.txc` (encrypted) file and pin it. The pinned tab is wider (≈64px) to fit the lock emoji.
16. **Drag reorder** — drag a tab left/right. The drag-over target gets the `data-drag-over` background highlight.
17. **Cross-window drag** — drag a tab onto another Persephone window. The tab moves between windows.
18. **Scroll arrows** — open more tabs than fit. Left/right arrows appear; clicking them scrolls by ~80px.
19. **Add Page split button** — clicking the `+` opens a new empty page. Clicking the chevron opens the editor-types popup menu (pinned editors + "Show All…").
20. **Sound button** — open an audio/video file. The volume icon appears even when not hovering. Click to mute — icon flips to muted, stays visible.
21. **Language picker** — click the language icon on the active tab. The popup menu opens. Click a different language. Click the language icon on a NON-active tab — focuses the tab without opening the menu (existing behavior preserved).
22. **File-path tooltip** — hover the title of a non-pinned tab → file-path tooltip appears after ~1500ms, placed below the tab. Hover the body of a pinned tab → same tooltip via the overlay trigger.
23. **Right-click context menu** — right-click any tab → existing menu items render (Pin/Unpin, Close, Save, Rename, etc.).
24. **Temp / deleted styling** — a temp page renders with italic title; a deleted file's tab renders the title in red.

## Files Changed summary

| File | Change |
|------|--------|
| `src/renderer/ui/tabs/PageTab.tsx` | Replace legacy `Button` → UIKit `IconButton`, legacy `Tooltip` → UIKit `Tooltip` (wrap-the-trigger), legacy `WithPopupMenu` → UIKit `WithMenu`, `MenuItem` import from `uikit`. Drop `clsx`, drop `crypto.randomUUID` ID, `className`-state → `data-*` (Rule 1). Local `@emotion/styled` for chrome stays. |
| `src/renderer/ui/tabs/PageTabs.tsx` | Replace legacy `Button` → UIKit `IconButton`, legacy `WithPopupMenu` → UIKit `WithMenu`, replace `<div className="split-divider" />` → UIKit `<Divider orientation="vertical" />`. Local `@emotion/styled` for chrome stays. Update descendant selectors from `& button` to `& [data-type="icon-button"]`. |
| `src/renderer/ui/tabs/index.ts` | No change. |
| `src/renderer/uikit/CLAUDE.md` | Add the "Application chrome exception" paragraph at the end of Rule 7 (Concern #1, Path B). |
| `doc/active-work.md` | Mark US-478 as Active when work begins; remains `[ ]` until epic review per CLAUDE.md epic-task model. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- **Depends on:** [US-481](../US-481-uikit-menu-with-menu/README.md) — UIKit `Menu` + `WithMenu` (delivers the primitive that unblocks the `WithPopupMenu` migration in this task)
- Related precedents:
  - [US-450](../US-450-uikit-toolbar/README.md) — UIKit Toolbar with roving tabindex (similar widget pattern, deferred here)
  - [US-476](../US-476-alerts-bar-migration/README.md) — singleton overlay migration (AlertsBar)
  - [US-477](../US-477-progress-dialog-migration/README.md) — singleton overlay migration (ProgressOverlay) — most-recent precedent for keeping local Emotion in app code
