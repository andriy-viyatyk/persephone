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

type MessagesOf<T> = { [K in keyof T]: T[K] extends { message: infer M } ? M : never };
export const englishCatalog = {
    common: Object.fromEntries(Object.entries(commonCatalog).map(([key, entry]) => [key, entry.message])),
    main: Object.fromEntries(Object.entries(mainCatalog).map(([key, entry]) => [key, entry.message])),
    settings: Object.fromEntries(Object.entries(settingsCatalog).map(([key, entry]) => [key, entry.message])),
    dialogs: Object.fromEntries(Object.entries(dialogsCatalog).map(([key, entry]) => [key, entry.message])),
    shell: Object.fromEntries(Object.entries(shellCatalog).map(([key, entry]) => [key, entry.message])),
    editors: Object.fromEntries(Object.entries(editorsCatalog).map(([key, entry]) => [key, entry.message])),
    menus: Object.fromEntries(Object.entries(menusCatalog).map(([key, entry]) => [key, entry.message])),
    api: Object.fromEntries(Object.entries(apiCatalog).map(([key, entry]) => [key, entry.message])),
    browser: Object.fromEntries(Object.entries(browserCatalog).map(([key, entry]) => [key, entry.message])),
    board: Object.fromEntries(Object.entries(boardCatalog).map(([key, entry]) => [key, entry.message])),
} as unknown as {
    common: MessagesOf<typeof commonCatalog>;
    main: MessagesOf<typeof mainCatalog>;
    settings: MessagesOf<typeof settingsCatalog>;
    dialogs: MessagesOf<typeof dialogsCatalog>;
    shell: MessagesOf<typeof shellCatalog>;
    editors: MessagesOf<typeof editorsCatalog>;
    menus: MessagesOf<typeof menusCatalog>;
    api: MessagesOf<typeof apiCatalog>;
    browser: MessagesOf<typeof browserCatalog>;
    board: MessagesOf<typeof boardCatalog>;
};

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
    [Name in PlaceholderNames<MessageFor<K>>]: string | number;
} & (MessageFor<K> extends { one: string; other: string } ? { count: number } : object);
type PlaceholderNames<T> = T extends string
    ? T extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never
    : T extends object ? PlaceholderNames<T[keyof T]> : never;
export type { EnglishMessage };
