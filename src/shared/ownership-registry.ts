export interface OwnershipClaimOptions {
    readonly origin: string;
    readonly owner?: string;
}

export interface OwnershipClaim<T> extends OwnershipClaimOptions {
    readonly value: T;
}

export type OwnershipClaimResult<T> =
    | {
        readonly accepted: true;
        readonly claim: OwnershipClaim<T>;
    }
    | {
        readonly accepted: false;
        readonly claim: OwnershipClaim<T>;
        readonly existing: OwnershipClaim<T>;
    };

/** A first-owner map keyed by values normalized by the caller. */
export class OwnershipRegistry<T> {
    private readonly claims = new Map<string, OwnershipClaim<T>>();

    claim(key: string, value: T, options: OwnershipClaimOptions): OwnershipClaimResult<T> {
        const existing = this.claims.get(key);
        const claim: OwnershipClaim<T> = { ...options, value };
        if (existing) return { accepted: false, claim, existing };
        this.claims.set(key, claim);
        return { accepted: true, claim };
    }

    get(key: string): OwnershipClaim<T> | undefined {
        return this.claims.get(key);
    }

    has(key: string): boolean {
        return this.claims.has(key);
    }

    keys(): string[] {
        return [...this.claims.keys()];
    }

    replace(key: string, value: T, options: OwnershipClaimOptions): OwnershipClaim<T> {
        const claim: OwnershipClaim<T> = { ...options, value };
        this.claims.set(key, claim);
        return claim;
    }

    clearOrigin(origin: string): void {
        for (const [key, claim] of this.claims) {
            if (claim.origin === origin) this.claims.delete(key);
        }
    }
}
