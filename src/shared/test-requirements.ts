// Loaded directly by Node 24; keep runtime imports compatible with type stripping.
export function isAutomaticRequirement(tag: string): boolean {
    return tag === "windows";
}

export function automaticRequirementReason(requirements: string[], windows: boolean): string | undefined {
    return requirements.includes("windows") && !windows ? "requires Windows" : undefined;
}
