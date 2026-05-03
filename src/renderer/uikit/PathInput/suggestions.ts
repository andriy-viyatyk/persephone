export interface PathSuggestion {
    /** Full path that selecting this row would commit (or the folder path before the trailing separator). */
    path: string;
    /** Display label — the next segment (e.g. "persephone" for path = "work/projects/persephone"). */
    label: string;
    /** When true, selecting appends the separator and keeps the input in edit mode. */
    isFolder: boolean;
    /** Already-typed prefix (e.g. "work/projects/") — rendered muted before the label. */
    matchPrefix: string;
}

/**
 * Compute autocomplete suggestions for the current input given a flat list of
 * separator-delimited paths. Folder rows always win over leaf rows on collision —
 * `paths = ["work", "work/projects"]` with empty input produces a single folder row
 * `"work"` (drill-down), not a leaf, so the user can navigate deeper.
 */
export function getPathSuggestions(
    input: string,
    paths: string[],
    separator: string,
): PathSuggestion[] {
    const lastSepIndex = input.lastIndexOf(separator);
    const currentPrefix = lastSepIndex >= 0 ? input.slice(0, lastSepIndex + 1) : "";
    const currentSegment = lastSepIndex >= 0 ? input.slice(lastSepIndex + 1) : input;
    const currentPrefixLower = currentPrefix.toLowerCase();
    const currentSegmentLower = currentSegment.toLowerCase();
    const map = new Map<string, PathSuggestion>();

    for (const path of paths) {
        if (currentPrefix && !path.toLowerCase().startsWith(currentPrefixLower)) continue;
        const remaining = path.slice(currentPrefix.length);
        if (currentSegmentLower && !remaining.toLowerCase().startsWith(currentSegmentLower)) continue;

        const nextSepIndex = remaining.indexOf(separator);
        if (nextSepIndex >= 0) {
            // Folder — always overwrite (folder wins on collision with a leaf).
            const folderPath = currentPrefix + remaining.slice(0, nextSepIndex);
            map.set(folderPath, {
                path: folderPath,
                label: remaining.slice(0, nextSepIndex),
                isFolder: true,
                matchPrefix: currentPrefix,
            });
        } else if (!map.has(path)) {
            // Leaf — only insert if no entry exists yet (a folder added later still wins).
            map.set(path, {
                path,
                label: remaining,
                isFolder: false,
                matchPrefix: currentPrefix,
            });
        }
    }

    return Array.from(map.values()).sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.label.localeCompare(b.label);
    });
}

/** Returns true when `value`'s effective depth exceeds `maxDepth`. */
export function exceedsMaxDepth(
    value: string,
    separator: string,
    maxDepth: number | undefined,
): boolean {
    if (maxDepth === undefined || !value) return false;
    const segmentCount = value.split(separator).length;
    const effectiveDepth = value.endsWith(separator) ? segmentCount - 1 : segmentCount;
    return effectiveDepth > maxDepth;
}
