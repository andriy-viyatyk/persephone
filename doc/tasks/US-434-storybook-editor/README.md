# US-434: Storybook Editor — Component Browser, Live Preview, Property Editor

## Goal

Add a built-in **Storybook** editor: a singleton page that lists every UIKit component, renders the selected one in a live preview, and lets the user edit its props through a form. The editor is built using the UIKit components from US-427 and US-440 — implementing it dogfoods the library and surfaces visual issues.

This task delivers the **visual** storybook only (Phase 3a). The script tab for building UIs from descriptors is US-435 (Phase 3b).

## Background

### Where this fits in EPIC-025

Phases 1–2 are complete:

- **Phase 1 (US-426, US-427, US-439):** UIKit folder, design tokens, `CLAUDE.md` authoring guide, layout primitives (Flex, HStack, VStack, Panel, Card, Spacer).
- **Phase 2 (US-440):** Bootstrap components (Button, IconButton, Input, Label, Checkbox, Divider, Text).

These 13 components form the input set for the Storybook. Phase 4 components (Dialog, etc.) will register stories as they are added — the Storybook is also the testing tool for every later component.

Concern #2 in [EPIC-025.md](../../epics/EPIC-025.md) is resolved here: **stories are co-located** with the component file (`Button/Button.story.ts`) and registered through a central barrel imported by the editor.

### How standalone editors work in Persephone

A standalone editor is an `EditorModule` with its own `EditorModel` subclass, registered on `editorRegistry`. The pattern is well-established by `MCP Inspector` and `About`:

| File | Role |
|------|------|
| [`src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts`](../../../src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts) | `EditorModel` subclass; `noLanguage = true`, `skipSave = true` |
| [`src/renderer/editors/mcp-inspector/McpInspectorView.tsx`](../../../src/renderer/editors/mcp-inspector/McpInspectorView.tsx) | React component + `EditorModule` default export |
| [`src/renderer/editors/register-editors.ts`](../../../src/renderer/editors/register-editors.ts) | `editorRegistry.register({ id, editorType, category: "standalone", loadModule })` |
| [`src/renderer/api/pages/PagesLifecycleModel.ts`](../../../src/renderer/api/pages/PagesLifecycleModel.ts) `showMcpInspectorPage()` | Lazy-import module → `newEmptyEditorModel(editorType)` → `addPage(model)` |
| [`src/renderer/ui/sidebar/tools-editors-registry.ts`](../../../src/renderer/ui/sidebar/tools-editors-registry.ts) | `CreatableItem` so the page appears in the sidebar / new-tab menu |
| [`src/shared/types.ts`](../../../src/shared/types.ts) | New `EditorType` literal and `EditorView` literal |

The Storybook follows this pattern with a few key differences:

- **Singleton page.** Like `About`, it uses a fixed `STORYBOOK_PAGE_ID = "storybook-page"`. When `addPage()` is called with a page whose ID already exists, [`PagesLifecycleModel.addPage`](../../../src/renderer/api/pages/PagesLifecycleModel.ts) (around line 145) calls `findPage(page.id)` and focuses the existing tab.
- **No content pipe / no language.** Same as MCP Inspector and About.
- **`category: "standalone"`** — renders instead of `TextEditorView`.

### Existing UIKit components to register stories for

| Component | File | Variant/size axes | Notable props |
|-----------|------|-------------------|---------------|
| `Flex` | `src/renderer/uikit/Flex/Flex.tsx` | direction, wrap | gap, align, justify, padding |
| `HStack` | same file | — | gap, align, justify, padding |
| `VStack` | same file | — | gap, align, justify, padding |
| `Panel` | `src/renderer/uikit/Panel/Panel.tsx` | — | padding, gap |
| `Card` | `src/renderer/uikit/Card/Card.tsx` | — | padding, gap |
| `Spacer` | `src/renderer/uikit/Spacer/Spacer.tsx` | — | (orientation, flex) |
| `Button` | `src/renderer/uikit/Button/Button.tsx` | variant (default/primary/ghost/danger), size (sm/md) | disabled, icon, children |
| `IconButton` | `src/renderer/uikit/IconButton/IconButton.tsx` | size (sm/md) | disabled, icon (required) |
| `Input` | `src/renderer/uikit/Input/Input.tsx` | size (sm/md) | value, placeholder, disabled, readOnly |
| `Label` | `src/renderer/uikit/Label/Label.tsx` | — | required, disabled, children |
| `Checkbox` | `src/renderer/uikit/Checkbox/Checkbox.tsx` | — | checked, disabled, children |
| `Divider` | `src/renderer/uikit/Divider/Divider.tsx` | orientation (horizontal/vertical) | — |
| `Text` | `src/renderer/uikit/Text/Text.tsx` | variant (heading/body/caption/code) | children |

