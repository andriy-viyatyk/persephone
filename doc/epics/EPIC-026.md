# EPIC-026: Trait System — Universal Data Adaptation Layer

## Status

**Status:** Planned
**Created:** 2026-04-17

## Overview

Introduce a **trait system** to Persephone — a universal mechanism for adapting any object to any interface without modifying the original object. Inspired by Rust traits, this system provides typed accessor functions and capability discovery. The trait system is a foundational architectural primitive (like the state system or event channels) that will be used across the entire application: components, drag-and-drop, editors, content pipeline, and scripting.

## Goals

- **Eliminate mapping/unmapping** — components work with any data type via trait accessors, events return original objects
- **Capability discovery** — data carries a `TraitSet` describing everything it can become; consumers query for what they need
- **Consistent pattern** — replace scattered accessor-function props (`getLabel`, `getIcon`, etc.) with a unified trait vocabulary
- **Type co-location** — types and their trait implementations live together in namespaces (`Link.traits`, `FilePath.traits`)
- **Foundation for future work** — component library (EPIC-025), script UI API, and new editors will build on this system

## Motivation: Current Patterns That Traits Unify

The codebase already uses trait-like patterns in 6+ distinct ways. The trait system formalizes and unifies them all.

### Pattern 1: Accessor Function Props (Components)

`List.tsx`, `ComboSelect.tsx`, and `TreeView.tsx` accept individual accessor functions:

```typescript
// List.tsx (lines 99-107) — 6 separate accessor props
getLabel?: (value: O, index?: number) => React.ReactNode;
getIcon?: (value: O, index?: number) => React.ReactNode;
getSelected?: (value: O) => boolean;
getHovered?: (value: O) => boolean;
getTooltip?: (value: O, index?: number) => string | undefined;
getContextMenu?: (value: O, index?: number) => MenuItem[] | undefined;

// ComboSelect.tsx (lines 59-60) — same pattern
getLabel?: (value: T, index?: number) => string;
getIcon?: (value: T, index?: number) => ReactElement;
```

**Problem:** Each component invents its own accessor props. No reuse between List, ComboSelect, PopupMenu, TreeView. Adding a new accessor means changing every component.

**With traits:** One `ListItemTrait<T>` shared by all list-like components.

### Pattern 2: Fixed Interfaces (MenuItem, IOption)

`MenuItem` (`/src/renderer/api/types/events.d.ts`) has a fixed shape:
```typescript
interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: any;
  startGroup?: boolean;
  hotKey?: string;
  items?: MenuItem[];   // sub-menu
}
```

**Problem:** Any data shown in a menu must be converted to `MenuItem` first, then the original object recovered from the `onClick` closure. Data doesn't naturally "become" a menu item.

**With traits:** `MenuItemTrait<T>` describes how to read menu properties from any `T`.

### Pattern 3: Editor Facades (`asText`, `asGrid`, `asNotebook`)

`PageWrapper.ts` has 12 identical `as*()` methods (lines 122-272):
```typescript
async asText(): Promise<TextEditorFacade> { ... }
async asGrid(): Promise<GridEditorFacade> { ... }
async asNotebook(): Promise<NotebookEditorFacade> { ... }
async asMermaid(): Promise<MermaidEditorFacade> { ... }
```

**Problem:** Every new editor type requires adding another `as*()` method to `PageWrapper`. Hard-coded type checks.

**With traits:** Each editor registers a facade trait. `page.as(TextTrait)` discovers it dynamically.

### Pattern 4: Editor Registry Dispatch

`EditorRegistry` (`/src/renderer/editors/registry.ts`) uses trait-like methods on `EditorDefinition`:
```typescript
acceptFile?(filePath: string): number;        // "can I handle this file?"
switchOption?(languageId: string): number;     // "should I appear in the switch menu?"
validForLanguage?(languageId: string): boolean;
isEditorContent?(languageId: string, content: string): boolean;
```

**Observation:** `EditorDefinition` is already a trait bag — each editor provides its own implementation. This pattern validates the trait approach.

### Pattern 5: Content Pipeline Enrichment

`ILinkData` (`/src/shared/link-data.ts`) is progressively enriched across pipeline layers:
- Layer 1 (parsers): sets `url`
- Layer 2 (resolvers): sets `pipe`, `pipeDescriptor`, `target`
- Layer 3 (open handler): consumes `pipe`, creates page

**Observation:** Each layer "adds capabilities" to the data object — conceptually adding traits at each stage.

### Pattern 6: Drag-and-Drop Format Negotiation

Currently handled ad-hoc. With traits, the drag source declares capabilities (`TraitSet`) and the drop target queries for what it needs — exactly like clipboard MIME types.

## Design

### Core Types

