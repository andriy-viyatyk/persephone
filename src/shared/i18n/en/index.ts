import { commonCatalog, type EnglishMessage } from "./common";
import { mainCatalog } from "./main";
import { settingsCatalog } from "./settings";
import { dialogsCatalog } from "./dialogs";
import { shellCatalog } from "./shell";
import { editorsCatalog } from "./editors";
import { menusCatalog } from "./menus";
import { apiCatalog } from "./api";
import { browserCatalog } from "./browser";
import { boardCatalog } from "./board";
import { explorerCatalog } from "./explorer";
import { linksCatalog } from "./links";
import { gitCatalog } from "./git";
import { mnemeCatalog } from "./mneme";
import { aboutCatalog } from "./about";
import { toolsCatalog } from "./tools";
import { uikitCatalog } from "./uikit";
import { logViewCatalog } from "./logView";
import { voiceTypingCatalog } from "./voiceTyping";
import { transcriptCatalog } from "./transcript";
import { translationCatalog } from "./translation";

export const englishEntryCatalogs = {
    common: commonCatalog,
    main: mainCatalog,
    settings: settingsCatalog,
    dialogs: dialogsCatalog,
    shell: shellCatalog,
    editors: editorsCatalog,
    menus: menusCatalog,
    api: apiCatalog,
    browser: browserCatalog,
    board: boardCatalog,
    explorer: explorerCatalog,
    links: linksCatalog,
    git: gitCatalog,
    mneme: mnemeCatalog,
    about: aboutCatalog,
    tools: toolsCatalog,
    uikit: uikitCatalog,
    logView: logViewCatalog,
    voiceTyping: voiceTypingCatalog,
    transcript: transcriptCatalog,
    translation: translationCatalog,
} as const;

type MessagesOf<T> = { [K in keyof T]: T[K] extends { message: infer M } ? M : never };
export const englishCatalog = Object.fromEntries(
    Object.entries(englishEntryCatalogs).map(([area, entries]) => [area, Object.fromEntries(
        Object.entries(entries).map(([key, entry]) => [key, entry.message]),
    )]),
) as { [Area in keyof typeof englishEntryCatalogs]: MessagesOf<(typeof englishEntryCatalogs)[Area]> };

export type EnglishCatalog = typeof englishCatalog;
export type MessageKey = {
    [Area in keyof EnglishCatalog]: `${Area & string}.${keyof EnglishCatalog[Area] & string}`
}[keyof EnglishCatalog];
export type MessageFor<K extends MessageKey> = K extends `${infer Area}.${infer Key}`
    ? Area extends keyof EnglishCatalog
        ? Key extends keyof EnglishCatalog[Area]
            ? EnglishCatalog[Area][Key]
            : never
        : never
    : never;
export type MessageParams<K extends MessageKey> = {
    [Name in PlaceholderNames<MessageText<MessageFor<K>>>]: string | number;
} & (MessageFor<K> extends { one: string; other: string } ? { count: number } : object);
type MessageText<T> = T extends { one: infer One extends string; other: infer Other extends string }
    ? One | Other
    : T;
type PlaceholderNames<T> = T extends string
    ? T extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never
    : T extends object ? PlaceholderNames<T[keyof T]> : never;
export type { EnglishMessage };
