import { t } from "../../../shared/i18n/t";

/** Localized presentation for app-owned page titles whose stored/API identity stays English. */
export function displayPageTitle(editor: string | undefined, title: string | undefined): string {
    if (editor === "html-view" && title === "Pasted HTML") return t("api.pastedHtml");
    return title ?? "";
}
