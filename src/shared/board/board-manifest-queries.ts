import type { NormalizedBoardManifest, BoardEditorKind } from "./board-manifest-schema";
import type { NormalizedBoardPermissions } from "./board-permissions";
import type { BoardServiceInterfaceDeclaration, BoardServiceUseDeclaration } from "./board-service-declarations";
import { BOARD_BRIDGE_VERSION } from "../board-bridge-version";
import { getBoardCompatibility, type BoardCompatibilityResult } from "../version-utils";
import { BoardGrant } from "./board-grant";

/** Whether a board manifest can run on this build's bridge. */
export function boardManifestCompatibility(manifest: NormalizedBoardManifest | null | undefined): BoardCompatibilityResult {
    return getBoardCompatibility({
        minBridgeVersion: manifest?.minBridgeVersion,
        requiresMinBridgeVersion: !!manifest && BoardGrant.from(manifest.permissions).isDeclared(),
    }, { bridgeVersion: BOARD_BRIDGE_VERSION });
}

export function hostOwnsPipe(kind: BoardEditorKind): boolean {
    return kind === "content-host" || kind === "stream-host";
}

export function boardTrustDisclosure(manifest: NormalizedBoardManifest): {
    permissions: NormalizedBoardPermissions;
    serviceDeclared: boolean;
    capabilities: readonly string[];
    serviceInterfaces: readonly BoardServiceInterfaceDeclaration[];
    uses: readonly BoardServiceUseDeclaration[];
} {
    return {
        permissions: manifest.permissions,
        serviceDeclared: manifest.service !== undefined,
        capabilities: (manifest.capabilities ?? []).map((declaration) => declaration.id),
        serviceInterfaces: manifest.serviceInterfaces ?? [],
        uses: manifest.uses ?? [],
    };
}

export type BoardUsageGroup = "file-viewer" | "file-editor" | "tool";

/**
 * Whether a board is standalone — openable with no file and eligible for pinning /
 * the "+" new-page dropdown. Default when `standalone` is absent: no masks →
 * true (tools/dashboards are inherently standalone), masks → false (a file-bound board
 * must opt in). An explicit boolean always wins.
 */
function isBoardStandalone(manifest: Pick<NormalizedBoardManifest, "fileMasks" | "standalone"> | null | undefined): boolean {
    if (typeof manifest?.standalone === "boolean") return manifest.standalone;
    return (manifest?.fileMasks ?? []).length === 0;
}

/**
 * Derived usage group: **File viewer** (masks, not standalone — e.g. drawio-viewer),
 * **File editor** (masks + standalone — e.g. todo), **Tool / App** (no masks). Used by
 * the hub / pin surfaces to group boards.
 */
export function boardUsageGroup(manifest: Pick<NormalizedBoardManifest, "fileMasks" | "standalone"> | null | undefined): BoardUsageGroup {
    const hasMasks = (manifest?.fileMasks ?? []).length > 0;
    if (!hasMasks) return "tool";
    return isBoardStandalone(manifest) ? "file-editor" : "file-viewer";
}

