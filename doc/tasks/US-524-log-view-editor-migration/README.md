# US-524: LogView editor — UIKit migration

## Status

**Plan ready for review.** Phase 4 per-screen migration under [EPIC-025](../../epics/EPIC-025.md). **Blocked on [US-529](../US-529-uikit-progress-bar/README.md)** — adds the inline `ProgressBar` primitive used by `output.progress` log entries.

## Goal

Migrate the LogView editor and all its embedded dialog / output item views to UIKit primitives. After this task, no file under `src/renderer/editors/log-view/` imports from `components/basic/`, `components/form/`, `components/layout/`, or `components/overlay/`, and no file (beyond unavoidable application-chrome exceptions) uses `@emotion/styled` directly.

LogView is the runtime UI surface for **all** scripts: every `console.log`, `log.confirm`, `log.input`, `log.buttons`, `log.checkboxes`, `log.select`, `log.progress`, `log.markdown`, `log.mermaid`, `log.grid`, `log.text`, and `log.mcpRequest` call lands here. Migrating it standardises the script runtime UI on UIKit and is the largest remaining script-facing surface in EPIC-025.

## Background

### Files in scope

Confirmed via direct read of every file in `editors/log-view/`:

**Top-level views (5 files):**

| File | Legacy deps | Notes |
|------|------------|-------|
| `LogViewEditor.tsx` | `components/basic/Button` (×2 — toolbar buttons), `ConfirmationDialog` from `ui/dialogs` | Local emotion chrome (`LogViewRoot`); RenderFlexGrid retained (not UIKit). |
| `LogEntryWrapper.tsx` | none (legacy) — pure emotion chrome | Per-entry accent-stripe (info/warn/error/success). |
| `LogEntryContent.tsx` | none — pure dispatcher | `EntryErrorBoundary` + stub fallbacks; inline `React.CSSProperties` for stub styles. |
| `LogMessageView.tsx` | none — emotion chrome only | Per-level text-colour (log/info/warn/error/success). |
| `StyledTextView.tsx` | none | Pure `<span>` renderer for `StyledText`. No UIKit deps. |

**Item views — dialogs (6 files):**

| File | Legacy deps |
|------|------------|
| `items/DialogContainer.tsx` | none — emotion chrome (active vs resolved border). |
| `items/DialogHeader.tsx` | none — emotion chrome (small muted header). |
| `items/ConfirmDialogView.tsx` | none — composes `DialogContainer` + `ButtonsPanel`. |
| `items/ButtonsDialogView.tsx` | none — composes `DialogContainer` + `DialogHeader` + `ButtonsPanel`. |
| `items/ButtonsPanel.tsx` | `components/basic/Button` (×N). Custom `!`-prefix "required" parsing + `CheckIcon` for chosen-button. |
| `items/CheckboxesDialogView.tsx` | `components/basic/Checkbox`. |
| `items/RadioboxesDialogView.tsx` | `components/basic/Radio`. |
| `items/SelectDialogView.tsx` | `components/form/ComboSelect`. |
| `items/TextInputDialogView.tsx` | `components/basic/TextField`. |

**Item views — output (6 files):**

| File | Legacy deps |
|------|------------|
| `items/ProgressOutputView.tsx` | `components/basic/CircularProgress` + inline emotion `<div>` track/fill. |
| `items/GridOutputView.tsx` | `components/basic/Button` (hover action). `AVGrid` is out of scope. |
| `items/TextOutputView.tsx` | `components/basic/Button` (hover action). Monaco editor stays. |
| `items/MarkdownOutputView.tsx` | `components/basic/Button` (hover action). `MarkdownBlock` stays. |
| `items/MermaidOutputView.tsx` | `components/basic/Button` (×2 hover actions). Mermaid renderer stays. |
| `items/McpRequestView.tsx` | none — custom collapsible card with rich multi-piece header. |

**Other (1 file):**

| File | Notes |
|------|-------|
| `LogViewContext.ts` | React context — no UI deps. No changes. |
| `LogViewModel.ts` | View model — no UI deps. No changes. |
| `logTypes.ts` | Types — script-facing API contract. **No prop-shape changes allowed.** |
| `logConstants.ts` | `DIALOG_CONTENT_MAX_HEIGHT = 400`. No changes. |

### UIKit primitive availability

All primitives needed (except inline `ProgressBar`) are landed:

| Need | UIKit primitive | Notes |
|------|----------------|-------|
| Active / resolved bordered frame | `Panel border borderColor="active" / "default"` | Panel already supports both colours. |
| Toolbar icon button | `IconButton` | Replaces `<Button type="icon">`. |
| Action button (raised) | `Button variant="default"` or `"primary"` | Replaces `<Button type="raised">`. |
| Checkbox | `Checkbox` | `(checked: boolean) => void`. |
| Radio list | `RadioGroup` | Items as `IRadio[]` (`{ value, label }`). Replaces N × legacy `Radio`. |
| Searchable single-value dropdown | `Select` | Replaces `ComboSelect`. Missing `adjustWithCharWidth` — see Concerns. |
| Text input | `Input` | `(value: string) => void`; supports `onKeyDown` via rest spread. |
| Indeterminate spinner | `Spinner` | Replaces `CircularProgress`. |
| Inline linear progress | **`ProgressBar` (US-529 — new)** | Determinate / indeterminate / completed states. |
| `name?` debug prop | All primitives | Use per US-521 convention. |

