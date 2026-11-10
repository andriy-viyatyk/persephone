type IdentitySource = { author?: unknown; name?: unknown } | null | undefined;

export type BoardIdentityOrigin =
    | { readonly kind: "bundled"; readonly bundledId: string }
    | { readonly kind: "local" };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Fields that keep a board from having a stable identity, in the order the messages list them. */
export function missingBoardIdentityFields(manifest: IdentitySource): ("author" | "name")[] {
    const missing: ("author" | "name")[] = [];
    if (!text(manifest?.author)) missing.push("author");
    if (!text(manifest?.name)) missing.push("name");
    return missing;
}

/** True when both identity fields are strings with non-empty trimmed values. */
export function hasStableBoardIdentity(manifest: IdentitySource): boolean {
    return missingBoardIdentityFields(manifest).length === 0;
}

/** Return the stable namespace identity shared by custom-editor and settings registration. */
export function stableBoardIdentity(manifest: IdentitySource): string | undefined {
    return hasStableBoardIdentity(manifest) ? `${text(manifest?.author)}/${text(manifest?.name)}` : undefined;
}

/** Return a board identity in stable, bundled, then local order, preserving each caller's local projection. */
export function boardIdentity(manifest: IdentitySource, origin: BoardIdentityOrigin, localId: () => string): string {
    return stableBoardIdentity(manifest)
        ?? (origin.kind === "bundled" ? `bundled:${origin.bundledId}` : localId());
}
