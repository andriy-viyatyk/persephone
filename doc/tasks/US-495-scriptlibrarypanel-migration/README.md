# US-495: ScriptLibraryPanel — UIKit migration

## Status

**Active** — part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen
migration. Together with US-496, this completes the Sidebar's panel-level
UIKit migration. (The shared `TreeProviderView` consumed by the populated
state is migrated separately in US-497.)

## Goal

Migrate `ScriptLibraryPanel.tsx` to **fully** use UIKit primitives — no
Emotion, no hand-rolled chrome. Replace the styled `<div>`s with UIKit
`Panel`, the placeholder hint with UIKit `Text` (extending it with a small
`align` prop), and the "Select Folder" button with UIKit `Button`. Add a
`align` prop to `Text` so typography centering is expressible without inline
style. Add `data-type="script-library-panel"` (Rule 1). Fix the pre-existing
rules-of-hooks violation while we're in here.

`TreeProviderView` (rendered when a library path IS set) is consumed
unchanged here — its UIKit migration is a separate task ([US-497](../US-497-treeproviderview-migration/README.md)).

## Background

### Current implementation

`ScriptLibraryPanel.tsx` has two render paths driven by
`settings.use("script-library.path")`:

| Path state | Renders |
|------------|---------|
| **Empty / unset** | `library-placeholder` flex column with a hand-rolled "Select Folder" button + 11-px hint text |
| **Set** | `<TreeProviderView>` directly (file-tree provider rooted at the library path) |

The panel ships three Emotion CSS class blocks (`library-placeholder`,
`library-placeholder-hint`, `library-action-button`) and the root is a
`styled.div`. After this task, all of them are replaced by UIKit primitives.

### Pre-existing rules-of-hooks violation

```tsx
if (!libraryPath) { return ( /* placeholder */ ); }
const provider = useMemo(() => new FileTreeProvider(libraryPath), [libraryPath]);
```

`useMemo` is called **after** the early return — its presence depends on
`libraryPath`. Toggling between the two states changes the hook count and
will eventually crash React's reconciler. **Fixed in this task.**

### UIKit primitives in scope

| Primitive | Use |
|-----------|-----|
| `Panel` | Root layout (column, height 100%) and inner placeholder layout (centered column with gap + padding) |
| `Button` | "Select Folder" with `icon`, `background="dark"` for the dark sidebar |
| `Text` | The hint copy. Needs a new `align` prop (added in this task — see Step 2). |

### Mapping current styles → UIKit props

#### Root `ScriptLibraryPanelRoot` (`display: flex; flexDirection: column; height: 100%`)

→ `<Panel direction="column" height="100%" data-type="script-library-panel">`.

(Panel sets its own `data-type="panel"`; passing `data-type="script-library-panel"`
via the spread overrides it — Panel forwards `{...rest}` after its
internal data attributes.)

#### `.library-placeholder` (`display: flex; flexDirection: column; alignItems: center; justifyContent: center; gap: 12; height: 100%; padding: 16`)

→ `<Panel direction="column" align="center" justify="center" gap="xl" padding="xl" flex>`.

Token mapping:
- `gap: 12` → `gap.xl` (`gap.lg = 8`, `gap.xl = 12` — exact match)
- `padding: 16` → `spacing.xl` (16 — exact match)
- `height: 100%` → `flex` (the placeholder is the only child of the root Panel, so `flex` makes it fill available height; equivalent to `height: 100%` here)

#### `.library-placeholder-hint` (`fontSize: 11; color: text.light; textAlign: center; lineHeight: 1.5; maxWidth: 200`)

→ `<Text size="xs" color="light" align="center">…</Text>`.

Acceptable visual deltas (per "consistency wins" stance):
- `fontSize: 11 → 12` (Text `xs` is 12px — `tokens.ts` notes 11px is unreadable in monospace and intentionally collapses xs/sm to 12).
- `lineHeight: 1.5` is dropped (UIKit Text uses default line-height).
- `maxWidth: 200` is dropped — the placeholder Panel's padding `xl`
  (16) on each side already gives a comfortable reading column at typical
  sidebar widths (~250-300px).

#### Hand-rolled `<button class="library-action-button">`

→ `<Button background="dark" icon={<FolderOpenIcon />} onClick={handleSelectFolder}>Select Folder</Button>`.

`background="dark"` adjusts hover/active so the button stays visible against
the sidebar's dark background.

### Files NOT changed in this task

- `src/renderer/components/tree-provider/TreeProviderView.tsx` and the rest of
  `components/tree-provider/` — covered by **US-497**.