### Risk surface

LogView is the runtime UI for **every script**. A regression here breaks every script's interactive dialogs and output rendering. Two locked contracts:

1. **`logTypes.ts` interfaces are script API** — entries are serialized to JSONL, persisted in the page content, and consumed by `UiFacade` (`scripting/api-wrapper/UiFacade.ts`) which scripts call as `log.*`. No type field renames, no new required fields. Adding optional fields is fine.

2. **Item view prop shapes** — invoked via the dispatch table in `LogEntryContent.tsx`. The agent that emits a log entry passes an entry of a specific shape; the View consumes those fields directly. Keep the `{ entry, updateEntry? }` signature unchanged for every item view.

### Reference migrations

- **US-523 LinkEditor** — most recent per-screen migration; same migration patterns (Panel borders, hover-reveal IconButtons, Tooltip integration). Reuse the same playbook.
- **US-477 Progress dialog** — UIKit `Progress` (overlay) primitive. This task uses the new `ProgressBar` (inline) — they are complementary, not overlapping.
- **US-502 MCP Inspector** — closest analogue for `McpRequestView` look-and-feel parity.
- **US-432 Dialog component** — dialog-shell pattern. Note: log-stream "dialogs" render **inline** in the log, not as modals. Reuse `DialogHeader` styling pattern but **not** UIKit `Dialog` host.

## Implementation plan

The migration proceeds bottom-up — leaf utilities first, then composites, then the host editor — so each layer has its dependencies migrated when reached.

### Phase 0 — UIKit Panel extension: `accent` prop (per C1)

Add a new prop to `src/renderer/uikit/Panel/Panel.tsx`:

```ts
/**
 * When set, paints a 3 px left stripe in the corresponding accent colour.
 * Used to flag status-tinted rows (log levels, alerts, validation severities).
 */
accent?: "info" | "warn" | "error" | "success";
```

Implementation:

- Emit `data-accent={accent}` on the root.
- Add styled rules:
  ```ts
  '&[data-accent="info"]':    { borderLeft: `3px solid ${color.misc.blue}` },
  '&[data-accent="warn"]':    { borderLeft: `3px solid ${color.misc.yellow}` },
  '&[data-accent="error"]':   { borderLeft: `3px solid ${color.misc.red}` },
  '&[data-accent="success"]': { borderLeft: `3px solid ${color.misc.green}` },
  ```
- Update the Storybook story `src/renderer/uikit/Panel/Panel.story.tsx` to expose `accent` as an `"enum"` PropDef with options `["", "info", "warn", "error", "success"]` (empty string maps to undefined in the property editor).

This stays a single focused extension — no `borderLeftWidth` prop, no semantic `borderColor` expansion. If a future caller needs a different accent width, that can be added then.

### Phase 1 — Leaf chrome primitives (DialogContainer, DialogHeader)

#### 1.1 `items/DialogContainer.tsx` → UIKit `Panel`

Replace the entire `ContainerRoot` emotion frame with `Panel`:

```tsx
// Before
<ContainerRoot className={resolved ? "resolved" : "active"}>
    {children}
</ContainerRoot>

// After
<Panel
    name="log-dialog-container"
    direction="column"
    border
    borderColor={resolved ? "default" : "active"}
    rounded="md"
    overflow="hidden"
    width="fit-content"
    maxWidth="100%"
    style={{ margin: "2px 0" }}    // ← NOT allowed; rewrite via paddingY?
>
    {children}
</Panel>
```

`margin: 2px 0` on the outer is decorative spacing between log entries — apply via the parent `LogEntryContent`'s container instead (a `Panel` with `paddingY="xs"` around the dispatched child). **Verify**: `LogEntryWrapper` already provides `padding: 0 12px`; the 2 px vertical margin between consecutive dialogs is currently a `margin` on `DialogContainer`. Move that to `LogEntryWrapper`'s entry-content panel (`paddingY="xxs"` if available, else `paddingTop`/`paddingBottom`).

#### 1.2 `items/DialogHeader.tsx` → UIKit `Panel` + `Text`

Replace `HeaderRoot` with `Panel`:

```tsx
// Before
<HeaderRoot>
    <StyledTextView text={title} />
</HeaderRoot>

// After
<Panel
    name="log-dialog-header"
    background="dark"
    paddingX="sm"
    paddingY="xs"
>
    <Text size="sm" tone="muted">
        <StyledTextView text={title} />
    </Text>
</Panel>
```

Verify `Text` accepts a `tone` / `colour` prop or equivalent muted-text variant; if not, use `<Text color="light">` or add a `tone="muted"` prop in a small extension (single-line addition — not worth a precursor task).

### Phase 2 — Button row (ButtonsPanel)

#### 2.1 `items/ButtonsPanel.tsx` → UIKit `Button` + `Panel`

Replace `PanelRoot` with `Panel` and `<Button type="raised">` with UIKit `<Button>`:

