export interface RepaintKeys<P> {
    readonly rows: readonly (keyof P)[];
    readonly global: readonly (keyof P)[];
    readonly local: readonly (keyof P)[];
}

export interface RepaintDiff {
    readonly rows: boolean;
    readonly global: boolean;
    readonly local: boolean;
}

export function createRepaintTracker<P>(keys: RepaintKeys<P>): {
    diff(previous: P | undefined, next: P): RepaintDiff | undefined;
} {
    if (import.meta.env.DEV) {
        const seen = new Set<keyof P>();
        for (const group of [keys.rows, keys.global, keys.local]) {
            for (const key of group) {
                if (seen.has(key)) throw new Error(`Repaint key appears in multiple groups: ${String(key)}`);
                seen.add(key);
            }
        }
    }

    return {
        diff(previous, next) {
            if (previous === undefined) return undefined;
            const rows = keys.rows.some((key) => !Object.is(previous[key], next[key]));
            const global = keys.global.some((key) => !Object.is(previous[key], next[key]));
            const local = keys.local.some((key) => !Object.is(previous[key], next[key]));
            return rows || global || local ? { rows, global, local } : undefined;
        },
    };
}
