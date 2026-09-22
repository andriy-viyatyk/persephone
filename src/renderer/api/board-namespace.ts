import { readBoardManifest, hasStableBoardIdentity } from "../editors/board/board-manifest";
import { bundledBoardRegistry } from "../editors/board/bundled-board-registry";
import { boardTrust } from "./board-trust";
import { fpNormalizeForCompare } from "../core/utils/file-path";

// =============================================================================
// Shared board identity and vars namespace resolution (EPIC-111 / US-1499).
// =============================================================================

// Deliberately NOT cached. `readBoardManifest()` reads from disk on every call, so resolution is
// always current — and the namespace depends on the manifest's own `author`/`name`, which change
// through neither the trust list nor bundled registration. A cache keyed on those two signals
// would go stale exactly when it matters most: someone adds a missing `name` to make their board
// eligible for settings (EPIC-111 S7) and nothing happens until a restart, with nothing on screen
// explaining why. The cost is one small read and parse per call; if a consumer ever makes this a
// hot path, cache it then, against a measurement and with manifest-level invalidation.

/**
 * The per-board vars namespace: the manifest's `author/name` when BOTH are explicitly set
 * (trimmed, non-empty), otherwise `bundled:<folder-id>` for a bundled board or the board root path
 * for an ordinary board (unique — collision-free but not portable across locations). The namespace
 * is a plain JSON object key, so spaces / "/" inside the display strings are fine
 * ("Persephone/Excel Viewer"); it is deliberately NOT slugged or charset-restricted.
 */
export async function resolveBoardNamespace(boardRoot: string): Promise<string> {
    const rootKey = fpNormalizeForCompare(boardRoot);
    const manifest = await readBoardManifest(boardRoot);
    let namespace: string;
    if (hasStableBoardIdentity(manifest)) {
        const author = typeof manifest?.author === "string" ? manifest.author.trim() : "";
        const name = typeof manifest?.name === "string" ? manifest.name.trim() : "";
        namespace = `${author}/${name}`;
    } else {
        await bundledBoardRegistry.ensureInitialized();
        const bundled = bundledBoardRegistry.list().find(
            (record) => fpNormalizeForCompare(record.root) === rootKey,
        );
        namespace = bundled ? `bundled:${bundled.id}` : boardRoot;
    }

    return namespace;
}

/**
 * Finds a currently-trusted board whose resolved namespace collides with `boardRoot`'s.
 * Returns `undefined` when there's no collision, OR when `boardRoot`'s own namespace is the
 * path-fallback (its root path) — a path-fallback namespace is unique by construction, so no
 * collision is possible and there's nothing to check.
 */
export async function findNamespaceCollision(
    boardRoot: string,
): Promise<{ namespace: string; collidingRoot: string } | undefined> {
    const namespace = await resolveBoardNamespace(boardRoot);
    if (namespace === boardRoot) return undefined;

    await boardTrust.load();
    const key = fpNormalizeForCompare(boardRoot);
    for (const other of boardTrust.listPaths()) {
        if (fpNormalizeForCompare(other) === key) continue;
        // eslint-disable-next-line no-await-in-loop -- small, bounded list of trusted boards
        if ((await resolveBoardNamespace(other)) === namespace) {
            return { namespace, collidingRoot: other };
        }
    }
    return undefined;
}

/**
 * Registration-flow gate: checks for a namespace collision and, if found, shows the advisory
 * dialog. Returns `true` when it's safe to proceed with `boardTrust.trust(boardRoot)` (no
 * collision, or the user chose "Register anyway"), `false` when the user cancelled.
 */
export async function confirmNamespaceNotColliding(boardRoot: string): Promise<boolean> {
    const collision = await findNamespaceCollision(boardRoot);
    if (!collision) return true;
    const { showNamespaceCollisionDialog } = await import(
        "../ui/dialogs/NamespaceCollisionDialog"
    );
    return showNamespaceCollisionDialog(collision.namespace, collision.collidingRoot);
}
