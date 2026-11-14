/**
 * Typed key for a specific trait.
 * The phantom type T ensures type safety at call sites — get() returns T,
 * add() requires T as the implementation type.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- phantom generic; used by callers via type inference
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
 * via tagged objects was rejected (see resolved concerns).
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
        value !== null
        && typeof value === "object"
        && "target" in value
        && "traits" in value
        && (value as Traited).traits instanceof TraitSet
    );
}

// ── Accessor trait helpers ────────────────────────────────────────────────────

/**
 * Derives an accessor-map type from a component's data interface.
 * Each field of T becomes a function `(source: unknown) => NonNullable<T[K]>`.
 * Optional fields in T stay optional in the accessor — callers use `trait.field?.(src)`.
 *
 * Primary use: as the type parameter of TraitKey, so trait registrations are
 * automatically checked against the target interface:
 *
 *   export const OPTION_KEY = new TraitKey<TraitType<IOption>>("option");
 *
 *   new TraitSet().add(OPTION_KEY, {
 *       label:    (item: MyItem) => item.title,   // TS error if IOption changes
 *       value:    (item: MyItem) => item.id,
 *       disabled: (item: MyItem) => !item.active,
 *   });
 *
 * Component props accept either direct data or a Traited wrapper:
 *   options: IOption[] | Traited<unknown[]>
 * Use resolveTraited() inside the component to normalise both cases.
 */
export type TraitType<T> = {
    readonly [K in keyof T]: (source: unknown) => NonNullable<T[K]>;
};

/**
 * Like TraitType<T> but every accessor is optional.
 * Use when the source type is already structurally close to T and only
 * a subset of fields need remapping. Components must fall back to the
 * raw source value for any accessor that is absent.
 */
export type PartialTraitType<T> = {
    readonly [K in keyof T]?: (source: unknown) => NonNullable<T[K]>;
};

/**
 * Resolves a Traited<unknown[]> into a typed T[] using the accessor trait.
 * Call this at the top of a component that accepts `items: T[] | Traited<unknown[]>`:
 *
 *   function MyList({ items }: { items: IOption[] | Traited<unknown[]> }) {
 *       const options = isTraited(items)
 *           ? resolveTraited(items, OPTION_KEY)
 *           : items;
 *       // use options: IOption[]
 *   }
 *
 * Falls back to casting target as T[] when the trait key is not registered,
 * so components degrade gracefully when a TraitSet is incomplete.
 */
export function resolveTraited<T>(
    items: Traited<unknown[]>,
    key: TraitKey<TraitType<T>>,
): T[] {
    const accessor = items.traits.get(key);
    if (!accessor) return items.target as T[];
    return items.target.map((source) => resolveTraitAccessor(source, accessor));
}

/** Apply each registered accessor to one source, or return the source unchanged when absent. */
export function resolveTraitAccessor<T>(source: unknown, accessor?: TraitType<T>): T {
    if (!accessor) return source as T;
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof typeof accessor)[]).map((key) => [key, accessor[key](source)]),
    ) as T;
}

/**
 * Resolve one plain or trait-wrapped value to its render shape. Plain values are cast (the caller
 * assumes the value already has the target shape) unless `plainAccessor` is supplied; wrapped
 * values use the accessor they carry and return their raw target when that trait key is absent.
 */
export function resolveTraitedOne<T>(
    value: unknown,
    key: TraitKey<TraitType<T>>,
    plainAccessor?: TraitType<T>,
): T {
    if (isTraited(value)) {
        const accessor = value.traits.get(key);
        return accessor ? resolveTraitAccessor(value.target, accessor) : value.target as T;
    }
    return plainAccessor ? resolveTraitAccessor(value, plainAccessor) : value as T;
}
