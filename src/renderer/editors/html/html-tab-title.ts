import { t } from "../../../shared/i18n/t";

export function formatHtmlTabTitle(title?: string): string | undefined {
    return title === "Pasted HTML" ? t("api.pastedHtml") : undefined;
}
