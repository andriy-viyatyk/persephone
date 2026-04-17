# US-428: Trait System Core — TraitKey, TraitSet, Traited, traited()

## Goal

Implement the foundational trait system types: `TraitKey`, `TraitSet`, `Traited` interface, and `traited()` helper function. This is new infrastructure code only — no existing files are modified except barrel exports.

## Background

**Parent epic:** [EPIC-026 — Trait System](../../epics/EPIC-026.md)

The trait system is a universal data adaptation layer inspired by Rust traits. It allows any plain object to satisfy any component interface via typed accessor functions, eliminating manual mapping/unmapping between data shapes.

### Existing foundational primitives (reference for organization)

The state system (`/src/renderer/core/state/`) is the closest structural precedent:
- `state.ts` — core `IState<T>`, `TOneState<T>` class
- `model.ts` — `IModel<T>`, `TModel<T>` class
- `events.ts` — `Subscription<D>` class
- `index.ts` — barrel re-exports all modules

Pattern: each conceptual group lives in its own subfolder under `/src/renderer/core/`, with an `index.ts` that re-exports everything. The parent `/src/renderer/core/index.ts` re-exports all subfolders.

### Design (from EPIC-026)

```typescript
// Typed key — phantom type T ensures type safety at call sites
class TraitKey<T> {
  readonly symbol: symbol;
  constructor(readonly name: string) { this.symbol = Symbol(name); }
}

// Bag of trait implementations
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

// Helper to create Traited values
function traited<V>(target: V, traits: TraitSet): Traited<V>;
```

## Implementation Plan

### Step 1: Create trait system folder

Create `/src/renderer/core/traits/` with two files.

### Step 2: Implement `traits.ts`

File: `/src/renderer/core/traits/traits.ts`

```typescript
/**
 * Typed key for a specific trait.
 * The phantom type T ensures type safety at call sites — get() returns T,
 * add() requires T as the implementation type.
 */
export class TraitKey<T> {
    readonly symbol: symbol;

    constructor(readonly name: string) {
        this.symbol = Symbol(name);
    }
}

/**
 * Bag of trait implementations keyed by TraitKey.
 * Internal storage is Map<symbol, unknown> — type safety is provided by
 * TraitKey<T> phantom types at call sites (standard TypeScript guarantee).
 * Supports method chaining: new TraitSet().add(KEY1, impl1).add(KEY2, impl2)
 */
export class TraitSet {
    private readonly map = new Map<symbol, unknown>();

    add<T>(key: TraitKey<T>, impl: T): this {
        this.map.set(key.symbol, impl);
        return this;
    }

    get<T>(key: TraitKey<T>): T | undefined {
        return this.map.get(key.symbol) as T | undefined;
    }

    has(key: TraitKey<unknown>): boolean {
        return this.map.has(key.symbol);
    }
}

/**
 * Data bundled with its trait capabilities.
 * V is the target value type (can be a single item, an array, or any shape).
 * Consumers query traits to discover how to work with target.
 */
export interface Traited<V = unknown> {
    readonly target: V;
    readonly traits: TraitSet;
}

/**
 * Creates a Traited value — always explicit, never auto-discovered.
 * Symbol properties are silently lost on spread/JSON, so auto-discovery
 * via tagged objects was rejected (see EPIC-026 resolved concerns).
 */
export function traited<V>(target: V, traits: TraitSet): Traited<V> {
    return { target, traits };
}

/**
 * Type guard: checks if a value is a Traited wrapper.
 * Used by components to distinguish T[] from Traited<T[]>.
 */
export function isTraited<V = unknown>(value: unknown): value is Traited<V> {
    return (
        value !== null &&
        typeof value === "object" &&
        "target" in value &&
        "traits" in value &&
        (value as Traited).traits instanceof TraitSet
    );
}
```

### Step 3: Create barrel export

File: `/src/renderer/core/traits/index.ts`

```typescript
export { TraitKey, TraitSet, traited, isTraited } from './traits';
export type { Traited } from './traits';
```

### Step 4: Re-export from core

File: `/src/renderer/core/index.ts` — add one line:

```typescript
// Before:
export * from './state';
export * from './utils';

// After:
export * from './state';
export * from './utils';
export * from './traits';
```

## Design Decisions

### 1. TraitSet has no type parameter

The epic shows `TraitSet<V>`, but V is unused in any method signature — it's a phantom parameter. Since `add<T>()` and `get<T>()` already get their type from `TraitKey<T>`, and the internal map is `Map<symbol, unknown>`, the V parameter adds no type safety. Dropping it simplifies the API without losing anything. Namespace usage remains clean:

```typescript
// Without phantom V — equally safe, simpler
export const traits = new TraitSet()
    .add(OPTION, { title: (l: ILink) => l.label ?? l.url });
```

### 2. Traited has one type parameter, not two

The epic shows `Traited<T, V>` where T is phantom (unused in the interface body). This was likely intended as a marker for "what the consumer expects," but in practice `resolveTraited()` (US-438) handles that type mapping. A single `Traited<V>` is clearer:

- `Traited<ILink[]>` — target is an array of links, traits describe individual ILink items
- `Traited<string>` — target is a single string, traits describe string items

The relationship "traits describe elements of target" is a convention enforced by trait key definitions (US-429), not by the Traited interface itself.

### 3. isTraited() type guard included

Components need to distinguish `T[] | Traited<T[]>` in their props. A type guard based on `instanceof TraitSet` is reliable (TraitSet is a class, not a plain object), and avoids duck-typing ambiguity. This is needed by `resolveTraited()` (US-438) but belongs in the core module since it's fundamental to the Traited type.

### 4. TraitKey uses symbol (not string)

Each `new TraitKey("Option")` creates a unique symbol, so two keys with the same name don't collide. This matches the epic's design and follows the pattern used by React context (`Symbol` for identity).

## Files That Need NO Changes

- No component files (List.tsx, ComboSelect.tsx, PopupMenu.tsx) — those are US-440
- No type definition files (events.d.ts) — those are US-429
- No editor files — those are US-445
- No scripting files — future work

## Acceptance Criteria

1. `TraitKey<T>` class exists with `symbol` and `name` properties
2. `TraitSet` class supports `add()` (chainable), `get()` (typed), `has()` (boolean)
3. `Traited<V>` interface exists with `target` and `traits` properties
4. `traited()` function creates Traited values
5. `isTraited()` type guard reliably detects Traited values
6. All types exportable via `import { TraitKey, TraitSet, ... } from "../../core/traits"`
7. Also importable via `import { TraitKey, ... } from "../../core"` (barrel)
8. Project compiles without errors (`npm run lint` passes)

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/core/traits/traits.ts` | **New** | TraitKey, TraitSet, Traited, traited(), isTraited() |
| `src/renderer/core/traits/index.ts` | **New** | Barrel exports |
| `src/renderer/core/index.ts` | **Edit** | Add `export * from './traits'` |