```typescript
// Typed key for a specific trait (phantom type ensures type safety at call sites)
class TraitKey<T> {
  readonly symbol: symbol;
  constructor(readonly name: string) { this.symbol = Symbol(name); }
}

// Bag of trait implementations — "here's everything this type can do"
class TraitSet {
  private map = new Map<symbol, unknown>();
  add<T>(key: TraitKey<T>, impl: T): this;
  get<T>(key: TraitKey<T>): T | undefined;
  has(key: TraitKey<unknown>): boolean;
}

// Data + capabilities bundled together
interface Traited<V> {
  readonly target: V;
  readonly traits: TraitSet;
}

// Helper to create Traited values — always explicit
function traited<V>(target: V, traits: TraitSet): Traited<V>;
```

### Two Usage Tiers

**Tier 1 — Direct (data already matches expected shape):**
```typescript
<ComboBox items={nativeOptions} />
```

**Tier 2 — Explicit (foreign data, specify trait set):**
```typescript
<ComboBox items={traited(paths, FilePath.traits)} />
```

> **Note:** Auto-discovery via tagged objects (`TRAIT_KEY` symbol on data) was considered and rejected.
> Symbol properties are silently lost on object spread (`{...obj}`), `JSON.parse`/`stringify`, and
> object recreation — creating subtle bugs that are hard to trace. Explicit `traited(data, traits)`
> is always clear about what traits apply.

### Well-Known Trait Keys

```typescript
// Display traits — how to show T in various UI contexts
const OPTION    = new TraitKey<OptionTrait<any>>("Option");
const LIST_ITEM = new TraitKey<ListItemTrait<any>>("ListItem");
const MENU_ITEM = new TraitKey<MenuItemTrait<any>>("MenuItem");
const TREE_NODE = new TraitKey<TreeNodeTrait<any>>("TreeNode");
const GRID_ROW  = new TraitKey<GridRowTrait<any>>("GridRow");

// Conversion traits — how to transform T into another type
const TEXT      = new TraitKey<TextTrait<any>>("Text");
const LINK      = new TraitKey<LinkTrait<any>>("Link");
const FILE_PATH = new TraitKey<FilePathTrait<any>>("FilePath");

// Behavioral traits — capabilities T supports
const DRAGGABLE  = new TraitKey<DraggableTrait<any>>("Draggable");
const DROPPABLE  = new TraitKey<DroppableTrait<any>>("Droppable");
const SEARCHABLE = new TraitKey<SearchableTrait<any>>("Searchable");
```

### Trait Co-location with Types (Namespace Pattern)

```typescript
// types/Link.ts
export namespace Link {
  export interface ILink {
    url: string;
    label?: string;
    group?: string;
    icon?: string;
  }

  export const traits = new TraitSet()
    .add(OPTION, {
      title: (l) => l.label ?? l.url,
      value: (l) => l.url,
    })
    .add(MENU_ITEM, {
      label: (l) => l.label ?? l.url,
      group: (l) => l.group,
    })
    .add(TEXT, {
      text: (l) => l.url,
    });

  // Convenience single-trait accessors
  export const option = traits.get(OPTION)!;
  export const menuItem = traits.get(MENU_ITEM)!;
}
```

### Component Integration Pattern

Components accept `T[] | Traited<T[]>` and resolve once:

```typescript
interface ComboBoxProps<T> {
  items: T[] | Traited<T[]>;
  onSelect?: (item: T) => void;  // always returns raw T
}

function ComboBox<T>({ items, onSelect }: ComboBoxProps<T>) {
  const [data, option] = resolveTraited(items, OPTION);
  // data: T[], option: OptionTrait<T>
  return data.map((item, i) => (
    <div key={i} onClick={() => onSelect?.(item)}>
      {option.title(item)}
    </div>
  ));
}
```

### Drag-and-Drop Discovery

TraitSet objects contain functions and cannot survive cross-window serialization. Instead, drag payloads carry a serializable `typeId` + `data`, and a **TraitRegistry** resolves the TraitSet at the drop target.

```typescript
// TraitRegistry — maps type identifiers to TraitSets
class TraitRegistry {
  register(typeId: string, traits: TraitSet): void;
  get(typeId: string): TraitSet | undefined;
}

// Drag source: serialize typeId + data via HTML5 dataTransfer
dataTransfer.setData("application/persephone-trait", JSON.stringify({
  typeId: "ILink",
  data: { href: "...", title: "...", category: "..." }
}));

// Drop target: deserialize, resolve traits from registry
const { typeId, data } = JSON.parse(getData("application/persephone-trait"));
const traits = traitRegistry.get(typeId);
if (traits?.has(LINK)) {
  const linkTrait = traits.get(LINK)!;
  const url = linkTrait.href(data);
  // use it
}

// Lazy traits (e.g., FILE_FOLDER → LINK_COLLECTION)
// The trait accessor does expensive work only when called by the drop target
traitRegistry.register("FileFolder", new TraitSet()
  .add(LINK_COLLECTION, {
    getLinks: async (folder) => scanFolderRecursively(folder.path),
  })
);
```

