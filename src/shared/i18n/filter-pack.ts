import { fnv1aHash } from "./hash";
import type { LanguagePack, PackMessage } from "./pack";

// FNV-1a signatures of the normalized deny-list seeds. Keep words out of source.
const deniedWordHashes = new Set([
    "e6c0de4e", "665eb2fa", "ab8c8583", "c326f2d7", "d0d5c04e",
    "ca9ed393", "d1b7e2eb", "32e2c9f8", "5eb6e08a", "c1a97121",
]);
const markerLetters = /[\u044b\u044d\u0451]/i;
const companionLetters = /[\u0438\u0449\u044a]/i;
const scrambledLetters = /[\u044a\u044b\u044d\u0451]/gi;
const homoglyphs: Record<string, string> = {
    a: "\u0430", e: "\u0435", o: "\u043e", p: "\u0440", c: "\u0441", x: "\u0445", y: "\u0443",
};

function normalizeWord(word: string): string {
    return word.toLowerCase().replace(/\u0451/g, "\u0435").replace(/[aeopcxy]/g, (letter) => homoglyphs[letter] ?? letter);
}

/** Medium shade block (▒) — replaces scrambled words and letters. */
const SCRAMBLE_CHAR = "▒";

function filterText(text: string, scramble: boolean): string {
    const placeholders: string[] = [];
    const protectedText = text.replace(/\{[\w.-]+\}/g, (token) => `\uE100${placeholders.push(token) - 1}\uE101`);
    const withoutDeniedWords = protectedText.replace(/[\p{L}]+/gu, (word) =>
        deniedWordHashes.has(fnv1aHash(normalizeWord(word))) ? SCRAMBLE_CHAR.repeat([...word].length) : word,
    );
    const filtered = scramble ? withoutDeniedWords.replace(scrambledLetters, SCRAMBLE_CHAR) : withoutDeniedWords;
    return filtered.replace(/\uE100(\d+)\uE101/g, (_token, index: string) => placeholders[Number(index)]);
}

function messageTexts(messages: Record<string, PackMessage>): string[] {
    return Object.values(messages).flatMap((message) => typeof message === "string" ? [message] : Object.values(message));
}

/** D16 filter, intended for non-built-in packs only. */
export function filterLanguagePack(pack: LanguagePack): LanguagePack {
    const texts = messageTexts(pack.messages as Record<string, PackMessage>);
    const scramble = texts.some((text) => {
        const visibleText = text.replace(/\{[\w.-]+\}/g, "");
        return markerLetters.test(visibleText) && companionLetters.test(visibleText);
    });
    const messages = Object.fromEntries(Object.entries(pack.messages).map(([key, message]) => [
        key,
        typeof message === "string"
            ? filterText(message, scramble)
            : Object.fromEntries(Object.entries(message).map(([category, text]) => [category, filterText(text, scramble)])),
    ]));
    return { ...pack, messages };
}
