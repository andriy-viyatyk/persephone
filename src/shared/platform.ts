// Loaded directly by Node 24; keep runtime imports compatible with type stripping.
export type SupportedPlatform = "win32" | "linux" | "darwin";

/** The exact Node platform value, including platforms not supported by Persephone. */
export const platform: NodeJS.Platform = process.platform;

/** The supported OS slot, or undefined when Node reports another platform. */
export const supportedPlatform: SupportedPlatform | undefined =
    platform === "win32" || platform === "linux" || platform === "darwin" ? platform : undefined;

export const isWindows = platform === "win32";
export const isLinux = platform === "linux";
export const isMac = platform === "darwin";

/** Resolve the executable filename for a bundled helper. */
export function helperExecutableName(baseName: "persephone-snip" | "mneme"): string {
    return isWindows ? `${baseName}.exe` : baseName;
}

/** Windows path identity follows its case-insensitive filesystem behavior. */
export const pathsAreCaseInsensitive = isWindows;
