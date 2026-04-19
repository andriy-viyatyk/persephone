# Pattern 3: Compound Components with Implicit Context

**Used by:** Radix UI, Reach UI, Headless UI, React Aria

## What it is

A complex component exposes a family of **sub-components** that share state through React context. The parent component provides the context; children consume it without prop drilling. The caller never touches the shared state directly.

```tsx
// Caller sees a clean, readable component tree
<Select value={value} onChange={setValue}>
    <Select.Trigger />
    <Select.Content>
        <Select.Item value="js">JavaScript</Select.Item>
        <Select.Item value="ts">TypeScript</Select.Item>
        <Select.Item value="py">Python</Select.Item>
    </Select.Content>
</Select>
```

Internally, `Select.Root` creates a context with `{ value, onChange, open, setOpen, highlightedIndex, ... }`. Each sub-component reads exactly what it needs from that context. The caller never sees any of this.

## How it's implemented

```tsx
interface SelectContext {
    value: string;
    onChange: (v: string) => void;
    open: boolean;
    setOpen: (open: boolean) => void;
    highlightedIndex: number;
    setHighlightedIndex: (i: number) => void;
}

const SelectCtx = React.createContext<SelectContext | null>(null);

function useSelectContext() {
    const ctx = React.useContext(SelectCtx);
    if (!ctx) throw new Error("Select sub-component used outside <Select>");
    return ctx;
}

// Root
function Select({ value, onChange, children }: SelectProps) {
    const [open, setOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    return (
        <SelectCtx.Provider value={{ value, onChange, open, setOpen, highlightedIndex, setHighlightedIndex }}>
            {children}
        </SelectCtx.Provider>
    );
}

// Sub-component — reads only what it needs
function SelectTrigger() {
    const { open, setOpen, value } = useSelectContext();
    return <button onClick={() => setOpen(!open)}>{value || "Select..."}</button>;
}

function SelectItem({ value: itemValue, children }: { value: string; children: ReactNode }) {
    const { value, onChange, setOpen, highlightedIndex } = useSelectContext();
    return (
        <div
            data-selected={value === itemValue || undefined}
            onClick={() => { onChange(itemValue); setOpen(false); }}
        >
            {children}
        </div>
    );
}

// Attach sub-components to the root
Select.Trigger = SelectTrigger;
Select.Content = SelectContent;
Select.Item = SelectItem;
```

## Value it brings

**Clean call site** — the caller doesn't manage open/close state, highlighted index, or keyboard handling. They provide value + onChange and describe the structure. Internal complexity is hidden.

**Each sub-component is independently replaceable** — don't like the default `Select.Trigger`? Render your own child inside it, or provide a completely custom trigger.

**Scales to complex components** — Dialog, Menu, Accordion, Tabs, TreeView all have significant internal state that would otherwise require many props or render props. Compound components handle this cleanly.

**Type-safe error boundary** — the `useSelectContext()` hook throws immediately if a sub-component is used outside its parent, which catches mis-use during development.

## Tradeoff

**Context re-renders** — every consumer of the context re-renders when any context value changes. Mitigate by splitting into separate contexts (e.g., `SelectStateCtx` for frequently changing values, `SelectActionsCtx` for stable callbacks).

**Harder to debug** — the data flow is implicit. DevTools React Context inspector helps.

**Namespace collision** — `Select.Item` as a property on the function is fine but slightly non-standard. Alternative: export sub-components separately as `SelectItem`, `SelectTrigger`, etc.

## Persephone usage

Where compound components would replace current complex prop passing:

| Component | Current state | Compound benefit |
|-----------|--------------|-----------------|
| Dialog / modal | Multiple boolean props, multiple callbacks | Root provides open/close context |
| ComboBox | Props drilled through several layers | Options list reads value from context |
| ContextMenu | Model passed everywhere | Menu context carries open state and handlers |
| Accordion | each panel needs to know global state | Root manages which panel is open |
| Tabs | tab bar + panels need shared selected state | Root provides selected tab context |

Note: Persephone's model-view pattern already separates behavior from view. Compound components complement this — the context can simply expose the model, and sub-components read from it.

```tsx
// Persephone-style: model goes into context
function Dialog({ model, children }: { model: DialogModel; children: ReactNode }) {
    return <DialogCtx.Provider value={model}>{children}</DialogCtx.Provider>;
}
```

## Decision

❌ **Skip** — Persephone is an internal library; component consumers are always known. The `Select.Root/Select.Item` namespace API adds surface complexity without benefit here. Persephone already passes model instances via React context where needed — that covers the state-sharing goal. The compound component *API style* (dotted namespace exports) is not adopted.