This approach enables cross-window drag-and-drop for free — HTML5 `dataTransfer` string data is mediated by the OS between Electron windows.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-428 | Trait system core — TraitKey, TraitSet, Traited, traited() | Done |
| US-444 | Trait-based drag-drop infrastructure + link pilot — TraitRegistry, serialization, native HTML5 DnD, convert link-drag | Active |
| US-447 | Convert remaining data drags to trait-based system — todo, notes, REST, browser tabs, pinned links, explorer files/folders | Planned |
| US-448 | Cross-type drop targets — FILE_FOLDER→Links import, cross-editor category drops, LINK→RestClient | Planned |
| US-449 | Remove React-DnD dependency — convert component-level drags to native HTML5 | Planned |
| US-445 | Editor facade refactor — replace hard-coded as*() methods with trait-based discovery | Planned |
| US-446 | Documentation — trait system guide in /doc/architecture/ | Planned |

## Phase Plan

**Phase 1 — Core Primitives (US-428)** ✅
`TraitKey`, `TraitSet`, `Traited`, `traited()`, `isTraited()`. New code only.

**Phase 2 — Drag-and-Drop Infrastructure (US-444)**
TraitRegistry for cross-window serialization, native HTML5 drag/drop utilities, LINK trait key, convert link-drag in TreeProviderView as pilot. Cross-window verification.

**Phase 3 — Drag-and-Drop Expansion (US-447, US-448)**
Convert remaining data drags (todo, notes, REST, browser tabs, pinned links, explorer files/folders) to trait-based system. Implement cross-type drop targets: FILE_FOLDER with lazy LINK_COLLECTION trait for folder import, cross-editor link category drops, LINK drops into RestClient.

**Phase 4 — React-DnD Removal (US-449)**
Convert remaining component-level drags (grid columns, menu folders, pinned editors) to native HTML5. Remove `react-dnd` and `react-dnd-html5-backend` dependencies.

**Phase 5 — Editor Facade Refactor (US-445)**
Replace hard-coded `as*()` methods with trait-based discovery. Script API backward compatibility is not a concern.

**Phase 6 — Documentation (US-446)**
Write the architecture guide after real working examples exist.

## Migration Strategy

**No dual approach.** When a component is converted to traits, old accessor props are removed and all call sites are updated. This avoids leaving two patterns in the codebase. This epic converts only 1-2 pilot components; EPIC-025 will convert the rest during the full component redesign.

**Script API compatibility is not a priority.** Persephone's scripting is not widely used yet — it's being built toward a future where Claude helps users create custom editors. Breaking changes to the script API are acceptable during this foundational work.

## Resolved Concerns

1. **TraitSet internal typing** — `Map<symbol, unknown>` internally, with `TraitKey<T>` phantom types providing compile-time safety at call sites. `TraitSet` has no type parameter (V was phantom and unused in method signatures). `Traited<V>` has one type parameter for the target value.

2. **Performance for large lists** — Not a concern. All grids, lists, and combobox dropdowns in Persephone are virtualized, so only visible items call trait accessors. No benchmarking needed.

3. **Auto-discovery (TRAIT_KEY)** — **Rejected.** Symbol properties are silently lost on object spread (`{...obj}`), `JSON.parse`, and object recreation, creating subtle bugs. Only explicit `traited(data, traits)` is supported (Tier 2).

4. **Trait composition / chaining** — **Not needed.** Converting `FilePath → LINK → OPTION` would require the LINK's OPTION trait to work on an intermediate result, not a real `ILink` object. In practice, each type defines the traits it needs directly (e.g., `FilePath` defines its own `OPTION` trait). Simpler and more predictable.

5. **Accessor prop deprecation** — **Replace fully, not dual.** When a component moves to traits, old accessor props are removed and all call sites are updated. No transitional period. This epic pilots on 1-2 components; EPIC-025 handles the rest.

6. **Editor facade migration** — Script API backward compatibility is not a concern (see Migration Strategy above). Editor facades (`asText()`, `asGrid()`) can be directly replaced with trait-based discovery.

## Resolved Open Questions

1. **Pilot selection** — **Drag-and-drop (link-drag).** PopupMenu was investigated and rejected — `onClick` is context-dependent (closures capture surrounding scope), so MenuItem is an action-carrying UI description, not a data-adaptation problem. Traits don't reduce complexity there. Drag-and-drop is a better fit: data sources declare capabilities, drop targets query for what they need, and cross-window serialization requires a registry.

