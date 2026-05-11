# US-516: UIKit `Breadcrumb` primitive — hierarchical-path trail

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
UIKit primitive infrastructure. Unblocks
[US-512](../US-512-notebook-editor-migration/README.md) (Notebook editor
migration), and benefits future LinkEditor migration plus
[US-347](../../active-work.md) (CategoryView/CategoryEditor breadcrumb).

## Goal

Add a single UIKit primitive `Breadcrumb` at
`src/renderer/uikit/Breadcrumb/` that renders a clickable
hierarchical-path trail. It replaces the legacy
`src/renderer/components/basic/Breadcrumb.tsx` for any new code.

This task introduces the primitive only. Existing call sites stay on the
legacy component until their per-screen migration tasks pick them up — see
the ownership table in C5.

## Background

### Current legacy component

`src/renderer/components/basic/Breadcrumb.tsx` (115 LoC). Renders a
`<root> > <segment1> > <segment2> > <segment3>` trail where each segment is
clickable. Selecting a segment fires `onChange(pathUpToSegment)`; selecting
the root fires `onChange("")`.

Legacy API:

```ts
interface BreadcrumbProps {
    rootLabel: string;
    value: string;                        // "project/settings/dev"
    onChange: (value: string) => void;
    separators?: string;                  // path separators in `value`; default "/\\"
    trailingParentSeparator?: boolean;    // when true, click on non-leaf appends separator
    className?: string;
}
```

Implementation: single `styled.div` root, ~60 lines of CSS — flex row,
`color.text.light` for non-leaf, `color.misc.blue` for the current
(rightmost) segment, hover changes non-leaf to `color.text.default`. The
separator character `>` is hardcoded.

### Confirmed call sites

- **`src/renderer/editors/notebook/NotebookEditor.tsx`** — toolbar portal,
  switches between Categories trail (`>` separator) and Tags trail (`:`
  separator with `trailingParentSeparator`). Will migrate as part of
  **US-512**.
- **`src/renderer/editors/link-editor/LinkEditor.tsx`** — same toolbar
  portal pattern. Future task (no per-screen migration scheduled yet — will
  be tracked when LinkEditor migration is created).
- **CategoryView / CategoryEditor** — *not yet built*; tracked by
  **US-347** in the no-epic backlog. The Breadcrumb is a key part of that
  feature.

Three current/future consumers across three editors — the case for
consolidating into UIKit is clear.

### API quirks worth correcting

- **`className` prop** — drop. Rule 7 forbids `className` on UIKit
  components.
- **`separators: string`** — keep, but rename mental model: "characters in
  `value` that act as path separators". The first character in the string is
  used to join paths during click handling.
- **`trailingParentSeparator: boolean`** — keep. Used by Tags
  (`release:1.0.1` → clicking `release` produces `release:` not `release`).
- **Separator character `>`** — make it a prop so a future consumer can
  customize (e.g. `/`, `›`, an icon). Default stays `>` for parity.

### UIKit conventions to follow

- **Naming** — `value`/`onChange` for the primary scalar value; `rootLabel`
  for the leftmost label; `separators` (plural — string of allowed chars).
- **Rule 1 — `data-*` for state:** `data-type="breadcrumb"` on root; each
  segment span gets `data-part="root" | "separator" | "segment"` plus
  `data-current` on the rightmost (leaf) segment.
- **Rule 2 — controlled:** `value`/`onChange` only; no internal state.
- **Rule 7 — forbid `style`/`className` at the type level:** Props extends
  `Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">`.
- **Tokens:** colors from `color.ts` (`color.text.light`, `color.text.default`,
  `color.misc.blue`); spacing from `tokens.ts` (`spacing.xs` for the
  separator margins).

### Reference primitives

- `uikit/Tag/Tag.tsx` — small text-rendering primitive with semantic
  data-attributes; structurally simplest reference.
- `uikit/Divider/Divider.tsx` — visual sibling; same data-attribute style.
- `uikit/Tag/Tag.story.tsx` — minimal story shape (id, name, section,
  component, props array).

## Component design

File: `src/renderer/uikit/Breadcrumb/Breadcrumb.tsx`