Phase 4 components (Dialog, Select, etc.) will register their own `*.story.ts` files when implemented.

### Design decisions resolved in this task

1. **Co-located story files.** Each UIKit component's folder gains a `Component.story.ts` file. A single barrel in `src/renderer/editors/storybook/storyRegistry.ts` imports them all and exposes the array.
2. **Story metadata is plain TypeScript** — not JSX. The `previewChildren` field, when present, is a function returning React nodes (e.g. for `Flex`, returns three sample boxes).
3. **Singleton page.** Re-opening Storybook focuses the existing tab.
4. **No persistence of state.** Selected component and prop values reset on app restart (`skipSave = true`). This matches MCP Inspector behavior.
5. **Children prop:** when a component declares `props: [..., { name: "children", type: "string" }]`, the property editor binds an Input to it and the story renders `{currentProps.children}` naturally.
6. **Icon prop:** for components that take an `icon` ReactNode (Button, IconButton), the property editor offers a small preset dropdown of icons from `src/renderer/theme/icons.tsx` (None / Folder / Plus / Save / Settings). Full icon picking is out of scope for Phase 3.
7. **Minimum prop type set:** `string`, `number`, `boolean`, `enum`, `icon`. Any prop outside this set is omitted from the editor (set its default in the story instead). Sufficient for all 13 bootstrap components.

## Implementation Plan

### Step 1 — Type literals and shared types

**File:** [`src/shared/types.ts`](../../../src/shared/types.ts)

Add `"storybookPage"` to the `EditorType` union and `"storybook-view"` to the `EditorView` union.

```ts
export type EditorType = "textFile" | ... | "videoPage" | "storybookPage";
export type EditorView = "monaco" | ... | "video-view" | "storybook-view";
```

### Step 2 — Story metadata types

**File:** `src/renderer/editors/storybook/storyTypes.ts` (create)

```ts
import React from "react";

export type PropDef =
    | { name: string; label?: string; type: "string"; default?: string; placeholder?: string }
    | { name: string; label?: string; type: "number"; default?: number; min?: number; max?: number; step?: number }
    | { name: string; label?: string; type: "boolean"; default?: boolean }
    | { name: string; label?: string; type: "enum"; options: readonly string[]; default?: string }
    | { name: string; label?: string; type: "icon"; default?: IconPresetId };

export type IconPresetId = "none" | "folder" | "plus" | "save" | "settings";

export interface Story<P = Record<string, unknown>> {
    /** Unique story ID, kebab-case. e.g. "button", "layout/flex". */
    id: string;
    /** Display name in the component browser. */
    name: string;
    /** Section heading for grouping. e.g. "Layout", "Bootstrap". */
    section: string;
    /** The component to render. */
    component: React.ComponentType<P>;
    /** Editable props. */
    props: PropDef[];
    /** Initial prop values; merged on top of PropDef defaults. */
    defaultProps?: Partial<P>;
    /** Optional sample children (for layout containers). When present and the component
     *  has no `children` prop in `props`, this function provides the preview body. */
    previewChildren?: () => React.ReactNode;
}
```

### Step 3 — Icon presets

**File:** `src/renderer/editors/storybook/iconPresets.tsx` (create)

```tsx
import React from "react";
import {
    FolderIcon, PlusIcon, SaveIcon, SettingsIcon,
} from "../../theme/icons";
import { IconPresetId } from "./storyTypes";

export const ICON_PRESETS: { id: IconPresetId; label: string; render: () => React.ReactNode }[] = [
    { id: "none",     label: "None",     render: () => null },
    { id: "folder",   label: "Folder",   render: () => <FolderIcon /> },
    { id: "plus",     label: "Plus",     render: () => <PlusIcon /> },
    { id: "save",     label: "Save",     render: () => <SaveIcon /> },
    { id: "settings", label: "Settings", render: () => <SettingsIcon /> },
];

export function resolveIconPreset(id: IconPresetId | undefined): React.ReactNode {
    if (!id || id === "none") return null;
    return ICON_PRESETS.find((p) => p.id === id)?.render() ?? null;
}
```