- `src/renderer/components/TreeView/` — covered by US-497.
- `src/renderer/content/tree-providers/FileTreeProvider.ts` — unchanged.
- `src/renderer/ui/dialogs/LibrarySetupDialog.tsx` — unchanged.
- `src/renderer/ui/sidebar/MenuBar.tsx` — `ScriptLibraryPanel`'s prop surface
  is unchanged.

### Rules that apply

- **Rule 1 (`data-*` for state)** — root carries `data-type="script-library-panel"`.
- **Rule 7 (no Emotion outside UIKit)** — sidebar files have a chrome
  exception, but the user's directive for this migration is "no Emotion if
  possible — extend UIKit if needed". This task uses **zero Emotion**.

## Implementation plan

### Step 1 — Extend UIKit `Text` with an `align` prop

`src/renderer/uikit/Text/Text.tsx`:

1. Add to `TextStyleProps`:
   ```ts
   /** Text alignment. Use this when the Text spans multiple lines and you want
    * the wrapped lines aligned. Forces `display: block` (Text is a span by default,
    * and textAlign on an inline span doesn't affect wrapped content layout). */
   align?: "left" | "center" | "right";
   ```

2. Add to the styled block:
   ```ts
   '&[data-align="left"]':   { textAlign: "left",   display: "block" },
   '&[data-align="center"]': { textAlign: "center", display: "block" },
   '&[data-align="right"]':  { textAlign: "right",  display: "block" },
   ```

3. Add to the component's destructure + JSX:
   ```ts
   align,
   ...
   data-align={align || undefined}
   ```

4. No story update required (story exists at
   `src/renderer/uikit/Text/Text.story.tsx` if it exists — verify and add a
   small "alignment" example if so).

### Step 2 — Rewrite `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx`

Full file replacement. Drop `import styled` and the styled definition.
Drop `import color`. Final imports:

```tsx
import { useMemo } from "react";
import { settings } from "../../api/settings";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import {
    TreeProviderView,
    type TreeProviderViewRef,
    type TreeProviderViewSavedState,
} from "../../components/tree-provider/TreeProviderView";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import { FolderOpenIcon } from "../../theme/icons";
import { Panel, Button, Text } from "../../uikit";
```

#### Component body — fixes hook order

```tsx
interface ScriptLibraryPanelProps {
    onClose?: () => void;
    explorerRef?: (ref: TreeProviderViewRef | null) => void;
    expandState?: TreeProviderViewSavedState;
    onExpandStateChange?: (state: TreeProviderViewSavedState) => void;
}

export function ScriptLibraryPanel(props: ScriptLibraryPanelProps) {
    const libraryPath = settings.use("script-library.path");

    const provider = useMemo(
        () => (libraryPath ? new FileTreeProvider(libraryPath) : null),
        [libraryPath],
    );

    const handleSelectFolder = async () => {
        const { showLibrarySetupDialog } = await import("../dialogs/LibrarySetupDialog");
        showLibrarySetupDialog();
    };

    if (!libraryPath || !provider) {
        return (
            <Panel
                direction="column"
                height="100%"
                data-type="script-library-panel"
            >
                <Panel
                    direction="column"
                    align="center"
                    justify="center"
                    gap="xl"
                    padding="xl"
                    flex
                >
                    <Button
                        background="dark"
                        icon={<FolderOpenIcon />}
                        onClick={handleSelectFolder}
                    >
                        Select Folder
                    </Button>
                    <Text size="xs" color="light" align="center">
                        Select an existing folder with scripts or create a new one to store
                        your saved scripts and reusable modules
                    </Text>
                </Panel>
            </Panel>
        );
    }

    return (
        <Panel direction="column" height="100%" data-type="script-library-panel">
            <TreeProviderView
                ref={props.explorerRef}
                key={libraryPath}
                provider={provider}
                initialState={props.expandState}
                onStateChange={props.onExpandStateChange}
                onItemClick={(item) => {
                    if (!item.isDirectory) {
                        app.events.openRawLink.sendAsync(createLinkData(item.href));
                        props.onClose?.();
                    }
                }}
            />
        </Panel>
    );
}
```

Notes:
- `useMemo` runs unconditionally (above the early return). When `libraryPath`
  is falsy, the provider is `null` — early return guards against that.
- Both branches wrap in the same outer Panel so `data-type="script-library-panel"`
  is consistent across states.
- Hook count is now stable across renders.

### Step 3 — Verify

```bash
npx tsc --noEmit
npx eslint src/renderer/ui/sidebar/ScriptLibraryPanel.tsx src/renderer/uikit/Text/Text.tsx
```

Expect: no new errors. The `align` prop addition is purely additive (no
existing call sites need to change).

Manual smoke:
1. Clear `script-library.path` setting → panel shows placeholder. Button
   centered with hint underneath, hint text centered (or wrapped centered).
