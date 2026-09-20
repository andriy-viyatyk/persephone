/**
 * Shared semver-ish version parse + compare, usable from BOTH the main and renderer
 * bundles. Kept import-free on purpose: `version-service.ts` (main) must not leak its
 * electron / e-store / open-windows imports into the renderer, which needs the same
 * compare for the published-boards catalog (compatibility + update detection).
 */

export function parseVersion(version: string): number[] {
    const cleaned = version.replace(/^v/, "");
    return cleaned.split(".").map((part) => parseInt(part, 10) || 0);
}

/** Returns 1 if `latest` > `current`, -1 if `latest` < `current`, 0 if equal. */
export function compareVersions(current: string, latest: string): number {
    const currentParts = parseVersion(current);
    const latestParts = parseVersion(latest);

    const maxLength = Math.max(currentParts.length, latestParts.length);

    for (let i = 0; i < maxLength; i++) {
        const currentPart = currentParts[i] || 0;
        const latestPart = latestParts[i] || 0;

        if (latestPart > currentPart) return 1;
        if (latestPart < currentPart) return -1;
    }

    return 0;
}

/** Return a usable semver-like version requirement, or undefined for malformed input. */
export function normalizeVersionRequirement(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    const version = raw.trim();
    return /^v?\d+(?:\.\d+)*$/.test(version) ? version : undefined;
}

export interface BoardCompatibilityRequirements {
    minAppVersion?: unknown;
    minBridgeVersion?: unknown;
}

export interface BoardCompatibilityVersions {
    appVersion?: string;
    bridgeVersion?: string;
}

export interface BoardCompatibilityResult {
    compatible: boolean;
    reason?: string;
}

/** Compare the independent app and bridge requirements of a board. */
export function getBoardCompatibility(
    requirements: BoardCompatibilityRequirements,
    versions: BoardCompatibilityVersions,
): BoardCompatibilityResult {
    const minAppVersion = normalizeVersionRequirement(requirements.minAppVersion);
    if (minAppVersion && versions.appVersion
        && compareVersions(versions.appVersion, minAppVersion) > 0) {
        return {
            compatible: false,
            reason: `Requires Persephone ${minAppVersion} or newer (current ${versions.appVersion}).`,
        };
    }

    const minBridgeVersion = normalizeVersionRequirement(requirements.minBridgeVersion);
    if (minBridgeVersion && versions.bridgeVersion
        && compareVersions(versions.bridgeVersion, minBridgeVersion) > 0) {
        return {
            compatible: false,
            reason: `Requires bridge ${minBridgeVersion} or newer (current ${versions.bridgeVersion}).`,
        };
    }

    return { compatible: true };
}