```tsx
import React, { useCallback, useMemo } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, spacing } from "../tokens";
import { splitWithSeparators } from "../../core/utils/utils";

// --- Types ---

export interface BreadcrumbProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Label for the root/home element (e.g. "Categories"). */
    rootLabel: React.ReactNode;
    /** Current path value (e.g. "project/settings/dev"). Empty = only the root is shown. */
    value: string;
    /** Called with the new path when a segment is clicked. The root fires `""`. */
    onChange: (value: string) => void;
    /**
     * Characters in `value` that act as path separators. The FIRST character
     * is used to join paths when navigating. Default: "/\\".
     */
    separators?: string;
    /**
     * When true, clicking a non-leaf segment appends the separator (so
     * "release:1.0.1" clicked at `release` yields `release:`, distinguishing
     * a parent marker from a simple tag). Default: false.
     */
    trailingParentSeparator?: boolean;
    /** Visual separator between segments. Default: ">". */
    separatorContent?: React.ReactNode;
    /** Size variant. Default: "md". */
    size?: "sm" | "md";
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        alignItems: "center",
        color: color.text.light,
        '&[data-size="sm"]': { fontSize: fontSize.sm },
        '&[data-size="md"]': { fontSize: fontSize.base },

        '& [data-part="separator"]': {
            color: color.text.light,
            userSelect: "none",
            margin: `0 ${spacing.xs}px`,
        },
        '& [data-part="root"], & [data-part="segment"]': {
            cursor: "pointer",
            "&:hover": { color: color.text.default },
        },
        "& [data-current]": {
            color: color.misc.blue,
            cursor: "default",
            "&:hover": { color: color.misc.blue },
        },
    },
    { label: "Breadcrumb" },
);

// --- Component ---

export function Breadcrumb({
    rootLabel,
    value,
    onChange,
    separators = "/\\",
    trailingParentSeparator = false,
    separatorContent = ">",
    size = "md",
    ...rest
}: BreadcrumbProps) {
    const joinSeparator = separators[0];

    const segments = useMemo(() => {
        if (!value) return [];
        return splitWithSeparators(value, separators);
    }, [value, separators]);

    const handleClick = useCallback(
        (index: number) => {
            if (index < 0) {
                onChange("");
                return;
            }
            const path = segments.slice(0, index + 1).join(joinSeparator);
            const isLeaf = index === segments.length - 1;
            const finalPath =
                !isLeaf && trailingParentSeparator
                    ? path + joinSeparator
                    : path;
            onChange(finalPath);
        },
        [segments, onChange, joinSeparator, trailingParentSeparator],
    );

    return (
        <Root data-type="breadcrumb" data-size={size} {...rest}>
            <span
                data-part="root"
                data-current={segments.length === 0 || undefined}
                onClick={() => handleClick(-1)}
            >
                {rootLabel}
            </span>
            {segments.map((segment, index) => {
                const isLeaf = index === segments.length - 1;
                return (
                    <React.Fragment key={index}>
                        <span data-part="separator">{separatorContent}</span>
                        <span
                            data-part="segment"
                            data-current={isLeaf || undefined}
                            onClick={() => handleClick(index)}
                        >
                            {segment}
                        </span>
                    </React.Fragment>
                );
            })}
        </Root>
    );
}
```

Key changes vs. legacy:
- `className` removed (Rule 7).
- Props extended with `Omit<HTMLAttributes<HTMLDivElement>, "style"|"className">`
  so `data-*`, `aria-*`, `id`, `onMouseEnter` etc. flow through `{...rest}`.
- `data-current` on the root (when `value` is empty) AND on the leaf segment.
  In the legacy CSS, the root used a class flip; data attributes are cleaner.
- Logical rendering matches legacy exactly — same `splitWithSeparators` call,
  same trailing-separator behavior, same `>` default.
- New optional `separatorContent` (ReactNode) lets future consumers pass an
  icon or a different character without subclassing.
- New optional `size: "sm" | "md"` aligns with the rest of UIKit
  (Input, Button, Tag).

## Concerns

### C1 — Should `Breadcrumb` accept any HTMLAttributes prop via spread?

**Concern.** Following the spread-rest convention, `Breadcrumb` should
extend `HTMLAttributes<HTMLDivElement>` with Omit for owned props. The
owned/conflicting props are `style` and `className` (Rule 7). Nothing else
collides with the prop API.

**Resolution.** `Omit<HTMLAttributes<HTMLDivElement>, "style"|"className">`.
`onClick`, `aria-*`, `data-*`, `id`, `role` flow through automatically.

### C2 — Should the root be a button-like accessible widget?

