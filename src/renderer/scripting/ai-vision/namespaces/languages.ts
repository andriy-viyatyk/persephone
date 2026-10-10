import type { ILanguages } from "../../../api/types/languages";
import type { IAiMember, IAiVisionDescriptor } from "ai-vision";

const LANGUAGE_MEMBERS: readonly IAiMember[] = [
    { name: "current", kind: "property", summary: "Effective locale and whether it came from auto detection or the saved setting." },
    { name: "list", kind: "method", signature: "list()", summary: "List available language packs and translated-key completeness." },
    { name: "get", kind: "method", signature: "get(code) | get(code, area, options?)", summary: "Read pack metadata or one bounded page of translated messages with user/built-in provenance." },
    { name: "areas", kind: "method", signature: "areas()", summary: "List English message areas and entry counts." },
    { name: "english", kind: "method", signature: "english(area, options?)", summary: "Read one bounded page of English source messages, placeholders, notes, and hashes." },
    { name: "missing", kind: "method", signature: "missing(code, area?)", summary: "List English keys absent from the effective merged pack." },
    { name: "stale", kind: "method", signature: "stale(code, area?)", summary: "List source-hash mismatches and count translations without source hashes." },
    { name: "validate", kind: "method", signature: "validate(pack)", summary: "Validate a language pack without writing it; warnings explain ignored entries." },
    { name: "validateBoard", kind: "method", signature: "validateBoard(boardRoot, code)", summary: "Validate a board language pack against that board's declared default; reports warnings and untranslated keys." },
    { name: "save", kind: "method", signature: "save(pack, options?)", summary: "Validate and atomically save a user language pack; replaces by default or merges user messages with { merge: true }. Any warning refuses the write." },
    { name: "delete", kind: "method", signature: "delete(code)", summary: "Delete a user language pack only; built-in packs cannot be removed." },
    { name: "apply", kind: "method", signature: "apply(code)", summary: "Apply auto, English, or an available language pack and reload every window; ask the user first." },
];

export function describeLanguages(instance: unknown): IAiVisionDescriptor {
    const languages = instance as ILanguages;
    return {
        kind: "Languages",
        summary: "Read, validate, save, and delete interface language packs, and apply an available language.",
        members: LANGUAGE_MEMBERS,
        help: `app.languages reads, validates, saves, and applies interface language packs. Use areas() to find an area, then english(area, { offset, limit }) to read pages; pages default to 100 entries and are capped at 200. get(code, area, options) returns only translated messages, with each entry's from field identifying user or built-in provenance; user values win when the same code exists in both locations. get(code) returns metadata and counts only. missing(code) audits the effective merged translations. stale(code) lists keys whose present source hash differs from current English; translations with no source hash are counted as unverified, not stale. validate(pack) returns loader warnings without writing. save(pack, options?) writes only to the user language folder, replaces by default, or merges only the existing user pack with { merge: true }; any validation warning refuses the write, so fix every warning before saving. delete(code) removes only a user pack; built-in packs are never deleted. apply(code) accepts auto, en, en-XA in development, or a code with an available pack. It reloads every window, including this one, so an agent must ask the user first. validateBoard(boardRoot, code) reads the board manifest and language files and returns validation warnings plus missing (default-pack keys the pack does not translate; they fall back and do not affect valid) without changing the app locale. Translated board packs also carry manifest.* display keys that the default pack lacks; that is expected.`,
        summarize: () => ({ kind: "Languages", current: languages.current.code }),
    };
}
