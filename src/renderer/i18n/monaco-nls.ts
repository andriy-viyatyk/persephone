import { getActiveLocale } from "../../shared/i18n/active-locale";

const monacoGlobal = globalThis as typeof globalThis & {
    _VSCODE_NLS_LANGUAGE?: string;
};

/** Load Monaco's translated messages before any Monaco module is imported. */
export function loadMonacoNls(): Promise<void> | undefined {
    const locale = getActiveLocale().toLowerCase();
    const baseLanguage = locale.split("-")[0];
    let monacoLanguage: string;
    let messages: Promise<unknown>;

    switch (locale) {
        case "zh-tw":
            monacoLanguage = "zh-tw";
            // @ts-expect-error Monaco ships this side-effect module without a declaration.
            messages = import("monaco-editor/esm/nls.messages.zh-tw.js");
            break;
        case "zh-cn":
            monacoLanguage = "zh-cn";
            // @ts-expect-error Monaco ships this side-effect module without a declaration.
            messages = import("monaco-editor/esm/nls.messages.zh-cn.js");
            break;
        case "pt-br":
            monacoLanguage = "pt-br";
            // @ts-expect-error Monaco ships this side-effect module without a declaration.
            messages = import("monaco-editor/esm/nls.messages.pt-br.js");
            break;
        default:
            switch (baseLanguage) {
                case "cs":
                    monacoLanguage = "cs";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.cs.js");
                    break;
                case "de":
                    monacoLanguage = "de";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.de.js");
                    break;
                case "es":
                    monacoLanguage = "es";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.es.js");
                    break;
                case "fr":
                    monacoLanguage = "fr";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.fr.js");
                    break;
                case "it":
                    monacoLanguage = "it";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.it.js");
                    break;
                case "ja":
                    monacoLanguage = "ja";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.ja.js");
                    break;
                case "ko":
                    monacoLanguage = "ko";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.ko.js");
                    break;
                case "pl":
                    monacoLanguage = "pl";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.pl.js");
                    break;
                case "pt":
                    monacoLanguage = "pt-br";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.pt-br.js");
                    break;
                case "tr":
                    monacoLanguage = "tr";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.tr.js");
                    break;
                case "zh":
                    monacoLanguage = "zh-cn";
                    // @ts-expect-error Monaco ships this side-effect module without a declaration.
                    messages = import("monaco-editor/esm/nls.messages.zh-cn.js");
                    break;
                default:
                    return undefined;
            }
    }

    return messages.then(() => {
        monacoGlobal._VSCODE_NLS_LANGUAGE = monacoLanguage;
    });
}