**Concern.** Each segment is clickable. Should we wrap segments in real
`<button>` elements with `role="link"` and keyboard handling?

**Resolution.** No — keep as `<span>` with `onClick`. The legacy uses
`<span>` and the visual treatment (small text, blue current segment) is
better served as inline text. Keyboard accessibility for breadcrumbs is a
known nice-to-have but not a current consumer requirement; Rule 4 (roving
tabindex) explicitly applies to "keyboard-navigable widgets" — Breadcrumb is
a navigation aid, not a primary interactive widget. Add `tabIndex` /
keyboard handling later if a consumer asks.

### C3 — Should the separator be configurable via JSX or a prop?

**Concern.** Some future consumer might want a chevron icon, others a `/`.

**Resolution.** New `separatorContent: React.ReactNode` prop with default
`">"`. This avoids the more invasive "render-prop separator" pattern; a
ReactNode literal is sufficient. Cost: one extra prop, default behavior
unchanged.

### C4 — Size variants

**Concern.** Legacy hardcodes `fontSize: 13`. UIKit Input and Button expose
`size: "sm" | "md"`.

**Resolution.** Add `size: "sm" | "md"` matching UIKit conventions. Default
`"md"` (`fontSize.base`); `"sm"` is `fontSize.sm` (matches legacy `13` more
closely). Per-screen migrations choose what fits.

### C5 — Migration scope — primitive only; per-screen retrofits happen later

Same model as US-503/US-486: this task introduces the primitive and a
Storybook entry only.

| Caller | Will be retrofitted by |
|---|---|
| `editors/notebook/NotebookEditor.tsx` | **US-512** (Notebook editor migration — currently on hold pending this task) |
| `editors/link-editor/LinkEditor.tsx` | Future LinkEditor migration task (not yet planned) |
| Future CategoryView / CategoryEditor (US-347) | Built directly on UIKit `Breadcrumb` from day one |

The legacy `components/basic/Breadcrumb.tsx` stays in place until the last
caller has migrated, then it is removed in the epic-wide cleanup pass.

## Implementation plan

### Step 1 — Create the `Breadcrumb` primitive

Files to create:
- `src/renderer/uikit/Breadcrumb/Breadcrumb.tsx` — component per the design above.
- `src/renderer/uikit/Breadcrumb/index.ts` —
  ```ts
  export { Breadcrumb } from "./Breadcrumb";
  export type { BreadcrumbProps } from "./Breadcrumb";
  ```

Files to edit:
- `src/renderer/uikit/index.ts` — add to public exports under "Bootstrap
  components" (alphabetically near `Button`):
  ```ts
  export { Breadcrumb } from "./Breadcrumb";
  export type { BreadcrumbProps } from "./Breadcrumb";
  ```

### Step 2 — Storybook entry

Two parts (Storybook does not auto-discover):

**Part A — `src/renderer/uikit/Breadcrumb/Breadcrumb.story.tsx`** (new file)

Follow the established story shape:

```tsx
import React, { useState } from "react";
import { Breadcrumb } from "./Breadcrumb";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

const BreadcrumbPreview = ({
    rootLabel = "Categories",
    initialValue = "project/settings/dev",
    separators = "/\\",
    trailingParentSeparator = false,
    size = "md",
}: {
    rootLabel?: string;
    initialValue?: string;
    separators?: string;
    trailingParentSeparator?: boolean;
    size?: "sm" | "md";
}) => {
    const [value, setValue] = useState(initialValue);

    return (
        <Panel direction="column" gap="xl" padding="xl">
            <Panel direction="column" gap="sm">
                <span>Configurable (clicking segments updates value):</span>
                <Breadcrumb
                    rootLabel={rootLabel}
                    value={value}
                    onChange={setValue}
                    separators={separators}
                    trailingParentSeparator={trailingParentSeparator}
                    size={size}
                />
                <span style={{ fontSize: 12, opacity: 0.7 }}>value: "{value}"</span>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Static examples:</span>
                <Breadcrumb rootLabel="Categories" value="" onChange={() => {}} />
                <Breadcrumb rootLabel="Categories" value="release" onChange={() => {}} />
                <Breadcrumb rootLabel="Categories" value="release/1.0.1" onChange={() => {}} />
                <Breadcrumb rootLabel="Tags" value="release:1.0.1" onChange={() => {}} separators=":" trailingParentSeparator />
                <Breadcrumb rootLabel="Path" value="src/renderer/uikit/Breadcrumb" onChange={() => {}} separatorContent="/" />
                <Breadcrumb rootLabel="Path" value="src/renderer/uikit" onChange={() => {}} size="sm" />
            </Panel>
        </Panel>
    );
};

export const breadcrumbStory: Story = {
    id: "breadcrumb",
    name: "Breadcrumb",
    section: "Bootstrap",
    component: BreadcrumbPreview as any,
    props: [
        { name: "rootLabel", type: "string", default: "Categories" },
        { name: "initialValue", type: "string", default: "project/settings/dev" },
        { name: "separators", type: "string", default: "/\\" },
        { name: "trailingParentSeparator", type: "boolean", default: false },
        { name: "size", type: "enum", options: ["sm", "md"], default: "md" },
    ],
};
```

