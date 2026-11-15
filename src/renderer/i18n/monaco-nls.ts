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
            messages = import("monaco-editor/nls/lang/zh-tw.js");
            break;
        case "zh-cn":
            monacoLanguage = "zh-cn";
            messages = import("monaco-editor/nls/lang/zh-cn.js");
            break;
        case "pt-br":
            monacoLanguage = "pt-br";
            messages = import("monaco-editor/nls/lang/pt-br.js");
            break;
        default:
            switch (baseLanguage) {
                case "cs":
                    monacoLanguage = "cs";
                    messages = import("monaco-editor/nls/lang/cs.js");
                    break;
                case "de":
                    monacoLanguage = "de";
                    messages = import("monaco-editor/nls/lang/de.js");
                    break;
                case "es":
                    monacoLanguage = "es";
                    messages = import("monaco-editor/nls/lang/es.js");
                    break;
                case "fr":
                    monacoLanguage = "fr";
                    messages = import("monaco-editor/nls/lang/fr.js");
                    break;
                case "it":
                    monacoLanguage = "it";
                    messages = import("monaco-editor/nls/lang/it.js");
                    break;
                case "ja":
                    monacoLanguage = "ja";
                    messages = import("monaco-editor/nls/lang/ja.js");
                    break;
                case "ko":
                    monacoLanguage = "ko";
                    messages = import("monaco-editor/nls/lang/ko.js");
                    break;
                case "pl":
                    monacoLanguage = "pl";
                    messages = import("monaco-editor/nls/lang/pl.js");
                    break;
                case "pt":
                    monacoLanguage = "pt-br";
                    messages = import("monaco-editor/nls/lang/pt-br.js");
                    break;
                case "tr":
                    monacoLanguage = "tr";
                    messages = import("monaco-editor/nls/lang/tr.js");
                    break;
                case "zh":
                    monacoLanguage = "zh-cn";
                    messages = import("monaco-editor/nls/lang/zh-cn.js");
                    break;
                default:
                    return undefined;
            }
    }

    return messages.then(() => {
        monacoGlobal._VSCODE_NLS_LANGUAGE = monacoLanguage;
    });
}
