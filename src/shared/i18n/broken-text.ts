import type { EnglishMessage } from "./en/common";
import type { PackMessage } from "./pack";

const C = String.raw`[\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]`;
const BROKEN_UTF8_MOJIBAKE = new RegExp(
    String.raw`(?:[\u00C2-\u00DF]${C}|[\u00E0-\u00EF]${C}{2})`,
    "u",
);
const IN_WORD_QUESTION_MARK = /(?<=[\p{L}\p{N}])\?(?=[\p{L}\p{N}])/u;
const SENTENCE_FINAL_QUESTION_MARK = /\?(?:\s*[\])}'"\u00BB\u201D\u2019])?\s*$/u;
const EXPLICIT_MOJIBAKE_NON_MATCHES = new Set([
    "S\u00C3\u00A3o Paulo",
    "\u00C3\u2018and\u00C3\u00BA",
    "\u00C2\u00BFQu\u00C3\u00A9?",
    "\u00C3\u0090a\u00C3\u00B0i",
    "Gr\u00C3\u00B6\u00C3\u0178e",
    "\u00CE\u2022\u00CE\u00BB\u00CE\u00BB\u00CE\u00B7\u00CE\u00BD\u00CE\u00B9\u00CE\u00BA\u00CE\u00AC",
    "\u00E7\u00AE\u20AC\u00E4\u00BD\u201C\u00E4\u00B8\u00AD\u00E6\u2013\u2021",
    "\u00ED\u2022\u0153\u00EA\u00B5\u00AD\u00EC\u2013\u00B4",
]);

export interface MessageCheckIssue {
    kind: "replacement-character" | "in-word-question-mark" | "excess-question-mark" | "mojibake" | "missing-plural-category" | "missing-other";
    detail?: string;
}

function forms(message: PackMessage): Record<string, string> {
    return typeof message === "string" ? { other: message } : message;
}

function countQuestionMarks(value: string): number {
    return [...value].filter((character) => character === "?").length;
}

/** Check one translated message against its English source, including locale plural coverage. */
export function checkTranslatedMessage(message: PackMessage, english: EnglishMessage, code: string): MessageCheckIssue[] {
    const translatedForms = forms(message);
    const englishForms = forms(english);
    const issues: MessageCheckIssue[] = [];
    if (typeof english !== "string") {
        if (!Object.hasOwn(translatedForms, "other")) issues.push({ kind: "missing-other" });
        let categories: string[] = [];
        try {
            categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
        } catch {
            categories = ["other"];
        }
        for (const category of categories) {
            if (!Object.hasOwn(translatedForms, category)) issues.push({ kind: "missing-plural-category", detail: category });
        }
    }

    for (const [category, text] of Object.entries(translatedForms)) {
        const reference = englishForms[category] ?? englishForms.other;
        if (reference === undefined) continue;
        if (text.includes("\uFFFD")) issues.push({ kind: "replacement-character", detail: category });
        if (IN_WORD_QUESTION_MARK.test(text)) issues.push({ kind: "in-word-question-mark", detail: category });
        if (!EXPLICIT_MOJIBAKE_NON_MATCHES.has(text) && BROKEN_UTF8_MOJIBAKE.test(text)) {
            issues.push({ kind: "mojibake", detail: category });
        }
        const excess = countQuestionMarks(text) - countQuestionMarks(reference);
        if (excess > 0 && !(excess === 1 && SENTENCE_FINAL_QUESTION_MARK.test(text))) {
            issues.push({ kind: "excess-question-mark", detail: category });
        }
    }
    return issues;
}