> **Verify before writing:** confirm the icon names exist in `src/renderer/theme/icons.tsx`. If a different name is exported (e.g. `AddIcon` instead of `PlusIcon`), update the import accordingly. The list of five presets is fixed; the names map to whichever icons exist.

### Step 4 — Story files (co-located with components)

Create one `*.story.ts` per UIKit component. Place each file in the component's own folder.

**Example: `src/renderer/uikit/Button/Button.story.ts`**

```ts
import { Button } from "./Button";
import { Story } from "../../editors/storybook/storyTypes";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";

export const buttonStory: Story = {
    id: "button",
    name: "Button",
    section: "Bootstrap",
    component: ((props: any) => {
        const { iconPreset, ...rest } = props;
        return Button({ ...rest, icon: resolveIconPreset(iconPreset) });
    }) as any,
    props: [
        { name: "children",  type: "string",  default: "Click me" },
        { name: "variant",   type: "enum",    options: ["default", "primary", "ghost", "danger"], default: "default" },
        { name: "size",      type: "enum",    options: ["sm", "md"], default: "md" },
        { name: "iconPreset",type: "icon",    default: "none", label: "Icon" },
        { name: "disabled",  type: "boolean", default: false },
    ],
};
```

The `iconPreset` prop is editor-only (not passed to `Button`); the wrapper component converts it to the real `icon` ReactNode. This keeps the story API JSON-friendly.

**Stories to create (13 total):**

| File | Section | Notes |
|------|---------|-------|
| `Flex/Flex.story.ts` | Layout | enum direction, number gap, enum align/justify, boolean wrap, number padding; `previewChildren` returns 3 colored boxes |
| `Flex/HStack.story.ts` | Layout | (uses HStack — re-export same file is fine) |
| `Flex/VStack.story.ts` | Layout | same |
| `Panel/Panel.story.ts` | Layout | number padding, number gap; previewChildren = `<Text>Sample content</Text>` |
| `Card/Card.story.ts` | Layout | same as Panel |
| `Spacer/Spacer.story.ts` | Layout | minimal; previewChildren wraps Spacer in HStack so it visualizes |
| `Button/Button.story.ts` | Bootstrap | as above |
| `IconButton/IconButton.story.ts` | Bootstrap | required `iconPreset` (default `"folder"`), `size`, `disabled` |
| `Input/Input.story.ts` | Bootstrap | string `value`, string `placeholder`, enum `size`, boolean `disabled`, boolean `readOnly` |
| `Label/Label.story.ts` | Bootstrap | string `children`, boolean `required`, boolean `disabled` |
| `Checkbox/Checkbox.story.ts` | Bootstrap | boolean `checked`, string `children`, boolean `disabled` |
| `Divider/Divider.story.ts` | Bootstrap | enum `orientation`; previewChildren wraps in a sized HStack/VStack so the line is visible |
| `Text/Text.story.ts` | Bootstrap | string `children`, enum `variant` |

For stories where the editor needs to wrap the component (e.g. add `previewChildren` to a Spacer or Divider so it visualizes), define an inline wrapper component as the `Story.component` that calls the real component plus context — see `Spacer.story.ts` template below.

**`Spacer.story.ts` template:**

```ts
import React from "react";
import { Spacer } from "./Spacer";
import { HStack } from "../Flex";
import color from "../../theme/color";
import { Story } from "../../editors/storybook/storyTypes";

const SpacerInPreview = (props: any) => (
    <HStack gap={4} align="center" style={{ width: 240, padding: 8, border: `1px dashed ${color.border.default}` }}>
        <span>Left</span>
        <Spacer {...props} />
        <span>Right</span>
    </HStack>
);

export const spacerStory: Story = {
    id: "spacer",
    name: "Spacer",
    section: "Layout",
    component: SpacerInPreview,
    props: [],
};
```

> **Why an inline wrapper instead of `previewChildren`:** Spacer's behavior depends on its container (it stretches via `flex: 1`). A wrapper guarantees a known parent layout for the preview. `previewChildren` is the simpler option for components that *contain* children (Panel, Card, Flex) and is preferred there.

