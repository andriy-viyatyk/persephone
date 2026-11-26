// Loaded directly by Node 24; keep runtime imports compatible with type stripping.
// Automatic requirements are decided from the platform before a test runs; `--with` cannot supply them.
// "webgl": Linux test machines (WSLg, Xvfb on CI) have no GPU process for Chromium, so WebGL is assumed
// present on Windows only. Only published game boards need it; Persephone itself does not use WebGL.
const AUTOMATIC_REQUIREMENTS = ["windows", "linux", "webgl"];

export function isAutomaticRequirement(tag: string): boolean {
    return AUTOMATIC_REQUIREMENTS.includes(tag);
}

export function automaticRequirementReason(requirements: string[], windows: boolean): string | undefined {
    if (windows) return requirements.includes("linux") ? "requires Linux" : undefined;
    if (requirements.includes("windows")) return "requires Windows";
    if (requirements.includes("webgl")) return "requires WebGL (not available on Linux test machines)";
    return undefined;
}
