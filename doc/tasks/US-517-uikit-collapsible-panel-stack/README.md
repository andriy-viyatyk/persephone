# US-517: UIKit `CollapsiblePanelStack` primitive — vertical stack with one expanded panel

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
UIKit primitive infrastructure. Unblocks
[US-512](../US-512-notebook-editor-migration/README.md) (Notebook editor
migration), and benefits future LinkEditor migration plus the chrome
sidebar `PageNavigator`.

## Goal

Add a UIKit composite primitive at `src/renderer/uikit/CollapsiblePanelStack/`
with two parts:

- `CollapsiblePanelStack` — root layout container.
- `CollapsiblePanel` — declarative child element that defines a panel
  (id, title, children, optional buttons / icon / header ref).

It replaces the legacy
`src/renderer/components/layout/CollapsiblePanelStack.tsx` for any new code.

This task introduces the primitive only. Existing call sites stay on the
legacy component until their per-screen migration tasks pick them up — see
the ownership table in C7.

## Background

### Current legacy component

`src/renderer/components/layout/CollapsiblePanelStack.tsx` (~220 LoC).
Renders a vertical stack where exactly one panel is expanded at a time.
Clicking a collapsed header expands it; clicking the currently-expanded
header returns to the previously-expanded panel (history-tracked
back-navigation, not cycling).

Legacy API:

```ts
interface CollapsiblePanelProps {
    id: string;
    title?: ReactNode;
    children: ReactNode;
    icon?: ReactNode;
    buttons?: ReactNode;
    headerRef?: (el: HTMLDivElement | null) => void;
    alwaysRenderContent?: boolean;
}

interface CollapsiblePanelStackProps {
    activePanel: string;
    setActivePanel: (panelId: string) => void;
    children: ReactNode;
    className?: string;
    style?: CSSProperties;          // ← passed by Notebook to set width
}
```

Implementation: single `styled.div` root with descendant selectors for
`.collapsible-panel`, `.panel-header`, `.panel-content`, `.panel-spacer`.
Children are introspected via `Children.forEach` — each `<CollapsiblePanel>`
contributes `{ id, title, content, icon, buttons, headerRef, alwaysRenderContent }`
to a flat array; the parent renders one `<div className="collapsible-panel">`
per entry with conditional `expanded` / `collapsed` class flip and a
`flex` transition. The parent tracks a `previousPanelRef` for back-navigation.

### Confirmed call sites

- **`src/renderer/editors/notebook/NotebookEditor.tsx`** — sidebar with
  Tags / Categories panels. Passes `style={{ width: pageState.leftPanelWidth, minWidth: 100, maxWidth: "80%" }}`.
  Migrates as part of **US-512**.
- **`src/renderer/editors/link-editor/LinkEditor.tsx`** — sidebar with
  multiple panels (categories, tags, hostnames, pinned links). Future
  migration.
- **`src/renderer/ui/navigation/PageNavigator.tsx`** — chrome sidebar.
  Uses `headerRef` so a child component can portal its own header content
  into the panel's header bar. Chrome (`src/renderer/ui/`); chrome
  exception applies, but adopting the UIKit primitive keeps consistency
  with the rest of the sidebar.

Three current consumers across editors and chrome — consolidating into UIKit
is justified.

### API quirks worth correcting

- **`className` / `style` props** — drop. Rule 7 forbids `className` on
  UIKit components, and `style` is type-level forbidden via the Omit clause.
  Replace with explicit Panel-style props (`width`, `minWidth`, `maxWidth`,
  `height` etc.). Notebook's only use of `style` today is to set width;
  that maps cleanly to a `width` prop.
- **`activePanel` / `setActivePanel`** — keep names. `activePanel` matches
  the legacy and reads naturally.
- **`CollapsiblePanel` as a "marker" child** — keep. The legacy component
  doesn't render anything itself; its props are extracted by the parent. This
  is identical to how `<DialogContent>` / `<RadioGroup>`'s internal
  `<Radio>` works in UIKit. Keep the pattern.