### Step 5 — Story registry

**File:** `src/renderer/editors/storybook/storyRegistry.ts` (create)

Imports every story file and exposes a single ordered array. Centralized so the editor doesn't scan the filesystem.

```ts
import { Story } from "./storyTypes";

// Layout
import { flexStory }     from "../../uikit/Flex/Flex.story";
import { hstackStory }   from "../../uikit/Flex/HStack.story";
import { vstackStory }   from "../../uikit/Flex/VStack.story";
import { panelStory }    from "../../uikit/Panel/Panel.story";
import { cardStory }     from "../../uikit/Card/Card.story";
import { spacerStory }   from "../../uikit/Spacer/Spacer.story";

// Bootstrap
import { buttonStory }     from "../../uikit/Button/Button.story";
import { iconButtonStory } from "../../uikit/IconButton/IconButton.story";
import { inputStory }      from "../../uikit/Input/Input.story";
import { labelStory }      from "../../uikit/Label/Label.story";
import { checkboxStory }   from "../../uikit/Checkbox/Checkbox.story";
import { dividerStory }    from "../../uikit/Divider/Divider.story";
import { textStory }       from "../../uikit/Text/Text.story";

export const ALL_STORIES: Story[] = [
    flexStory, hstackStory, vstackStory, panelStory, cardStory, spacerStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
];

export function findStory(id: string): Story | undefined {
    return ALL_STORIES.find((s) => s.id === id);
}

export function storiesBySection(): Map<string, Story[]> {
    const out = new Map<string, Story[]>();
    for (const s of ALL_STORIES) {
        const list = out.get(s.section) ?? [];
        list.push(s);
        out.set(s.section, list);
    }
    return out;
}
```

### Step 6 — Storybook editor model

**File:** `src/renderer/editors/storybook/StorybookEditorModel.ts` (create)

```ts
import { IEditorState } from "../../../shared/types";
import { getDefaultEditorModelState, EditorModel } from "../base";
import { TComponentState } from "../../core/state/state";
import { ALL_STORIES, findStory } from "./storyRegistry";
import { Story, PropDef } from "./storyTypes";

export const STORYBOOK_PAGE_ID = "storybook-page";

export interface StorybookEditorState extends IEditorState {
    selectedStoryId: string;
    propValues: Record<string, unknown>;
}

export const getDefaultStorybookEditorState = (): StorybookEditorState => {
    const first = ALL_STORIES[0];
    return {
        ...getDefaultEditorModelState(),
        id: STORYBOOK_PAGE_ID,
        type: "storybookPage",
        title: "Storybook",
        selectedStoryId: first?.id ?? "",
        propValues: first ? buildInitialProps(first) : {},
    };
};

export function buildInitialProps(story: Story): Record<string, unknown> {
    const out: Record<string, unknown> = { ...story.defaultProps };
    for (const def of story.props) {
        if (out[def.name] !== undefined) continue;
        if ("default" in def && def.default !== undefined) {
            out[def.name] = def.default;
        }
    }
    return out;
}

export class StorybookEditorModel extends EditorModel<StorybookEditorState, void> {
    noLanguage = true;
    skipSave = true;

    selectStory = (id: string): void => {
        const story = findStory(id);
        if (!story) return;
        this.state.update((s) => {
            s.selectedStoryId = id;
            s.propValues = buildInitialProps(story);
        });
    };

    setPropValue = (name: string, value: unknown): void => {
        this.state.update((s) => {
            s.propValues = { ...s.propValues, [name]: value };
        });
    };

    resetProps = (): void => {
        const story = findStory(this.state.get().selectedStoryId);
        if (!story) return;
        this.state.update((s) => { s.propValues = buildInitialProps(story); });
    };
}
```

### Step 7 — Editor view + module

**File:** `src/renderer/editors/storybook/StorybookEditorView.tsx` (create)

Top-level layout (built with UIKit components):

```
┌──────────────────────────────────────────────────────────────┐
│  PageToolbar  │  Title: "Storybook"   │  [Reset Props]       │
├───────────────┬──────────────────────────┬───────────────────┤
│               │                          │                   │
│  Browser      │   Live Preview (center)  │  Property Editor  │
│  (left)       │                          │  (right)          │
│  width 200    │   flex: 1                │  width 280        │
│               │                          │                   │
└───────────────┴──────────────────────────┴───────────────────┘
```

