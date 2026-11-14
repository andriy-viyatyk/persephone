import { t } from "../../../shared/i18n/t";

export function formatLinkTabTitle(title?: string): string | undefined {
    return title?.endsWith(" — Resources")
        ? t("browser.resourcesTitle", { title: title.slice(0, -" — Resources".length) })
        : undefined;
}
