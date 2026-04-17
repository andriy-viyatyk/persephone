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
        value !== null
        && typeof value === "object"
        && "target" in value
        && "traits" in value
        && (value as Traited).traits instanceof TraitSet
    );
}