Use:
- Outer wrapper `styled.div` (flex column, fills page)
- `PageToolbar` from `../base`
- `HStack` for the body row
- `VStack`/`Panel` for the three columns
- `Divider orientation="vertical"` between columns
- `Button`, `IconButton`, `Input`, `Label`, `Checkbox`, `Text` for the property editor

Default export: `EditorModule` (mirrors `mcpInspectorEditorModule` shape):

```ts
const storybookEditorModule: EditorModule = {
    Editor: StorybookEditorView,
    newEditorModel: async () =>
        new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState())),
    newEmptyEditorModel: async (editorType) => {
        if (editorType !== "storybookPage") return null;
        return new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState()));
    },
    newEditorModelFromState: async (state) => {
        const s: StorybookEditorState = { ...getDefaultStorybookEditorState(), ...(state as Partial<StorybookEditorState>) };
        return new StorybookEditorModel(new TComponentState(s));
    },
};

export default storybookEditorModule;
export { STORYBOOK_PAGE_ID };
```

### Step 8 — ComponentBrowser (left panel)

**File:** `src/renderer/editors/storybook/ComponentBrowser.tsx` (create)

- Uses `storiesBySection()` from `storyRegistry`
- Renders each section: `<Text variant="caption">{section}</Text>` followed by stacked `<Button variant="ghost" size="sm">` items. Active item gets `variant="primary"`.
- On click → `model.selectStory(id)`
- Width fixed at 200px; vertical scroll inside

### Step 9 — LivePreview (center panel)

**File:** `src/renderer/editors/storybook/LivePreview.tsx` (create)

```tsx
function LivePreview({ model }: { model: StorybookEditorModel }) {
    const s = model.state.use();
    const story = findStory(s.selectedStoryId);
    if (!story) return <Text variant="caption">Select a component</Text>;

    const Component = story.component;
    const props = s.propValues;
    const children = story.previewChildren?.();

    return (
        <Card padding={24} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Component {...props}>
                {children}
            </Component>
        </Card>
    );
}
```

If a story has both `previewChildren` and a `children` prop in `props`, the prop wins (controlled by user). Otherwise `previewChildren` provides the body.

### Step 10 — PropertyEditor (right panel)

**File:** `src/renderer/editors/storybook/PropertyEditor.tsx` (create)

Renders one row per `PropDef`:

| `PropDef.type` | UI |
|----------------|-----|
| `string` | `<Label>name</Label>` + `<Input value={...} onChange={...} />` |
| `number` | same shape, parses `Number(value)` on change |
| `boolean` | `<Checkbox checked={...} onChange={...}>name</Checkbox>` |
| `enum` | `<Label>name</Label>` + horizontal row of `<Button size="sm" variant={selected ? "primary" : "ghost"}>option</Button>` (one per option) |
| `icon` | `<Label>{def.label ?? "icon"}</Label>` + horizontal row of `<Button>` for each `ICON_PRESETS` entry, primary when selected |

Use `VStack gap={spacing.md}` for the column. Each row is its own `VStack gap={spacing.xs}` (Label above control).

### Step 11 — Register the editor

**File:** [`src/renderer/editors/register-editors.ts`](../../../src/renderer/editors/register-editors.ts)

Append a new registration after the MCP Inspector block:

```ts
// Storybook (standalone page editor — no file acceptance)
editorRegistry.register({
    id: "storybook-view",
    name: "Storybook",
    editorType: "storybookPage",
    category: "standalone",
    loadModule: async () => {
        const module = await import("./storybook/StorybookEditorView");
        return module.default;
    },
});
```

### Step 12 — Open the page

**File:** [`src/renderer/api/pages/PagesLifecycleModel.ts`](../../../src/renderer/api/pages/PagesLifecycleModel.ts)

Add a method next to `showMcpInspectorPage` (~line 785):

```ts
showStorybookPage = async (): Promise<void> => {
    const storybookModule = await import("../../editors/storybook/StorybookEditorView");
    const model = await storybookModule.default.newEmptyEditorModel("storybookPage");
    if (model) {
        const page = new PageModel(storybookModule.STORYBOOK_PAGE_ID);
        this.addPage(model, page);
    }
};
```

