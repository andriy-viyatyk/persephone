import type { BrowserUrlMaskClaim } from "../ipc/api-param-types";
import type { BoardServiceTrustSnapshot, TrustedBoardSnapshotEntry } from "../ipc/module-service-channels";
import { BOARD_BRIDGE_VERSION } from "../shared/board-bridge-version";
import { mergeCapabilityDeclarations } from "../shared/capability-contract";
import { OwnershipRegistry } from "../shared/ownership-registry";
import { BoardGrant } from "../shared/board/board-grant";
import { normalizePermissions, type NormalizedBoardPermissions } from "../shared/board/board-permissions";
import { getBoardCompatibility } from "../shared/version-utils";
import { BoardRoot } from "../shared/board/board-root";
import type { NormalizedBoardManifest } from "../shared/board/board-manifest-schema";
import { boardLocalCallerId } from "./board-root-hashes";
import { stableBoardIdentity } from "../shared/board/board-stable-identity";
import { boardDisplayName } from "./board-manifest-reader";
import type { TrustedBoardGrant } from "./board-trust-store";

export interface BoardSource {
    root: string;
    manifest: NormalizedBoardManifest | null;
    bundledId?: string;
}

export interface BoardTrustSnapshot {
    serviceSnapshot: BoardServiceTrustSnapshot;
    claims: BrowserUrlMaskClaim[];
}

export interface BoardTrustSources {
    grants: readonly TrustedBoardGrant[];
    trusted: readonly BoardSource[];
    bundled: readonly BoardSource[];
}

export interface BoardTrustReduction {
    root: string;
    permissionChanges: string[] | null;
}

export interface BoardTrustBuild {
    grants: TrustedBoardGrant[];
    reductions: BoardTrustReduction[];
    snapshot: BoardTrustSnapshot;
}

export type BoardTrustSnapshotListener = (snapshot: BoardTrustSnapshot) => void | Promise<void>;

export const manifestPermissions = (manifest: NormalizedBoardManifest | null): NormalizedBoardPermissions =>
    manifest?.permissions ?? normalizePermissions(undefined);

function reduceGrants(grants: readonly TrustedBoardGrant[], trusted: readonly BoardSource[]): {
    grants: TrustedBoardGrant[];
    reductions: BoardTrustReduction[];
} {
    const reductions: BoardTrustReduction[] = [];
    const nextGrants = grants.map((grant) => {
        const source = trusted.find(({ root }) => BoardRoot.from(root).equals(grant.root));
        if (!source) return grant;
        const currentManifestPermissions = manifestPermissions(source.manifest);
        const changes = BoardGrant.from(grant.permissions).reductionTo(currentManifestPermissions);
        const manifestUses = source.manifest?.uses ?? [];
        const grantUses = grant.uses ?? [];
        const reducedUses = grantUses.filter((use) => manifestUses.some((item) => item.id === use.id && item.version === use.version));
        const usesReduced = reducedUses.length !== grantUses.length;
        if (!changes && !usesReduced) return grant;
        reductions.push({ root: grant.root, permissionChanges: changes });
        return { ...grant, ...(changes ? { permissions: currentManifestPermissions } : {}), uses: reducedUses };
    });
    return { grants: nextGrants, reductions };
}

function buildServiceSnapshot(grants: readonly TrustedBoardGrant[], trusted: readonly BoardSource[], bundled: readonly BoardSource[]): BoardServiceTrustSnapshot {
    const allSources = [...trusted, ...bundled];
    const boards: TrustedBoardSnapshotEntry[] = [];
    for (const source of allSources) {
        const service = source.manifest?.service;
        const manifestUses = source.manifest?.uses ?? [];
        const manifestInterfaces = source.manifest?.serviceInterfaces ?? [];
        const granted = source.bundledId
            ? manifestPermissions(source.manifest)
            : grants.find((grant) => BoardRoot.from(grant.root).equals(source.root))?.permissions
                ?? manifestPermissions(source.manifest);
        const storedGrant = grants.find((grant) => BoardRoot.from(grant.root).equals(source.root));
        const manifestChanged = !!storedGrant
            && (!BoardGrant.same(manifestPermissions(source.manifest), storedGrant.permissions)
                || JSON.stringify(manifestUses) !== JSON.stringify(storedGrant.uses ?? []));
        const callerId = stableBoardIdentity(source.manifest)
            ?? (source.bundledId ? `bundled:${source.bundledId}` : boardLocalCallerId(BoardRoot.from(source.root)));
        const compatible = getBoardCompatibility({
            minBridgeVersion: source.manifest?.minBridgeVersion,
            requiresMinBridgeVersion: BoardGrant.from(manifestPermissions(source.manifest)).isDeclared(),
        }, { bridgeVersion: BOARD_BRIDGE_VERSION }).compatible;
        const declarations = compatible ? source.manifest?.capabilities ?? [] : [];
        boards.push({
            boardRoot: source.root,
            legacyCapabilities: declarations.filter((declaration) => !declaration.methods || Object.values(declaration.methods).some((method) => method.kind === "open")),
            capabilities: compatible ? mergeCapabilityDeclarations(declarations, manifestInterfaces) : [],
            canStartService: BoardGrant.from(granted).canRunService(),
            permissions: granted,
            manifestPermissions: manifestPermissions(source.manifest),
            ...(manifestChanged ? { manifestChanged: true } : {}),
            ...(service ? { service } : {}),
            uses: source.bundledId ? manifestUses : storedGrant?.uses ?? [],
            manifestUses,
            serviceInterfaces: manifestInterfaces,
            boardName: boardDisplayName(BoardRoot.from(source.root), source.manifest),
            callerId,
        });
    }
    return {
        trustedPaths: allSources.map((source) => source.root),
        boards,
    };
}

function buildClaims(trusted: readonly BoardSource[], bundled: readonly BoardSource[]): BrowserUrlMaskClaim[] {
    const browserUrlMaskOwners = new OwnershipRegistry<BoardSource>();
    const claims: BrowserUrlMaskClaim[] = [];
    for (const source of [...trusted, ...bundled]) {
        const compatibility = getBoardCompatibility(
            {
                minBridgeVersion: source.manifest?.minBridgeVersion,
                requiresMinBridgeVersion: BoardGrant.from(manifestPermissions(source.manifest)).isDeclared(),
            },
            { bridgeVersion: BOARD_BRIDGE_VERSION },
        );
        if (!compatibility.compatible) continue;
        const masks = source.manifest?.browserUrlMasks ?? [];
        const accepted = masks.filter((mask) => browserUrlMaskOwners.claim(
            mask,
            source,
            { origin: source.bundledId ? "bundled" : "trusted", owner: source.root },
        ).accepted);
        if (accepted.length > 0) {
            claims.push({ boardRoot: source.root, boardName: boardDisplayName(BoardRoot.from(source.root), source.manifest), masks: accepted });
        }
    }
    return claims;
}

export function buildBoardTrustSnapshot(sources: BoardTrustSources): BoardTrustBuild {
    const reduced = reduceGrants(sources.grants, sources.trusted);
    const grants = reduced.grants;
    return {
        grants,
        reductions: reduced.reductions,
        snapshot: {
            serviceSnapshot: buildServiceSnapshot(grants, sources.trusted, sources.bundled),
            claims: buildClaims(sources.trusted, sources.bundled),
        },
    };
}
