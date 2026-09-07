import type { IAiMember } from "./types";

/** At most this many names are offered: a longer list stops being a one-line correction. */
const MAX_SUGGESTIONS = 3;

/**
 * Find the member names that are an exact or near match for the rejected one.
 *
 * Returns **every** equally-good candidate rather than only an unambiguous winner. A tie is
 * common and does not mean we know nothing: `pagez` is one edit from both `pages` (substitute)
 * and `page` (delete), and suppressing the suggestion there would send the caller the full
 * member list for the single most likely typo on the whole surface. Two names on one line are
 * still strictly cheaper and more actionable than that, and never wrong.
 *
 * Ranking is distance first, then the smaller absolute length difference — a substitution is a
 * likelier typo than a deletion, which is what puts `pages` ahead of `page` for `pagez` — then
 * declaration order, so the result is deterministic.
 */
export function findMemberSuggestions(name: string, members: readonly IAiMember[]): readonly string[] {
    const normalizedName = name.toLowerCase();
    const exactMatches = members.filter(member => member.name.toLowerCase() === normalizedName);
    if (exactMatches.length) return exactMatches.slice(0, MAX_SUGGESTIONS).map(member => member.name);

    // Distance 2 only for a name long enough that two edits still leave it recognisable. On short
    // names almost everything is within two edits of everything else (`ui` and `fs`, say), and a
    // confident wrong suggestion is worse than the member list it replaces.
    const maxDistance = name.length >= 5 ? 2 : 1;
    const candidates: { name: string; distance: number; lengthGap: number; order: number }[] = [];

    members.forEach((member, order) => {
        const distance = levenshteinDistance(name, member.name);
        if (distance > maxDistance) return;
        candidates.push({
            name: member.name,
            distance,
            lengthGap: Math.abs(member.name.length - name.length),
            order,
        });
    });

    candidates.sort((left, right) =>
        left.distance - right.distance
        || left.lengthGap - right.lengthGap
        || left.order - right.order);

    return candidates.slice(0, MAX_SUGGESTIONS).map(candidate => candidate.name);
}

/** `"pages"` / `"pages" or "page"` / `"pages", "page" or "pagesX"` — a readable one-line list. */
export function formatSuggestions(names: readonly string[]): string {
    const quoted = names.map(name => JSON.stringify(name));
    if (quoted.length <= 1) return quoted[0] ?? "";
    return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

function levenshteinDistance(left: string, right: string): number {
    const previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let previousDiagonal = previousRow[0];
        previousRow[0] = leftIndex;

        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const current = previousRow[rightIndex];
            const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            previousRow[rightIndex] = Math.min(
                previousRow[rightIndex] + 1,
                previousRow[rightIndex - 1] + 1,
                previousDiagonal + substitutionCost,
            );
            previousDiagonal = current;
        }
    }

    return previousRow[right.length];
}