```tsx
<Panel
    name="log-buttons-panel"
    direction="row"
    gap="sm"
    paddingX="sm"
    paddingY="xs"
    wrap
>
    {parsed.map((btn) => {
        const isResult = resolved && button === btn.label;
        const disabled = resolved || (btn.required && requirementNotMet);
        return (
            <Button
                name={`log-button-${btn.label}`}
                key={btn.label}
                size="sm"
                variant="default"
                disabled={disabled}
                onClick={() => handleClick(btn.label)}
                icon={isResult ? <CheckIcon /> : undefined}
            >
                {btn.label}
            </Button>
        );
    })}
</Panel>
```

The CheckIcon-for-resolved-button affordance is preserved using `Button.icon` (Button renders the icon before children — same visual order as the legacy `<span className="btn-check"><CheckIcon /></span>{label}`).

The legacy `!`-prefix parsing in `parseButtons` stays unchanged — pure helper, no UI.

### Phase 3 — Inline form-control dialogs (Checkboxes, Radios, Select, TextInput)

#### 3.1 `items/CheckboxesDialogView.tsx` → UIKit `Checkbox`

Replace `<Checkbox className="checkbox-item">` × N with UIKit `<Checkbox>` × N inside a `Panel` row/column container:

```tsx
<Panel
    name="log-checkbox-list"
    direction={layout === "flex" ? "row" : "column"}
    wrap={layout === "flex"}
    gap={layout === "flex" ? "md" : "xs"}
    paddingX="sm"
    paddingY="xs"
    maxHeight={DIALOG_CONTENT_MAX_HEIGHT}
    overflowY="auto"
>
    {entry.items.map((item, i) => (
        <Checkbox
            name={`log-checkbox-${i}`}
            key={i}
            checked={item.checked ?? false}
            disabled={resolved}
            onChange={() => handleToggle(i)}
        >
            {item.label}
        </Checkbox>
    ))}
</Panel>
```

UIKit `Checkbox.onChange: (checked: boolean) => void` — adapt `handleToggle` to ignore the boolean argument and just toggle the existing draft value.

#### 3.2 `items/RadioboxesDialogView.tsx` → UIKit `RadioGroup`

UIKit `RadioGroup` takes `items: IRadio[]` (`{ value, label }`) — map `string[]` → `IRadio[]`:

```tsx
const radioItems = useMemo(
    () => entry.items.map((label) => ({ value: label, label })),
    [entry.items],
);

<RadioGroup
    name="log-radio-group"
    items={radioItems}
    value={entry.checked ?? ""}
    onChange={handleSelect}
    orientation={layout === "flex" ? "horizontal" : "vertical"}
    wrap={layout === "flex"}
    gap="xs"
    disabled={resolved}
/>
```

`value=""` when `entry.checked` is undefined — RadioGroup's `data-checked` comparison falls through, no item is selected. Verified by reading `RadioGroup.tsx`.

The legacy max-height-with-scroll wrapper around the radio list — wrap `<RadioGroup>` in a `Panel maxHeight={DIALOG_CONTENT_MAX_HEIGHT} overflowY="auto" paddingX="sm" paddingY="xs"`.

#### 3.3 `items/SelectDialogView.tsx` → UIKit `Select`

```tsx
const selectItems = useMemo(
    () => entry.items.map((label) => ({ key: label, label })),
    [entry.items],
);

<Panel name="log-select-control" paddingX="sm" paddingY="xs">
    <Select
        name="log-select"
        items={selectItems}
        value={entry.selected ? { key: entry.selected, label: entry.selected } : null}
        onChange={(item) => handleSelect(item?.key as string | undefined)}
        placeholder={entry.placeholder}
        disabled={resolved}
        minWidth={200}
    />
</Panel>
```

Verify the exact `Select.items` / `value` / `onChange` shape against `SelectModel.ts` — `IListBoxItem` is the default item type; an item with `{ key, label }` should map directly. **Drop `adjustWithCharWidth`** — Select fills the container's width up to `maxWidth` (parent dialog has its own `minWidth: 200` per the legacy code).

#### 3.4 `items/TextInputDialogView.tsx` → UIKit `Input`

```tsx
<Panel name="log-text-input-field" paddingX="sm" paddingY="xs">
    <Input
        name="log-text-input"
        value={currentValue}
        onChange={handleTextChange}
        placeholder={entry.placeholder}
        disabled={resolved}
        onKeyDown={handleKeyDown}
        width="100%"
    />
</Panel>
```

UIKit `Input.onChange: (value: string) => void` — matches the legacy `TextField`'s already-curried signature. `onKeyDown` flows through `...rest`. `entry.title` continues to render via `<DialogHeader title={entry.title} />`.

### Phase 4 — Output views (Progress, Grid, Text, Markdown, Mermaid, MCP request)

#### 4.1 `items/ProgressOutputView.tsx` → UIKit `ProgressBar` (US-529)

```tsx
<Panel
    name="log-progress"
    direction="column"
    paddingY="xxs"
    gap="xxs"
>
    {label && (
        <Panel direction="row" align="center" gap="sm">
            <Text size="sm"><StyledTextView text={label} /></Text>
        </Panel>
    )}
    <ProgressBar
        name="log-progress-bar"
        value={indeterminate ? undefined : value}
        max={max}
        completed={completed}
        width={160}
    />
    {value != null && !completed && (
        <Text size="xs" tone="muted">{value} / {max}</Text>
    )}
</Panel>
```