2. Click "Select Folder" → `LibrarySetupDialog` opens. Cancel → still
   placeholder.
3. Set a path via the dialog → tree appears (rendered by `TreeProviderView`,
   unchanged).
4. Click a file in the tree → opens via `app.events.openRawLink`, panel
   closes.
5. Toggle the path back to empty → placeholder reappears, no React warnings
   in console.
6. Cycle theme (Light/Dark) → button background, text colors visually correct
   in both.

## Concerns

### C1 — UIKit `Text` for the hint *(RESOLVED)*

UIKit `Text` is used. `xs` (12px) substitutes for the original 11px;
`color="light"` matches; new `align="center"` prop replicates the original
centering. `lineHeight: 1.5` and `maxWidth: 200` are dropped — accepted
visual deltas in line with the "consistency over fidelity" migration stance.

### C2 — `Button` background variant for the dark sidebar *(RESOLVED)*

Pass `background="dark"`. Hover/active feedback adapts. Verified during
implementation.

### C3 — Migrate the panel root to UIKit `Panel` *(RESOLVED)*

Both the outer container and the inner placeholder use `Panel`. Zero Emotion
left in the file.

### C4 — TreeProviderView migration scope *(RESOLVED — separate task)*

`TreeProviderView` is **not** migrated here. It has 6 consumers across the
app (sidebar + editors), so its migration is a multi-file effort owned by
**US-497** (created alongside this task). US-495 leaves `TreeProviderView`
imports and usage untouched.

### C5 — Pre-existing rules-of-hooks violation *(RESOLVED — fixed)*

`useMemo` is lifted above the early return and gated on `libraryPath`.
Provider is `null` when path is empty; early return guards against `null`
provider. Hook order is now stable across renders.

### C6 — `data-type` collision with `Panel`'s built-in `data-type="panel"`

Panel forwards `{...rest}` after setting `data-type="panel"`, so passing
`data-type="script-library-panel"` from the consumer overrides it. Verified
in `Panel.tsx` source — `{...rest}` comes after `data-type` in the rendered
JSX.

**Resolution:** No change needed; relying on the override is intentional and
documented behavior.

### C7 — Visual delta in the placeholder

Drops: 11px → 12px font; loss of `maxWidth: 200`; loss of `lineHeight: 1.5`.

**Resolution:** Acceptable per migration stance. If the user dislikes the
result, easy follow-ups:
- Add an `xxs` size to UIKit Text (11px) — a tokens change.
- Add a `maxWidth` prop to Text or wrap with an inner Panel.
- Add a `lineHeight` prop to Text.

## Acceptance criteria

- [ ] `Text.tsx` has a new `align?: "left" | "center" | "right"` prop with
  `display: block` applied when set.
- [ ] `ScriptLibraryPanel.tsx` has zero `import styled` and zero `import color`.
- [ ] Root and inner placeholder are UIKit `Panel`s.
- [ ] "Select Folder" button is a UIKit `Button` with `background="dark"` and
  `icon={<FolderOpenIcon />}`.
- [ ] Hint is a UIKit `Text` with `size="xs"`, `color="light"`, `align="center"`.
- [ ] Outer Panel carries `data-type="script-library-panel"` (overriding
  Panel's default `data-type="panel"`).
- [ ] `useMemo(() => new FileTreeProvider(...), [libraryPath])` is called
  **before** the early return; provider is `null` when `libraryPath` is
  empty; early-return guard prevents passing `null` to `TreeProviderView`.
- [ ] Toggling `libraryPath` between empty and set in the running app produces
  no React warnings about hook order.
- [ ] Clicking the button still opens `LibrarySetupDialog`.
- [ ] Populated state (`<TreeProviderView>`) renders identically — file
  click opens link and closes panel.
- [ ] `npx tsc --noEmit` shows no new errors.
- [ ] `npx eslint src/renderer/ui/sidebar/ScriptLibraryPanel.tsx
  src/renderer/uikit/Text/Text.tsx` is clean.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/uikit/Text/Text.tsx` | Add `align` prop (`"left" \| "center" \| "right"`) with `data-align` attribute selector + `display: block` when set. |
| `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` | Full rewrite. Drop Emotion + color imports. Use UIKit `Panel`, `Button`, `Text`. Add `data-type="script-library-panel"` on outer Panel. Lift `useMemo` above the early return; gate provider creation on `libraryPath`. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Sibling: [US-496](../US-496-toolseditorspanel-migration/README.md)
- Related: [US-497](../US-497-treeproviderview-migration/README.md) — TreeProviderView migration to UIKit Tree
- Blocks: [US-492](../US-492-sidebar-integration-testing/README.md)
