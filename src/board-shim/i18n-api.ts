import { ENGLISH_BOARD_HOST_TEXT } from "../shared/board/host-text";
import { formatMessage } from "../shared/i18n/format-message";
import type { BoardBootContext, BoardHostTextId } from "../ipc/board-bridge/boot";

export type HostText = (id: BoardHostTextId, params?: { error?: string }) => string;

export function createI18nApi(deps: { boot: BoardBootContext }) {
    const { boot } = deps;
    const locale = Object.freeze({ code: boot.i18n.locale.code });
    const messageTables = boot.i18n.tables;
    let pluralRules: Intl.PluralRules;
    try { pluralRules = new Intl.PluralRules(locale.code); }
    catch { pluralRules = new Intl.PluralRules("en"); }
    function translate(key: string, params?: Record<string, unknown>): string {
        let message: string | Partial<Record<"zero" | "one" | "two" | "few" | "many" | "other", string>> | undefined;
        for (const table of messageTables) {
            if (Object.prototype.hasOwnProperty.call(table, key)) {
                message = table[key];
                if (message !== undefined) break;
            }
        }
        if (message === undefined) return key;
        return formatMessage(message, undefined, params, count => pluralRules.select(count)) ?? key;
    }
    const has = (key: string): boolean => messageTables.some((table) => Object.prototype.hasOwnProperty.call(table, key));
    const hostText: HostText = (id, params) => {
        const template = boot.hostText[id] || ENGLISH_BOARD_HOST_TEXT[id];
        return params?.error === undefined ? template : template.replace(/\{error\}/g, params.error);
    };
    return { api: { locale, i18n: { t: translate, has } }, hostText };
}
