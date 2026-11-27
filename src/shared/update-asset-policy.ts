import type { SupportedPlatform } from "./platform";

interface ReleaseAsset {
    name?: unknown;
    browser_download_url?: unknown;
}

/**
 * Selects the first usable installer for a platform/package format.
 * Windows setup uses /setup.*\.exe$/i (persephone-setup-${version}.exe);
 * Debian uses /\.deb$/i (persephone-${version}-linux-${arch}.deb);
 * AppImage uses /\.appimage$/i (persephone-${version}-linux-${arch}.AppImage).
 */
export function selectUpdateAssetUrl(
    assets: unknown,
    platform: SupportedPlatform | undefined,
    hasAppImage: boolean,
): string | null {
    if (!Array.isArray(assets)) return null;

    let namePattern: RegExp;
    if (platform === "win32") {
        namePattern = /setup.*\.exe$/i;
    } else if (platform === "linux") {
        namePattern = hasAppImage ? /\.appimage$/i : /\.deb$/i;
    } else {
        return null;
    }

    for (const asset of assets as ReleaseAsset[]) {
        if (!asset || typeof asset !== "object") continue;
        if (typeof asset.name !== "string" || !namePattern.test(asset.name)) continue;
        if (typeof asset.browser_download_url !== "string" || !asset.browser_download_url.trim()) continue;
        return asset.browser_download_url;
    }

    return null;
}