### UIKit conventions to follow

- **Naming** — `activePanel` / `setActivePanel` (legacy parity); each panel's
  `id` / `title` / `icon` / `buttons` / `headerRef` / `alwaysRenderContent`
  stays.
- **Rule 1 — `data-*` for state:**
  - Stack root: `data-type="collapsible-panel-stack"`.
  - Each panel wrapper: `data-type="collapsible-panel"`,
    `data-state="open"|"closed"`.
  - Panel header: `data-part="header"`. Panel content: `data-part="content"`.
- **Rule 2 — controlled:** `activePanel` / `setActivePanel` are external;
  no internal state for the value. The previous-panel ref for back-navigation
  is internal (allowed — it's transient bookkeeping, not the primary value).
- **Rule 7 — forbid `style`/`className` at the type level:** Stack props
  extends `Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">`;
  panel props extend the same omit on `HTMLDivElement`.
- **Tokens:** colors from `color.ts`; `27` legacy header height becomes
  a `tokens.height.controlMd`-aligned value (verify in implementation).

### Reference primitives

- `uikit/RadioGroup/RadioGroup.tsx` — uses `Children.forEach` to introspect
  declarative children (`<Radio>`). Same pattern.
- `uikit/Panel/Panel.tsx` — for the `width`/`minWidth`/`maxWidth` prop
  shape; copy the same `number | string` typing.
- `uikit/Splitter/Splitter.story.tsx` — for the story shape.

## Component design

Files: `src/renderer/uikit/CollapsiblePanelStack/`
- `CollapsiblePanelStack.tsx` — both `CollapsiblePanel` (marker) and
  `CollapsiblePanelStack` (container) live in this single file. Same as the
  legacy implementation; both names are needed at the call site, and they
  share the props shape via `CollapsiblePanelProps`.
- `index.ts` — re-exports both components and their props types.

### Sketch (key parts)

```tsx
import React, {
    Children, CSSProperties, isValidElement, ReactElement, ReactNode,
    useEffect, useRef,
} from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { ChevronDownIcon, ChevronRightIcon } from "../../theme/icons";

// =============================================================================
// CollapsiblePanel — marker component (renders nothing on its own)
// =============================================================================

export interface CollapsiblePanelProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Unique panel identifier (used by `activePanel`). */
    id: string;
    /** Header title. Omit when the child portals its own header via headerRef. */
    title?: ReactNode;
    /** Panel content. */
    children: ReactNode;
    /** Optional leading icon in the header. */
    icon?: ReactNode;
    /** Optional trailing action buttons in the header. When present, the
     *  expand/collapse chevron is hidden — buttons imply state visibility. */
    buttons?: ReactNode;
    /** Ref callback for the header element — children can portal into it. */
    headerRef?: (el: HTMLDivElement | null) => void;
    /** Always render content even when collapsed (hidden via display:none).
     *  Useful when content portals into the header and must stay mounted. */
    alwaysRenderContent?: boolean;
}

export function CollapsiblePanel(_props: CollapsiblePanelProps): ReactElement | null {
    // Renders nothing; props are extracted by CollapsiblePanelStack.
    return null;
}

// =============================================================================
// CollapsiblePanelStack — container
// =============================================================================

export interface CollapsiblePanelStackProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** ID of the currently expanded panel. Controlled. */
    activePanel: string;
    /** Called when the user toggles a panel. */
    setActivePanel: (panelId: string) => void;
    /** Panel definitions — should be `<CollapsiblePanel>` children only. */
    children: ReactNode;

    // Layout props (replace legacy className/style escape hatches)
    width?: number | string;
    minWidth?: number | string;
    maxWidth?: number | string;
    height?: number | string;
    minHeight?: number | string;
    maxHeight?: number | string;
}

const StackRoot = styled.div(
    {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",

        '& > [data-type="collapsible-panel"]': {
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: "flex 0.15s ease",
        },
        '& > [data-type="collapsible-panel"][data-state="closed"]': {
            flex: "0 0 auto",
        },
        '& > [data-type="collapsible-panel"][data-state="open"]': {
            flex: "1 1 auto",
        },

        '& [data-part="header"]': {
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 4px",
            minHeight: 27,
            fontSize: 12,
            fontWeight: 500,
            color: color.text.light,
            backgroundColor: color.background.dark,
            cursor: "pointer",
            userSelect: "none",
            borderBottom: `1px solid ${color.border.light}`,
            "&:hover": { backgroundColor: color.background.light },
            "& > svg": { width: 14, height: 14, flexShrink: 0 },
        },
        '& [data-part="header-spacer"]': { flex: "1 1 auto" },

        '& [data-part="content"]': {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backgroundColor: color.background.default,
        },
    },
    { label: "CollapsiblePanelStack" },
);

export function CollapsiblePanelStack({
    activePanel, setActivePanel, children,
    width, minWidth, maxWidth, height, minHeight, maxHeight,
    ...rest
}: CollapsiblePanelStackProps) {
    // Extract panel definitions from children
    const panels: CollapsiblePanelProps[] = [];
    Children.forEach(children, (child) => {
        if (isValidElement(child) && child.type === CollapsiblePanel) {
            panels.push(child.props as CollapsiblePanelProps);
        }
    });

    const previousPanelRef = useRef<string | null>(null);
    const lastActivePanelRef = useRef(activePanel);

    useEffect(() => {
        if (activePanel !== lastActivePanelRef.current) {
            previousPanelRef.current = lastActivePanelRef.current;
            lastActivePanelRef.current = activePanel;
        }
    }, [activePanel]);

    const handleToggle = (panelId: string) => {
        if (activePanel === panelId) {
            const prev = previousPanelRef.current;
            if (prev && panels.some((p) => p.id === prev)) {
                setActivePanel(prev);
            } else {
                const fallback = panels.find((p) => p.id !== panelId);
                if (fallback) setActivePanel(fallback.id);
            }
        } else {
            setActivePanel(panelId);
        }
    };

    const style: CSSProperties = {};
    if (width !== undefined)     style.width     = width;
    if (minWidth !== undefined)  style.minWidth  = minWidth;
    if (maxWidth !== undefined)  style.maxWidth  = maxWidth;
    if (height !== undefined)    style.height    = height;
    if (minHeight !== undefined) style.minHeight = minHeight;
    if (maxHeight !== undefined) style.maxHeight = maxHeight;

    return (
        <StackRoot data-type="collapsible-panel-stack" style={style} {...rest}>
            {panels.map((panel) => {
                const isOpen = activePanel === panel.id;
                return (
                    <div
                        key={panel.id}
                        data-type="collapsible-panel"
                        data-state={isOpen ? "open" : "closed"}
                    >
                        <div
                            data-part="header"
                            ref={panel.headerRef}
                            onClick={() => handleToggle(panel.id)}
                        >
                            {!panel.headerRef && !panel.buttons && (
                                isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />
                            )}
                            {panel.icon}
                            {panel.title}
                            {panel.buttons && (
                                <>
                                    <span data-part="header-spacer" />
                                    {panel.buttons}
                                </>
                            )}
                        </div>
                        {panel.alwaysRenderContent ? (
                            <div
                                data-part="content"
                                style={isOpen ? undefined : { display: "none" }}
                            >
                                {panel.children}
                            </div>
                        ) : (
                            isOpen && (
                                <div data-part="content">{panel.children}</div>
                            )
                        )}
                    </div>
                );
            })}
        </StackRoot>
    );
}
```

Key changes vs. legacy:
- `className` removed (Rule 7).
- `style` removed (Rule 7); replaced with explicit Panel-style props
  (`width`/`minWidth`/`maxWidth`/`height`/`minHeight`/`maxHeight`). The
  legacy CSS string passes through to inline `style` on the styled root —
  same DOM behavior, type-safe surface.
- `data-type` / `data-state` / `data-part` replace string class names per
  Rule 1.
- Spreads `{...rest}` so `aria-*`, `id`, `data-*`, event handlers flow
  through.
- Inner styled-CSS is keyed off `[data-state]` / `[data-part]` instead of
  class selectors — same visual output, attribute-driven.

## Concerns

### C1 — `<CollapsiblePanel>` returning `null` is unusual; will it confuse readers?

**Concern.** A React component that always returns `null` isn't standard.
A reader might delete it, thinking it's dead code.

**Resolution.** Add a comment in the body and JSDoc on the function noting
that the component is a "marker" whose props are read by the parent
`<CollapsiblePanelStack>`. Same pattern is established in UIKit
(`RadioGroup`'s `<Radio>` works the same way) and in widely-used third-party
libraries (e.g. React Router `<Route>`). Acceptable.

### C2 — Why not use a plain array prop instead of children-as-marker?

**Concern.** A `panels: PanelDef[]` prop would be cleaner — no introspection
of children types, no risk of foreign children.

**Resolution.** Three reasons to keep the marker pattern:
1. Co-location — the panel's content (often complex JSX with hooks) sits
   inside the JSX where it visually belongs, not in a sibling array literal.
2. Prop forwarding — `headerRef` callback works naturally as a JSX prop;
   threading it through an array literal is awkward.
3. Legacy parity — all three existing call sites use the marker pattern;
   migrating them later is a one-import swap (legacy → UIKit) with zero
   structural changes.

### C3 — Layout / sizing escape hatch (replacing legacy `style` prop)

**Concern.** Notebook today passes `style={{ width: pageState.leftPanelWidth, minWidth: 100, maxWidth: "80%" }}`. UIKit forbids `style=`, so we need explicit props.

**Resolution.** Add `width` / `minWidth` / `maxWidth` / `height` /
`minHeight` / `maxHeight` props (number → px, string passes through) on
`CollapsiblePanelStackProps`. The component applies them via inline style
on its OWN styled root — that's allowed per Rule 7 ("Internal helpers and
primitive HTML elements ... are also fine — the rule applies to consumers
of UIKit, not to UIKit itself"). The consumer-facing API stays prop-typed.

### C4 — Roving tabindex on headers (Rule 4 — keyboard navigation)?

**Concern.** Rule 4 applies to "keyboard-navigable widgets" — tabbing
through panel headers and using arrow keys to switch panels would be a nice
upgrade.

**Resolution.** Defer. None of the three current call sites use keyboard
navigation, and the legacy `CollapsiblePanelStack` doesn't either —
the headers don't even have `tabIndex`. Adding it now is speculative; add
it later when a real consumer needs it. The data-attribute structure is
already in place to make a follow-up addition easy (the styled rules can
target `&:focus`/`&:focus-visible` on the header without ABI changes).

### C5 — Animations / transitions

**Concern.** Legacy uses `transition: flex 0.15s ease` on the panel wrapper
to animate expand/collapse. UIKit primitives generally avoid embedded
animations.

**Resolution.** Keep the transition — it's already in the legacy and is
a load-bearing part of the UX (sudden flex changes feel jarring in
production sidebars). Cost is one CSS line; no consumer surface impact.

### C6 — `headerRef` callback timing

**Concern.** The legacy `headerRef` callback receives the header element on
mount. Some children (e.g., `PageNavigator`'s panels) call `createPortal`
into this element. We must ensure the ref fires before the portal-target
consumer queries it.

**Resolution.** React guarantees ref callbacks fire on commit, BEFORE
parent effects in the children using portals. The legacy works correctly
already; the UIKit version uses the same callback shape — same timing.
Confirmed by inspecting the existing `PageNavigator` usage (the panel's
content uses `useEffect` which fires after the ref callback, so portal
targets are resolved by then).

### C7 — Migration scope — primitive only; per-screen retrofits happen later

Same model as US-503 / US-486 / US-516.

| Caller | Will be retrofitted by |
|---|---|
| `editors/notebook/NotebookEditor.tsx` | **US-512** (Notebook editor migration — currently on hold pending this task) |
| `editors/link-editor/LinkEditor.tsx` | Future LinkEditor migration task |
| `ui/navigation/PageNavigator.tsx` | Chrome sidebar; can be retrofitted at any time once primitive lands (chrome exception means the legacy is also valid; swapping is opportunistic) |

The legacy `components/layout/CollapsiblePanelStack.tsx` stays in place
until the last caller has migrated.

## Implementation plan

### Step 1 — Create the primitive

Files to create:
- `src/renderer/uikit/CollapsiblePanelStack/CollapsiblePanelStack.tsx` — both
  `CollapsiblePanel` and `CollapsiblePanelStack` per the design above.
- `src/renderer/uikit/CollapsiblePanelStack/index.ts`:
  ```ts
  export { CollapsiblePanel, CollapsiblePanelStack } from "./CollapsiblePanelStack";
  export type {
      CollapsiblePanelProps,
      CollapsiblePanelStackProps,
  } from "./CollapsiblePanelStack";
  ```

Files to edit:
- `src/renderer/uikit/index.ts` — add to public exports under "Layout
  primitives" (alphabetically near `Panel`):
  ```ts
  export { CollapsiblePanel, CollapsiblePanelStack } from "./CollapsiblePanelStack";
  export type {
      CollapsiblePanelProps,
      CollapsiblePanelStackProps,
  } from "./CollapsiblePanelStack";
  ```

### Step 2 — Storybook entry

Two parts:

**Part A — `src/renderer/uikit/CollapsiblePanelStack/CollapsiblePanelStack.story.tsx`**
(new file)

```tsx
import React, { useState } from "react";
import {
    CollapsiblePanel,
    CollapsiblePanelStack,
} from "./CollapsiblePanelStack";
import { Panel } from "../Panel/Panel";
import { IconButton } from "../IconButton/IconButton";
import { Story } from "../../editors/storybook/storyTypes";

const StackPreview = ({
    width = 240,
    initialActive = "tags",
}: {
    width?: number;
    initialActive?: string;
}) => {
    const [active, setActive] = useState(initialActive);
    return (
        <Panel direction="row" gap="xl" padding="xl" height={400}>
            <CollapsiblePanelStack
                activePanel={active}
                setActivePanel={setActive}
                width={width}
                minWidth={100}
                maxWidth="60%"
            >
                <CollapsiblePanel id="tags" title="Tags">
                    <div style={{ padding: 8 }}>
                        <p>Tags content. Click another header to collapse this panel.</p>
                        <p>Clicking the same header again returns to the previously expanded panel.</p>
                    </div>
                </CollapsiblePanel>
                <CollapsiblePanel id="categories" title="Categories">
                    <div style={{ padding: 8 }}>
                        <p>Categories content.</p>
                        <ul>
                            <li>Project</li>
                            <li>Settings</li>
                            <li>Dev</li>
                        </ul>
                    </div>
                </CollapsiblePanel>
                <CollapsiblePanel
                    id="hostnames"
                    title="Hostnames"
                    buttons={
                        <IconButton size="sm" title="Refresh" onClick={() => alert("refresh")}>
                            ⟳
                        </IconButton>
                    }
                >
                    <div style={{ padding: 8 }}>Hostnames content.</div>
                </CollapsiblePanel>
            </CollapsiblePanelStack>

            <Panel direction="column" gap="md">
                <span>Currently active: <strong>{active}</strong></span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                    Click a panel header to switch. Click the active header to go back.
                </span>
            </Panel>
        </Panel>
    );
};

export const collapsiblePanelStackStory: Story = {
    id: "collapsible-panel-stack",
    name: "CollapsiblePanelStack",
    section: "Layout",
    component: StackPreview as any,
    props: [
        { name: "width", type: "number", default: 240 },
        { name: "initialActive", type: "enum", options: ["tags", "categories", "hostnames"], default: "tags" },
    ],
};
```

**Part B — Register in `storyRegistry.ts`**

Edit `src/renderer/editors/storybook/storyRegistry.ts`:

1. Add an import alongside other Layout entries:
   ```ts
   import { collapsiblePanelStackStory } from "../../uikit/CollapsiblePanelStack/CollapsiblePanelStack.story";
   ```
2. Add `collapsiblePanelStackStory` to the `ALL_STORIES` array in the
   Layout section.

### Step 3 — Verification

- `npm run lint` — clean.
- `npx tsc --noEmit` — no new errors.
- `npm start` — open the Storybook editor, find `CollapsiblePanelStack`
  under "Layout", verify:
  - Three panels render; only one is expanded at a time.
  - Clicking a collapsed panel expands it; the previously-expanded one
    collapses.
  - Clicking the currently-expanded panel returns to the previously-
    expanded panel (back-navigation).
  - The third panel demonstrates the `buttons` slot — the chevron is
    hidden when buttons are present.
  - Width / minWidth / maxWidth props clamp the stack correctly when the
    parent Panel resizes.
  - PropertyEditor toggles update the preview live.

No call-site changes in this task.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/CollapsiblePanelStack/CollapsiblePanelStack.tsx` | New — both `CollapsiblePanel` and `CollapsiblePanelStack` |
| `src/renderer/uikit/CollapsiblePanelStack/CollapsiblePanelStack.story.tsx` | New — Storybook story |
| `src/renderer/uikit/CollapsiblePanelStack/index.ts` | New — public exports |
| `src/renderer/uikit/index.ts` | Add to public exports (Layout primitives) |
| `src/renderer/editors/storybook/storyRegistry.ts` | Import the story, add to `ALL_STORIES` (Layout) |

## Files NOT changed

- `src/renderer/components/layout/CollapsiblePanelStack.tsx` — legacy stays
  until all callers migrate; removed in epic-wide cleanup.
- `src/renderer/editors/notebook/NotebookEditor.tsx` — retrofit by **US-512**.
- `src/renderer/editors/link-editor/LinkEditor.tsx` — retrofit by future
  LinkEditor migration.
- `src/renderer/ui/navigation/PageNavigator.tsx` — retrofit can happen
  opportunistically; chrome exception means the legacy is also valid until
  swapped.
- Theme files — no new color tokens needed.

## Acceptance criteria

- [ ] `CollapsiblePanelStack` and `CollapsiblePanel` exist at
      `src/renderer/uikit/CollapsiblePanelStack/CollapsiblePanelStack.tsx`
      and are exported from `uikit/index.ts`.
- [ ] Storybook entry registered and renders all behaviors:
      panel switching, history-based back-navigation, `buttons` slot,
      `headerRef` callback (verify via the Storybook preview that ref fires).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] No regressions on the legacy `CollapsiblePanelStack` (none of its
      callers are touched in this task — verify by diff that the only
      changes are inside `src/renderer/uikit/CollapsiblePanelStack/`,
      one block in `src/renderer/uikit/index.ts`, and one block in
      `storyRegistry.ts`).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-512](../US-512-notebook-editor-migration/README.md)
  Notebook editor migration (on hold pending this task and US-516)
- Benefits: future LinkEditor migration; chrome `PageNavigator` opportunistic
  retrofit
- Same-pattern precedents: [US-503 Dot](../US-503-uikit-dot/README.md),
  [US-486 Splitter](../US-486-uikit-splitter/README.md),
  [US-516 Breadcrumb](../US-516-uikit-breadcrumb/README.md)
