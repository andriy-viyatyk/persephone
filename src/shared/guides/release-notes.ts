/** Select the current release-notes section, preferring an upcoming section. */
export function selectReleaseNotes(content: string, version: string): string {
    const upcoming = findReleaseSection(content, `## Version ${version} (Upcoming)`);
    if (upcoming !== undefined) return upcoming;
    const released = findReleaseSection(content, `## Version ${version}`);
    return released ?? `No release notes are available for Persephone ${version}.`;
}

function findReleaseSection(content: string, heading: string): string | undefined {
    const headingPattern = new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m");
    const match = headingPattern.exec(content);
    if (!match || match.index === undefined) return undefined;
    const bodyStart = match.index + match[0].length;
    const nextHeading = /^## Version .+$/m.exec(content.slice(bodyStart));
    const bodyEnd = nextHeading?.index === undefined ? content.length : bodyStart + nextHeading.index;
    return `${heading}\n\n${content.slice(bodyStart, bodyEnd).trim()}`.trim();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