2. **Trait interface granularity** — **One trait per UI context, optional methods for optional properties.** For example, `MenuItemTrait<T>` includes `label` (required), `icon?`, `disabled?`, `hotKey?`, `startGroup?` (all optional). Components check optional accessors with `?.()`: `trait.icon?.(item)`. This keeps the number of traits manageable while allowing minimal implementations for simple cases.

3. **Trait composition / fallback conversions** — **Deferred.** Explicit fallbacks (e.g., "anything with LINK can derive OPTION") are a valid idea but not needed yet. If significant duplication appears across type trait implementations, fallback conversions can be added as an enhancement. Keep it simple for now.

## Remaining Open Questions

None — all design questions resolved. Ready for implementation.

## Dependencies

- **Depends on:** Nothing — this is a foundational epic
- **Depended on by:** EPIC-025 (Unified Component Library) — will use traits for all component data binding

## Notes

### 2026-04-17
- Split from EPIC-025 (Component Library). Traits are a global architectural primitive, not specific to components.
- Investigated 6 existing patterns in the codebase that traits unify: accessor props, fixed interfaces, editor facades, editor registry dispatch, content pipeline enrichment, drag-and-drop.
- Rejected per-instance wrapper approach (O(n) allocation, React identity issues, `this` binding problems in trait entries).
- **Decided on two usage tiers only:** direct (no trait) and explicit `traited(data, traits)`.
- **Rejected auto-discovery (TRAIT_KEY/Tier 3):** Symbol properties silently lost on spread, JSON round-trip, and object recreation. Explicit is safer.
- **Rejected trait composition/chaining:** Converting through intermediate types (FilePath→LINK→OPTION) doesn't work cleanly — intermediate trait produces a value, but the next trait expects a real object. Each type defines its own traits directly.
- **No dual approach on components:** When a component is converted to traits, old accessor props are removed entirely. No transitional "both work" period — that creates mess.
- **Script API backward compat not required:** Scripting is not widely used yet; it's being built toward a future Claude-assisted editor creation platform. Breaking changes are acceptable.
- This epic pilots traits on 1-2 components only. Full component conversion happens in EPIC-025 during the component redesign.

### 2026-04-18
- **Pilot component: PopupMenu family.** ComboSelect excluded — depends on List, which underlies multiple other components (too large for a pilot).
- **Trait interface granularity: one trait per UI context, optional methods for optional properties.** `trait.icon?.(item)` pattern. Keeps trait count low while supporting minimal implementations.
- **Trait fallback conversions: deferred.** Valid idea (register LINK→OPTION fallback so any LINK type auto-derives OPTION), but savings are small (~1 line per type) vs. added complexity (resolution order, ambiguity, harder debugging). Will revisit after Phase 2 if real duplication appears.
- All design questions resolved. Epic is ready for implementation.
- **Simplified generics:** `TraitSet<V>` → `TraitSet` (V was phantom — unused in any method signature). `Traited<T, V>` → `Traited<V>` (T was phantom — unused in interface body). Type safety comes from `TraitKey<T>` at call sites, not from container type parameters.
- **Restructured tasks: vertical slices instead of horizontal layers.** Removed US-429 (all trait interfaces upfront), US-438 (resolveTraited standalone), US-439 (add traits to types standalone). These were speculative — defining interfaces and helpers before any consumer exists leads to overdesign and rework. Instead, each task is a complete vertical slice: US-440 defines MenuItemTrait + resolveTraited + converts PopupMenu + updates call sites. Trait interfaces are defined at point of use, not in advance.
- **Removed US-440 (PopupMenu pilot).** Investigation showed PopupMenu is a poor trait candidate: `onClick` is context-dependent (closures capture surrounding scope), not type-dependent. MenuItem is an action-carrying UI description — traits can't help with the dominant concern. Savings would be ~2 lines per mapped item, and the majority of menu construction is hardcoded inline.
- **Drag-and-drop is the real trait pilot.** Investigated all 12 drag types in the codebase. Data-item drags (links, notes, todos, REST requests, browser tabs) benefit from traits: sources declare capabilities, targets query for what they need. Cross-window drag requires serialization via HTML5 `dataTransfer` — TraitSet objects can't survive (they contain functions), so a TraitRegistry maps typeId strings to TraitSets at the drop target.
- **React-DnD can be removed.** No custom drag previews or drag layers are used — just the browser's native ghost element. All 11 components use only basic features (isDragging, isOver, type matching) that native HTML5 events can provide.
- **Split drag-drop work into 4 tasks:** US-444 (infrastructure + link pilot), US-447 (convert remaining data drags), US-448 (cross-type drop targets including lazy FILE_FOLDER→LINK_COLLECTION), US-449 (remove React-DnD).