`ProgressBar` handles all three modes internally (indeterminate when `value` undefined and `!completed`, determinate when value set, success-coloured when `completed`). The legacy separate-spinner-when-indeterminate is gone — the bar itself animates.

#### 4.2 `items/GridOutputView.tsx` — IconButton hover action

Replace the outer `GridOutputRoot` with `Panel revealChildrenOnHover`. Replace the hover `<Button type="icon">` with UIKit `IconButton hideUntilParentHover`:

```tsx
<Panel
    name="log-grid-output"
    direction="column"
    position="relative"
    border
    rounded="md"
    overflow="hidden"
    width="fit-content"
    maxWidth="100%"
    revealChildrenOnHover
>
    <DialogHeader title={entry.title} />
    <AVGrid {...avGridProps} />
    <Panel
        name="log-grid-hover-actions"
        position="absolute" top={4} right={4}
        zIndex={1}
    >
        <IconButton
            name="log-grid-open-in-editor"
            hideUntilParentHover
            size="sm"
            icon={<OpenLinkIcon />}
            title="Open in Grid editor"
            onClick={handleOpenInGrid}
        />
    </Panel>
</Panel>
```

`AVGrid` is **out of scope** — it stays as-is. Only the chrome migrates.

#### 4.3 `items/TextOutputView.tsx` — same pattern as GridOutputView

Monaco editor host stays unchanged. Outer chrome → `Panel revealChildrenOnHover` + `IconButton hideUntilParentHover`. The `containerRef`-bound `<div className="text-editor-container">` stays as a plain `<div>` (Monaco needs raw DOM, not UIKit-managed).

#### 4.4 `items/MarkdownOutputView.tsx` — same pattern

`MarkdownBlock` stays unchanged. Outer chrome → `Panel revealChildrenOnHover` + `IconButton hideUntilParentHover`.

#### 4.5 `items/MermaidOutputView.tsx` — same pattern (2 hover buttons)

Mermaid renderer (`renderMermaidSvg`, `svgToDataUrl`, the `<img>`) stays. Outer chrome → `Panel revealChildrenOnHover` + 2 × `IconButton hideUntilParentHover` (open in editor + copy image).

#### 4.6 `items/McpRequestView.tsx` — inline collapsible

**Decision: inline implementation, not `CollapsiblePanelStack`.** `CollapsiblePanelStack.handleToggle` deliberately prevents a single-item stack from collapsing to zero (always falls back to keep one panel open), so it cannot host the McpRequest's "click-to-toggle, can be fully closed" semantic. Inline implementation:

```tsx
<Panel
    name="log-mcp-request"
    direction="column"
    style={{ fontSize: 13, lineHeight: "20px", fontFamily: "Consolas, 'Courier New', monospace" }}
    // ↑ style not allowed on Panel — use Panel props or wrap in plain <div> inside log-view chrome exception?
>
```

Actually `Panel` forbids `style` and `className`. The font/typography constraint is intrinsic to the log stream and is set on parent containers. Use plain UIKit `Panel` with `direction` + `paddingX` etc. and rely on the parent `<LogEntryWrapper>` for the font family.

Header row (clickable):

```tsx
<Panel
    name="log-mcp-header"
    direction="row" align="center" gap="sm"
    paddingX="sm" paddingY="xxs"
    onClick={() => setExpanded(v => !v)}
    // pass cursor:pointer + hover via a Button variant="link" or
    // an explicit IconButton row? — see concerns
>
    <IconButton
        name="log-mcp-toggle"
        size="sm"
        variant="ghost"
        icon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
    />
    <Text weight="semibold">{entry.method}</Text>
    {detail && <Text tone="muted" truncate>{detail}</Text>}
    {hasError && <Text tone="danger" weight="semibold">ERROR</Text>}
    <Spacer />
    <Text tone="muted" size="xs">{entry.durationMs}ms</Text>
</Panel>
```

Body (Request / Response cards when expanded):

```tsx
{expanded && (
    <Panel
        name="log-mcp-card"
        direction="column"
        border rounded="md" overflow="hidden"
        paddingY="xs"  paddingLeft="lg"
    >
        <Panel name="log-mcp-request-section" direction="column">
            <Panel background="dark" paddingX="md" paddingY="xxs">
                <Text size="xs" tone="muted" uppercase>Request</Text>
            </Panel>
            <Panel maxHeight={180} overflowY="auto">
                {entry.params != null ? (
                    <ColorizedCode code={JSON.stringify(entry.params, null, 2)} language="json" tabSize={2} />
                ) : (
                    <Text paddingX="md" paddingY="xs" tone="muted">(no params)</Text>
                )}
            </Panel>
        </Panel>
        <Divider />
        <Panel name="log-mcp-response-section" direction="column">
            <Panel background="dark" paddingX="md" paddingY="xxs">
                <Text size="xs" tone="muted" uppercase>Response</Text>
            </Panel>
            <Panel maxHeight={180} overflowY="auto">
                {hasError
                    ? <Text paddingX="md" paddingY="xs" tone="danger">{entry.error}</Text>
                    : entry.result != null
                        ? <ColorizedCode code={JSON.stringify(entry.result, null, 2)} language="json" tabSize={2} />
                        : <Text paddingX="md" paddingY="xs" tone="muted">(no result)</Text>
                }
            </Panel>
        </Panel>
    </Panel>
)}
```