The fixed `STORYBOOK_PAGE_ID` makes this a singleton — if the page already exists, [`addPage`](../../../src/renderer/api/pages/PagesLifecycleModel.ts) (~line 144) calls `findPage` and focuses it.

### Step 13 — Sidebar / new-tab menu entry

**File:** [`src/renderer/ui/sidebar/tools-editors-registry.ts`](../../../src/renderer/ui/sidebar/tools-editors-registry.ts)

Add a `CreatableItem` to `staticItems` (after the `mcp-inspector` entry, around line 138):

```ts
{
    id: "storybook",
    label: "Storybook",
    icon: React.createElement(/* pick something existing — e.g. PaletteIcon or ComponentIcon if it exists */),
    create: () => { pagesModel.showStorybookPage(); },
    category: "tool",
},
```

> **Verify before writing:** check `src/renderer/theme/icons.tsx` for an icon that visually fits "component library / palette". Candidates: `PaletteIcon`, `ComponentIcon`, `BookIcon`. If none fits, fall back to `McpIcon`-style — pick one and adjust during implementation. **Do NOT add new icons** in this task; pick from what exists.

### Step 14 — Verify

- `npx tsc --noEmit` — zero new errors. (Pre-existing errors in `automation/`, `editors/link-editor/LinkTooltip.tsx`, `editors/video/*`, `scripting/worker/`, `ui/tabs/PageTab.tsx` are not US-434's concern.)
- `npm start`:
  - Sidebar / new-tab menu shows "Storybook" entry
  - Clicking it opens a tab titled "Storybook"
  - Re-clicking focuses the same tab (singleton)
  - All 13 components appear under "Layout" / "Bootstrap" sections
  - Clicking a component shows it in the center panel
  - Editing a string prop updates the preview in real time
  - Editing an enum/boolean prop updates the preview in real time
  - "Reset Props" button restores defaults
- All UIKit components in the editor itself render correctly (sanity check that the bootstrap components compose well — first real test of US-440 output).

## Concerns

1. **Story file location.** Co-located `Component.story.ts` files live inside `src/renderer/uikit/`, but they import from `editors/storybook/storyTypes.ts` and `iconPresets.tsx`. This creates a soft dependency from `uikit/` → `editors/`, which is the wrong direction for a component library. **Resolution:** acceptable because `storyTypes.ts` is type-only and `iconPresets.tsx` only references theme icons; neither imports any other editor. If this dependency direction proves problematic later, move `storyTypes.ts` to `src/renderer/uikit/story-types.ts` and the imports flip cleanly.

2. **Children prop typing.** The `Story.component` field is typed `React.ComponentType<P>` but `propValues` is `Record<string, unknown>`. The cast at the call site (`<Component {...props} />`) is unsafe by design — stories own their prop types. Adding generic safety would explode the registry types. **Resolution:** the unsafe cast is intentional and documented in `storyTypes.ts` comments.

3. **Singleton ID + state restore.** Because `skipSave = true`, the page itself is saved as part of `windowState` but its inner state (`selectedStoryId`, `propValues`) round-trips through `newEditorModelFromState` on app restart and resets each time. **Resolution:** acceptable — Storybook is a tool page; per-restart reset matches MCP Inspector behavior.

4. **Reset on app restart vs persisted.** Considered persisting `selectedStoryId` so a user returns to the same component. Decided against — adds complexity and the user can re-select in one click. Revisit if user feedback says otherwise.

5. **Phase 4 components extending the registry.** When a new component is added (e.g. Dialog in US-432), the implementer must (1) create `Dialog.story.ts` and (2) add the import + entry in `storyRegistry.ts`. **Resolution:** a single-line registry change is acceptable; the alternative (auto-discovery via Vite glob imports) adds bundling complexity for marginal benefit.

## Acceptance Criteria

- [ ] `EditorType` and `EditorView` updated with `"storybookPage"` and `"storybook-view"`
- [ ] `src/renderer/editors/storybook/` exists with `StorybookEditorModel.ts`, `StorybookEditorView.tsx`, `ComponentBrowser.tsx`, `LivePreview.tsx`, `PropertyEditor.tsx`, `storyTypes.ts`, `storyRegistry.ts`, `iconPresets.tsx`
- [ ] All 13 UIKit components have a `*.story.ts` file in their own folder
- [ ] `editorRegistry.register({ id: "storybook-view", ... })` is in `register-editors.ts`
- [ ] `pagesModel.showStorybookPage()` exists and opens/focuses a singleton tab
- [ ] Sidebar `CreatableItem` `"storybook"` exists in `tools-editors-registry.ts`
- [ ] The Storybook UI is built **only** from UIKit components (Panel, Card, Flex, HStack, VStack, Spacer, Button, IconButton, Input, Label, Checkbox, Divider, Text) — no `src/renderer/components/` imports in any new file
- [ ] Editing any prop updates the live preview without a manual refresh
- [ ] `npx tsc --noEmit` introduces no new errors
- [ ] [`active-work.md`](../active-work.md) and [`EPIC-025.md`](../../epics/EPIC-025.md) updated to link this task

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/shared/types.ts` | Edit | Add `"storybookPage"` to `EditorType`, `"storybook-view"` to `EditorView` |
| `src/renderer/editors/storybook/storyTypes.ts` | Create | `Story`, `PropDef`, `IconPresetId` |
| `src/renderer/editors/storybook/iconPresets.tsx` | Create | 5 preset icons |
| `src/renderer/editors/storybook/storyRegistry.ts` | Create | Imports and exports `ALL_STORIES`, `findStory`, `storiesBySection` |
| `src/renderer/editors/storybook/StorybookEditorModel.ts` | Create | Model + `STORYBOOK_PAGE_ID` |
| `src/renderer/editors/storybook/StorybookEditorView.tsx` | Create | Main view + `EditorModule` default export |
| `src/renderer/editors/storybook/ComponentBrowser.tsx` | Create | Left panel |
| `src/renderer/editors/storybook/LivePreview.tsx` | Create | Center panel |
| `src/renderer/editors/storybook/PropertyEditor.tsx` | Create | Right panel |
| `src/renderer/uikit/Flex/Flex.story.ts` | Create | |
| `src/renderer/uikit/Flex/HStack.story.ts` | Create | |
| `src/renderer/uikit/Flex/VStack.story.ts` | Create | |
| `src/renderer/uikit/Panel/Panel.story.ts` | Create | |
| `src/renderer/uikit/Card/Card.story.ts` | Create | |
| `src/renderer/uikit/Spacer/Spacer.story.ts` | Create | |
| `src/renderer/uikit/Button/Button.story.ts` | Create | |
| `src/renderer/uikit/IconButton/IconButton.story.ts` | Create | |
| `src/renderer/uikit/Input/Input.story.ts` | Create | |
| `src/renderer/uikit/Label/Label.story.ts` | Create | |
| `src/renderer/uikit/Checkbox/Checkbox.story.ts` | Create | |
| `src/renderer/uikit/Divider/Divider.story.ts` | Create | |
| `src/renderer/uikit/Text/Text.story.ts` | Create | |
| `src/renderer/editors/register-editors.ts` | Edit | Add `storybook-view` registration |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Edit | Add `showStorybookPage()` |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Edit | Add `"storybook"` `CreatableItem` |
| `doc/active-work.md` | Edit | Link US-434 to this README, move from Planned to Active position |
| `doc/epics/EPIC-025.md` | Edit | Update US-434 status row to Active + link |

### Files that need NO changes

- `src/renderer/uikit/index.ts` — story files don't need to be re-exported from the UIKit barrel; the storybook editor imports them directly
- `src/renderer/uikit/CLAUDE.md` — no rule changes needed
- `src/renderer/uikit/tokens.ts` — existing tokens sufficient
- `src/renderer/theme/color.ts` and `src/renderer/theme/themes/*.ts` — no new colors
- `src/renderer/theme/icons.tsx` — reuse existing icons only
- `src/renderer/editors/registry.ts` — no API changes; the new registration uses the existing `register()` method
- `src/renderer/editors/types.ts` — `EditorDefinition` and `EditorModule` are already adequate
- `src/renderer/api/pages/well-known-pages.ts` — Storybook uses a fixed `PageModel` ID (`STORYBOOK_PAGE_ID`) directly via the singleton check inside `addPage`, not the well-known-pages mechanism (which is for shared *content* pages, not standalone editors)
- All other UIKit component `.tsx` files — components themselves are unchanged
