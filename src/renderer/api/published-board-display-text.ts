import type { PublishedBoardInfo } from "../../ipc/api-param-types";
import { pseudoText } from "../../shared/i18n/pseudo-text";

export interface PublishedBoardDisplayText {
    name: string;
    description?: string;
}

function localizedField(
    board: PublishedBoardInfo,
    field: "name" | "description",
    locale: string,
): string | undefined {
    const entries = Object.entries(board.localized ?? {});
    const normalizedLocale = locale.toLowerCase();
    const baseLocale = normalizedLocale.split("-")[0];
    const exact = entries.find(([code]) => code.toLowerCase() === normalizedLocale)?.[1];
    const base = entries.find(([code]) => code.toLowerCase() === baseLocale)?.[1];
    const localized = exact?.[field] ?? base?.[field];
    return typeof localized === "string" && localized.trim() ? localized : undefined;
}

/** Resolve catalog metadata for display without changing the catalog's English source fields. */
export function publishedBoardDisplayText(
    board: PublishedBoardInfo,
    locale: string,
): PublishedBoardDisplayText {
    if (locale.toLowerCase() === "en-xa") {
        return {
            name: pseudoText(board.name),
            description: board.description ? pseudoText(board.description) : board.description,
        };
    }
    return {
        name: localizedField(board, "name", locale) ?? board.name,
        description: localizedField(board, "description", locale) ?? board.description,
    };
}