`ColorizedCode` stays as-is (already migrated in US-516/517 reach).

### Phase 5 — Per-entry chrome (LogEntryWrapper, LogMessageView)

#### 5.1 `LogEntryWrapper.tsx` — `Panel accent=…` (per C1)

Use the new `Panel.accent` prop (added inline in this task — see Phase 0). `WrapperRoot` styled component is deleted entirely.

```tsx
const accentForEntryType = (type: string): "info" | "warn" | "error" | "success" | undefined => {
    switch (type) {
        case "log.info":    return "info";
        case "log.warn":    return "warn";
        case "log.error":   return "error";
        case "log.success": return "success";
        default: return undefined;
    }
};

export function LogEntryWrapper({ vm, index, cellRef, showTimestamp }: LogEntryWrapperProps) {
    const entry = vm.state.use((s) => s.entries[index]);
    const updateEntry = useCallback(...);

    if (!entry) return null;

    return (
        <Panel
            name="log-entry-wrapper"
            ref={cellRef}
            direction="row"
            align="start"
            paddingX="lg"
            gap="md"
            accent={accentForEntryType(entry.type)}
        >
            {showTimestamp && entry.timestamp != null && (
                <Text size="sm" color="light" name="entry-timestamp">
                    {formatTimestamp(entry.timestamp)}
                </Text>
            )}
            <Panel name="entry-content" flex={1} minWidth={0} direction="column">
                <LogEntryContent entry={entry} updateEntry={updateEntry} />
            </Panel>
        </Panel>
    );
}
```

The monospace `fontFamily` from `WrapperRoot` is dropped — Persephone's `GlobalStyles` already sets monospace app-wide (`project_default_font` memory).

#### 5.2 `LogMessageView.tsx` — `Text color=…` (per C2)

Use existing `Text` colour variants — **no UIKit extension needed**. `LogMessageRoot` styled component is deleted entirely.

```tsx
const colorForLevel = (type: string): "default" | "light" | "primary" | "warning" | "error" | "success" => {
    switch (type) {
        case "log.log":     return "light";
        case "log.info":    return "primary";
        case "log.warn":    return "warning";
        case "log.error":   return "error";
        case "log.success": return "success";
        default:            return "default";
    }
};

export function LogMessageView({ entry }: { entry: LogMessageEntry }) {
    return (
        <Text
            name="log-message"
            color={colorForLevel(entry.type)}
            preWrap
            size="base"
        >
            <StyledTextView text={entry.text} />
        </Text>
    );
}
```

Notes:

- `Text.preWrap` is `white-space: pre-wrap` — same semantic as legacy `LogMessageRoot.whiteSpace`.
- `word-break: break-word` from legacy is not exposed as a `Text` prop. If broken long URLs/hashes overflow horizontally during smoke testing, wrap the Text in `<Panel wordBreak="break-word">{…}</Panel>` (Panel already exposes `wordBreak`).
- Legacy `minHeight: 18` is no longer needed — empty log messages collapse naturally and that's fine.

### Phase 6 — Host editor (LogViewEditor)

#### 6.1 `LogViewEditor.tsx` — toolbar buttons + outer chrome

Replace toolbar `<Button size="small" type="icon">` × 2 (Clear, Toggle timestamps) with UIKit `IconButton`:

```tsx
<IconButton
    name="log-clear"
    size="sm"
    icon={<ClearIcon />}
    title="Clear log"
    onClick={async () => {
        const result = await showConfirmationDialog({ message: "Clear all log entries?" });
        if (result === "Yes") vm.clear();
    }}
/>
<IconButton
    name="log-toggle-timestamps"
    size="sm"
    icon={<TimestampIcon active={state.showTimestamps} />}
    title={state.showTimestamps ? "Hide timestamps" : "Show timestamps"}
    onClick={vm.toggleTimestamps}
/>
```

Replace `LogViewRoot` (the outer `display: flex; flex-direction: column; flex: 1 1 auto; overflow: hidden`) with `<Panel direction="column" flex={1} overflow="hidden">`. The "no log entries" placeholder becomes `<Panel flex={1} align="center" justify="center"><Text tone="muted">No log entries</Text></Panel>`.

`RenderFlexGrid` stays as-is — it's a virtualization primitive, not a UIKit candidate.

### Phase 7 — `LogEntryContent.tsx` — dispatch wrapper (C4) + stub fallbacks

#### 7.1 — Wrap dialog / output dispatch in `paddingY="xs"` (per C4)

`LogEntryContent` is the dispatcher. When the dispatched entry is a dialog (`isDialogEntry`) or output (`isOutputEntry`), wrap the returned View in a `Panel paddingY="xs"` (2 px = `spacing.xs`) — preserves the 2 + 2 = 4 px gap that legacy `margin: 2px 0` produced between RenderFlexGrid cells. Plain log messages render without the wrapper (no extra gap → preserves console-density).