(Verify exact `Story` / `props` shape against `storyTypes.ts` and an
existing story like `Tag.story.tsx` at implementation time.)

**Part B — Register in `storyRegistry.ts`**

Edit `src/renderer/editors/storybook/storyRegistry.ts`:

1. Add an import alongside the other Bootstrap entries (alphabetical):
   ```ts
   import { breadcrumbStory } from "../../uikit/Breadcrumb/Breadcrumb.story";
   ```
2. Add `breadcrumbStory` to the `ALL_STORIES` array in the Bootstrap section.

### Step 3 — Verification

- `npm run lint` — clean.
- `npx tsc --noEmit` — no new errors.
- `npm start` — open the Storybook editor, find `Breadcrumb` in
  "Bootstrap", verify:
  - Empty `value` shows only the root, with the root marked current (blue).
  - Single-segment value shows root + ` > segment`.
  - Multi-segment shows full trail with only the leaf marked current.
  - Clicking the root clears `value`.
  - Clicking a non-leaf navigates up.
  - `separators=":" trailingParentSeparator=true` makes
    clicking `release` produce `release:` (visible in the value display).
  - Custom `separatorContent="/"` renders `/` instead of `>`.
  - Both `size="sm"` and `size="md"` render at correct font size.
  - PropertyEditor toggling each prop updates the preview live.

No call-site changes in this task — existing legacy callers stay in place
and are migrated by their owning per-screen tasks (see C5).

## Files Changed

| File | Change |
|---|---|
| `src/renderer/uikit/Breadcrumb/Breadcrumb.tsx` | New — `Breadcrumb` component |
| `src/renderer/uikit/Breadcrumb/Breadcrumb.story.tsx` | New — Storybook story (`breadcrumbStory` named export) |
| `src/renderer/uikit/Breadcrumb/index.ts` | New — public exports |
| `src/renderer/uikit/index.ts` | Add `Breadcrumb` to public exports |
| `src/renderer/editors/storybook/storyRegistry.ts` | Import `breadcrumbStory`, add to `ALL_STORIES` (Bootstrap) |

## Files NOT changed

- `src/renderer/components/basic/Breadcrumb.tsx` — legacy stays until all
  callers migrate; removed in epic-wide cleanup.
- `src/renderer/editors/notebook/NotebookEditor.tsx` — retrofit by **US-512**.
- `src/renderer/editors/link-editor/LinkEditor.tsx` — retrofit by future
  LinkEditor migration.
- Theme files — no new color tokens needed; existing
  `color.text.{light,default}` / `color.misc.blue` cover all states.

## Acceptance criteria

- [ ] `Breadcrumb` primitive exists at
      `src/renderer/uikit/Breadcrumb/Breadcrumb.tsx` and is exported from
      `uikit/index.ts`.
- [ ] Storybook entry registered and renders all variants:
      empty / single / multi-segment, default vs trailing-parent separator,
      custom separator content, `sm` and `md` sizes.
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] No regressions on the legacy `Breadcrumb` (none of its callers are
      touched in this task — verify by diff that the only changes are inside
      `src/renderer/uikit/Breadcrumb/`, one line in `src/renderer/uikit/index.ts`,
      and one block in `storyRegistry.ts`).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Unblocks: [US-512](../US-512-notebook-editor-migration/README.md)
  Notebook editor migration (on hold pending this task and US-517)
- Benefits: future LinkEditor migration; **US-347** CategoryView/Editor
  Breadcrumb (no-epic backlog)
- Same-pattern precedents: [US-503 Dot](../US-503-uikit-dot/README.md),
  [US-486 Splitter](../US-486-uikit-splitter/README.md)
