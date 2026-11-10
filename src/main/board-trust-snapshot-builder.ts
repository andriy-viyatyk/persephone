import type { BrowserUrlMaskClaim } from "../ipc/api-param-types";
import type { BoardFileAccessGrants, BoardSnapshotEntry, DisabledBundledBoard } from "../ipc/board-snapshot-channels";
import type { BoardServiceTrustSnapshot, TrustedBoardSnapshotEntry } from "../ipc/module-service-channels";
import { mergeCapabilityDeclarations } from "../shared/capability-contract";
import { OwnershipRegistry } from "../shared/ownership-registry";
import { BoardGrant } from "../shared/board/board-grant";
import { normalizePermissions, type NormalizedBoardPermissions } from "../shared/board/board-permissions";
import { BoardRoot } from "../shared/board/board-root";
import type { NormalizedBoardManifest } from "../shared/board/board-manifest-schema";
import { boardLocalCallerId } from "./board-root-hashes";
import { boardIdentity } from "../shared/board/board-stable-identity";
import { boardManifestCompatibility } from "../shared/board/board-manifest-queries";
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
    /** The renderer-facing board list; the broadcaster turns it into a `BoardSnapshot`. */
    entries: BoardSnapshotEntry[];
    disabledBundled: DisabledBundledBoard[];
    /** "file-access": only `entries[].fileAccess` changed since the previous snapshot. */
    change: "rebuild" | "file-access";
}

export interface BoardTrustSources {
    grants: readonly TrustedBoardGrant[];
    trusted: readonly BoardSource[];
    bundled: readonly BoardSource[];
    disabledBundled: readonly DisabledBundledBoard[];
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

const storedGrantFor = (grants: readonly TrustedBoardGrant[], root: string): TrustedBoardGrant | undefined =>
    grants.find((grant) => BoardRoot.from(grant.root).equals(root));

function grantedFor(source: BoardSource, storedGrant: TrustedBoardGrant | undefined): NormalizedBoardPermissions {
    return source.bundledId
        ? manifestPermissions(source.manifest)
        : storedGrant?.permissions ?? manifestPermissions(source.manifest);
}

function isBoardCompatible(source: BoardSource): boolean {
    return boardManifestCompatibility(source.manifest).compatible;
}

function isManifestChanged(source: BoardSource, storedGrant: TrustedBoardGrant | undefined): boolean {
    return !!storedGrant
        && (!BoardGrant.same(manifestPermissions(source.manifest), storedGrant.permissions)
            || JSON.stringify(source.manifest?.uses ?? []) !== JSON.stringify(storedGrant.uses ?? []));
}

export const fileAccessFor = (grants: readonly TrustedBoardGrant[], root: string): BoardFileAccessGrants => {
    const stored = storedGrantFor(grants, root);
    return { folderGrants: [...(stored?.folderGrants ?? [])], fileGrants: [...(stored?.fileGrants ?? [])] };
};

function buildEntries(grants: readonly TrustedBoardGrant[], trusted: readonly BoardSource[], bundled: readonly BoardSource[]): BoardSnapshotEntry[] {
    return [...trusted, ...bundled].map((source): BoardSnapshotEntry => {
        const storedGrant = storedGrantFor(grants, source.root);
        const manifestUses = source.manifest?.uses ?? [];
        const base = {
            root: source.root,
            permissions: grantedFor(source, storedGrant),
            manifestPermissions: manifestPermissions(source.manifest),
            manifestChanged: isManifestChanged(source, storedGrant),
            uses: source.bundledId ? manifestUses : storedGrant?.uses ?? [],
            manifestUses,
            fileAccess: source.bundledId ? { folderGrants: [], fileGrants: [] } : fileAccessFor(grants, source.root),
        };
        return source.bundledId ? { ...base, origin: "bundled", bundledId: source.bundledId } : { ...base, origin: "trusted" };
    });
}

/** A file-access change touches only `fileAccess`; the manifests are not re-read. */
export function withFileAccess(entries: readonly BoardSnapshotEntry[], grants: readonly TrustedBoardGrant[]): BoardSnapshotEntry[] {
    return entries.map((entry) => entry.origin === "bundled" ? entry : { ...entry, fileAccess: fileAccessFor(grants, entry.root) });
}

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
        const storedGrant = storedGrantFor(grants, source.root);
        const granted = grantedFor(source, storedGrant);
        const manifestChanged = isManifestChanged(source, storedGrant);
        const callerId = boardIdentity(source.manifest,
            source.bundledId ? { kind: "bundled", bundledId: source.bundledId } : { kind: "local" },
            () => boardLocalCallerId(BoardRoot.from(source.root)));
        const compatible = isBoardCompatible(source);
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
        if (!isBoardCompatible(source)) continue;
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
            entries: buildEntries(grants, sources.trusted, sources.bundled),
            disabledBundled: [...sources.disabledBundled],
            change: "rebuild",
        },
    };
}