```tsx
function LogEntryContentInner({ entry, updateEntry }: LogEntryContentProps) {
    if (isLogEntry(entry)) {
        return <LogMessageView entry={entry} />;
    }
    const view = dispatchedView(entry, updateEntry);
    if (isDialogEntry(entry) || isOutputEntry(entry)) {
        return <Panel name="log-item-wrapper" paddingY="xs">{view}</Panel>;
    }
    return view;
}
```

`dispatchedView` collapses the two existing `switch` blocks into one helper. Per-item chrome (`DialogContainer`, `GridOutputView`, etc.) drops its `margin: "2px 0"` entirely.

#### 7.2 — Stub fallbacks

Replace inline `<div style={errorStyle}>` and `<div style={stubStyle}>` with `<Text color="error">` / `<Text color="light">` (per C2 mapping). The `EntryErrorBoundary` class component stays — error-boundary semantics require a class component, no UIKit equivalent.

### Phase 8 — `name=` debug attribute pass (US-521 / US-522)

Apply `name=` to every migrated UIKit primitive per US-521. Prefer script-author-facing names (e.g. `log-confirm-yes`, `log-progress-bar`, `log-input-ok`, `log-mcp-toggle`). Done inline as primitives are added during phases 1–7, not as a separate pass.

### Phase 9 — Verification

