import { t } from "../../../shared/i18n/t";

/** Localized presentation for app-owned page titles whose stored/API identity stays English. */
export function displayPageTitle(editor: string | undefined, title: string | undefined): string {
    if (editor === "about-view" && title === "About") return t("editors.about");
    if (editor === "browser-view" && title === "Browser") return t("browser.pageTitle");
    if (editor === "browser-view" && title === "Browser (agent)") return t("browser.pageTitleAgent");
    if (editor === "monaco" && title?.startsWith("Source: ")) {
        return t("browser.sourceTitle", { title: title.slice("Source: ".length) });
    }
    if (editor === "monaco" && title?.startsWith("DOM: ")) {
        return t("browser.domTitle", { title: title.slice("DOM: ".length) });
    }
    if (editor === "link-view" && title?.endsWith(" — Resources")) {
        return t("browser.resourcesTitle", { title: title.slice(0, -" — Resources".length) });
    }
    if (editor === "html-view" && title === "Pasted HTML") return t("api.pastedHtml");
    return title ?? "";
}
