import { t } from "../../../shared/i18n/t";

export function formatMonacoTabTitle(title?: string): string | undefined {
    if (title?.startsWith("Source: ")) return t("browser.sourceTitle", { title: title.slice("Source: ".length) });
    if (title?.startsWith("DOM: ")) return t("browser.domTitle", { title: title.slice("DOM: ".length) });
    return undefined;
}