- `npx tsc --noEmit` — baseline unchanged.
- `npm run lint` — baseline unchanged.
- Grep verification: `rg "from \"\\.\\./\\.\\./components/(basic|form|layout|overlay)" src/renderer/editors/log-view/` returns empty.
- Grep verification: `rg "@emotion/styled" src/renderer/editors/log-view/` returns either empty or only the documented `LogEntryWrapper` chrome exception (subject to Concern #1 below).
- Manual smoke (script runtime): exercise every log entry type — `log.log`, `log.info`, `log.warn`, `log.error`, `log.success`, `log.confirm`, `log.input`, `log.buttons`, `log.checkboxes` (vertical + flex), `log.radioboxes` (vertical + flex), `log.select`, `log.progress` (determinate, indeterminate, completed), `log.text`, `log.markdown`, `log.mermaid`, `log.grid`, `log.mcpRequest`. Verify auto-scroll, force-scroll on dialog, timestamps toggle, clear-with-confirmation.

## Resolved decisions

All concerns from the initial plan are resolved below.

### C1 — LogEntryWrapper accent stripe — **Extend Panel** ✅

Extend `Panel` with a new prop:

```ts
accent?: "info" | "warn" | "error" | "success";
```

When set, Panel paints a 3 px left stripe in the corresponding `color.misc.*` token (`misc.blue`/`yellow`/`red`/`green`). Implemented inline in this task (not a separate precursor) — single focused prop. Reusable for any future status-tinted row (alerts, validation results, severity-flagged list items).

`LogEntryWrapper` becomes:

```tsx
<Panel
    name="log-entry-wrapper"
    ref={cellRef}
    direction="row"
    align="start"
    paddingX="lg"   // = 12 px, matches legacy
    accent={accentForEntryType(entry.type)}    // → "info" | "warn" | "error" | "success" | undefined
>
    {showTimestamp && entry.timestamp != null && (
        <Text size="sm" color="light" name="entry-timestamp" style={{ marginRight: 10 }}>
            {formatTimestamp(entry.timestamp)}
        </Text>
        // Note: style on Text not allowed — wrap in a Panel paddingRight or set gap on outer Panel.
    )}
    <Panel flex={1} minWidth={0} name="entry-content">
        <LogEntryContent entry={entry} updateEntry={updateEntry} />
    </Panel>
</Panel>
```

The mono `fontFamily: "Consolas, 'Courier New', monospace"` is no longer needed — Persephone's `GlobalStyles` already sets monospace app-wide.

### C2 — Text colour — **Use existing variants** ✅

`Text` already exposes `color="default" | "light" | "dark" | "error" | "warning" | "success" | "primary" | "inherit"`. Verified in `src/renderer/uikit/Text/Text.tsx`. In `default-dark.ts`, `color.error.text` / `color.success.text` / `color.warning.text` equal `color.misc.red` / `green` / `yellow` (identical values). `color.primary.text` is `#2aaaff` vs `color.misc.blue` `#3794ff` — close enough for the `log.info` accent.

Mapping for `LogMessageView`:

| Entry type   | Legacy colour       | UIKit `Text color` |
|--------------|---------------------|--------------------|
| `log.log`    | `color.text.light`  | `"light"`          |
| `log.info`   | `color.misc.blue`   | `"primary"`        |
| `log.warn`   | `color.misc.yellow` | `"warning"`        |
| `log.error`  | `color.misc.red`    | `"error"`          |
| `log.success`| `color.misc.green`  | `"success"`        |

`LogEntryContent` stub fallbacks (`stubStyle` / `errorStyle`) use `color="light"` and `color="error"` respectively. **No Text extension needed.**

### C3 — McpRequestView header click — **Plain Panel onClick + ghost chevron IconButton** ✅

Header is a `Panel onClick={…}` containing a ghost `IconButton` chevron + the method/detail/duration spans. No `Button variant="ghost"` wrapper around the whole row (that adds unwanted border/spacing). No new Panel `hover` prop — accept that the row doesn't paint a hover background. The chevron `IconButton` itself reveals hover state through its native ghost-variant hover.

### C4 — DialogContainer vertical gap — **Wrap dialog/output dispatch in LogEntryContent with `paddingY="xxs"`** ✅

`RenderFlexGrid` cells do not collapse margins, so legacy `margin: 2px 0` produced a 4 px gap between consecutive dialog/output rows. Moving the spacing into a parent Panel preserves the pixel result:

- Inside `LogEntryContent` dispatcher: when the dispatched entry is a **dialog** or **output** type, wrap the rendered View in `<Panel paddingY="xxs">{view}</Panel>`. The `xxs` token is 2 px (per `tokens.ts` — `spacing.xs = 2`). Use `xs` if `xxs` is unavailable in the `PaddingSize` union — verify `tokens.ts` at implementation; current scale starts at `xs:2`, so `paddingY="xs"` is correct.
- Plain **log message** entries (`log.log`/`info`/`warn`/`error`/`success`) skip this wrapper → no extra gap → preserves the console-density for consecutive log lines (matches legacy behaviour where log messages had zero margin).

Per-item chrome (`DialogContainer`, `GridOutputView`, `TextOutputView`, etc.) drops its `margin: "2px 0"` entirely. Vertical spacing now comes from the dispatcher wrapper.

### C5 — Select missing `adjustWithCharWidth` — **Drop for this task; revisit separately** ✅

Drop the legacy auto-width behaviour in this migration. `Select` keeps `minWidth={200}` (matching the dialog's existing 200 px floor) and grows to fill the container width — which is **acceptable but not ideal** when the parent log entry stretches across a wide window (would produce a 1000 px-wide select for a 5-character item list).

**Follow-up captured for later:** create a new task to explore replacing `Select`'s underlying `Input` (a native `<input>`) with `Textarea` (a `<div>` with `contenteditable` that natively grows with content). That's a UIKit infrastructure change, scoped separately so US-524 can land first and the user can evaluate the visual result. No precursor blocker for this task.

### C6 — Script API surface lock — **OK** ✅

`logTypes.ts` interfaces unchanged. No field renames, no new required fields. Migration is JSX-only.

### C7 — RenderFlexGrid row-height cache — **OK** ✅

Watch row-height jitter during manual smoke (re-opening a previously-viewed log file). No code changes anticipated.

### C8 — `style` escape on RenderFlexGrid — **OK** ✅

Verified — `LogViewEditor` doesn't pass `style` to `RenderFlexGrid`.

## Acceptance criteria

- No imports from `components/basic|form|layout|overlay/` in any file under `src/renderer/editors/log-view/`.
- No `@emotion/styled` usage under `src/renderer/editors/log-view/` (unless C1 lands as Option (b) — explicit per-file exception with rule documented in `uikit/CLAUDE.md`).
- Every UIKit primitive in migrated files carries a meaningful `name=` debug attribute (US-521).
- Script-runtime API surface (item view prop names, `logTypes.ts` interfaces) unchanged.
- `npm run lint` baseline unchanged.
- `npx tsc --noEmit` baseline unchanged.
- Manual smoke covering every `log.*` entry type (see Phase 9) renders and interacts correctly:
  - Confirm dialog: clicking each button resolves with the clicked label; resolved-state shows check icon next to chosen button.
  - Text input dialog: typing → live update; Enter key → resolves with the default button.
  - Buttons dialog: same as Confirm but with `!`-prefix required-button enforcement.
  - Checkboxes dialog (vertical + flex layouts): toggling persists across re-mount; "required" enforces at-least-one-checked.
  - Radioboxes dialog (vertical + flex layouts): single-selection radio works.
  - Select dialog: filter-while-type, value commits on selection.
  - Progress output: determinate, indeterminate, completed transitions render with no visual flicker.
  - Grid / Text / Markdown / Mermaid output: hover actions appear/disappear smoothly; "open in editor" navigates correctly.
  - MCP request: expand/collapse toggle works; Request and Response panels render with correct `ColorizedCode` JSON formatting; error path shows red `ERROR` badge in header.
  - Toolbar: Clear button shows confirmation then clears; timestamp toggle re-renders rows at new heights without scroll-position jump.

This task does NOT run `/review`, `/document`, or `/userdoc` — they run at EPIC-025 close per the deferred-review model.

## Files Changed

### LogView migrations

| File | Change |
|------|--------|
| `src/renderer/editors/log-view/LogViewEditor.tsx` | Toolbar `Button` → `IconButton`; `LogViewRoot` styled → `Panel`. |
| `src/renderer/editors/log-view/LogEntryWrapper.tsx` | `WrapperRoot` styled → `Panel` (+ `Panel.accent` extension per C1). |
| `src/renderer/editors/log-view/LogEntryContent.tsx` | `errorStyle` / `stubStyle` inline styles → `Text` tone variants. |
| `src/renderer/editors/log-view/LogMessageView.tsx` | `LogMessageRoot` styled → `Text` tone variants + `Panel` for whitespace control. |
| `src/renderer/editors/log-view/StyledTextView.tsx` | No change — already UIKit-neutral. |
| `src/renderer/editors/log-view/LogViewContext.ts` | No change. |
| `src/renderer/editors/log-view/LogViewModel.ts` | No change. |
| `src/renderer/editors/log-view/logTypes.ts` | **No change** (script API contract). |
| `src/renderer/editors/log-view/logConstants.ts` | No change. |

### Item view migrations

| File | Change |
|------|--------|
| `src/renderer/editors/log-view/items/DialogContainer.tsx` | `ContainerRoot` styled → `Panel` with `border` + `borderColor`. |
| `src/renderer/editors/log-view/items/DialogHeader.tsx` | `HeaderRoot` styled → `Panel background="dark"` + `Text`. |
| `src/renderer/editors/log-view/items/ConfirmDialogView.tsx` | `ConfirmRoot` styled → `Panel`. |
| `src/renderer/editors/log-view/items/ButtonsDialogView.tsx` | No standalone styled — already a thin composite. |
| `src/renderer/editors/log-view/items/ButtonsPanel.tsx` | `PanelRoot` styled → `Panel`; legacy `Button` → UIKit `Button` with `icon` prop. |
| `src/renderer/editors/log-view/items/CheckboxesDialogView.tsx` | `CheckboxesRoot` styled → `Panel`; legacy `Checkbox` → UIKit `Checkbox`. |
| `src/renderer/editors/log-view/items/RadioboxesDialogView.tsx` | `RadioboxesRoot` styled → `Panel`; legacy `Radio` × N → UIKit `RadioGroup`. |
| `src/renderer/editors/log-view/items/SelectDialogView.tsx` | `SelectRoot` styled → `Panel`; legacy `ComboSelect` → UIKit `Select`. |
| `src/renderer/editors/log-view/items/TextInputDialogView.tsx` | `TextInputRoot` styled → `Panel`; legacy `TextField` → UIKit `Input`. |
| `src/renderer/editors/log-view/items/ProgressOutputView.tsx` | `ProgressRoot` styled → `Panel`; inline progress bar + `CircularProgress` → UIKit `ProgressBar` (US-529). |
| `src/renderer/editors/log-view/items/GridOutputView.tsx` | `GridOutputRoot` styled → `Panel revealChildrenOnHover`; legacy `Button` hover action → `IconButton hideUntilParentHover`. |
| `src/renderer/editors/log-view/items/TextOutputView.tsx` | `TextOutputRoot` styled → `Panel revealChildrenOnHover`; legacy `Button` → `IconButton hideUntilParentHover`. Monaco host `<div>` stays. |
| `src/renderer/editors/log-view/items/MarkdownOutputView.tsx` | `MarkdownOutputRoot` styled → `Panel revealChildrenOnHover`; legacy `Button` → `IconButton hideUntilParentHover`. |
| `src/renderer/editors/log-view/items/MermaidOutputView.tsx` | `MermaidOutputRoot` styled → `Panel revealChildrenOnHover`; 2 × legacy `Button` → 2 × `IconButton hideUntilParentHover`. |
| `src/renderer/editors/log-view/items/McpRequestView.tsx` | `McpRequestRoot` styled → composed `Panel` + `Text` + `IconButton` + inline `useState` collapse. |

### UIKit extensions landed inline in this task (no separate precursor)

| File | Change |
|------|--------|
| `src/renderer/uikit/Panel/Panel.tsx` (per C1) | Add `accent?: "info" \| "warn" \| "error" \| "success"` prop driving a 3 px left stripe in the corresponding `color.misc.*` token. |
| `src/renderer/uikit/Panel/Panel.story.tsx` | Add `accent` to the prop editor enum. |
| `src/renderer/uikit/index.ts` | No new exports — `accent` rides on existing `PanelProps`. |

### Files that need NO changes

- `src/renderer/uikit/Text/Text.tsx` — existing `color` prop already covers all LogView levels (per C2). No extension.
- `src/renderer/uikit/*` (other than `Panel`).
- `src/renderer/components/data-grid/AVGrid/*` — out of scope.
- `src/renderer/editors/markdown/MarkdownBlock.tsx` — embedded as-is in MarkdownOutputView.
- `src/renderer/editors/mermaid/render-mermaid.ts` — embedded as-is in MermaidOutputView.
- `src/renderer/editors/shared/ColorizedCode.tsx` — embedded as-is in McpRequestView.
- `src/renderer/scripting/api-wrapper/UiFacade.ts` — emits log entries; **no change** (entry shape is unchanged).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- **Blocked on**: [US-529](../US-529-uikit-progress-bar/README.md) — UIKit `ProgressBar` primitive
- Related primitives: US-477 Progress (overlay), US-476 Notification, US-432 Dialog, US-481 Menu, US-468 ListBox, US-469 RadioGroup, US-470 Textarea, US-472 Select, US-471 Input slots
- Related migrations: US-523 LinkEditor (most recent), US-502 MCP Inspector (look-and-feel reference for McpRequestView)
