import { englishMessage, t } from "../../../shared/i18n/t";
import { boardDisplayText, boardMetadataKeys } from "../../editors/board/board-display-text";

/** Localized presentation for app-owned page titles whose stored/API identity stays English. */
export function displayPageTitle(editor: string | undefined, title: string | undefined, boardRoot?: string): string {
    if (editor === "about-view" && title === "About") return t("editors.about");
    if (editor === "board-info" && title === englishMessage("board.infoInstallTitle")) return t("board.infoInstallTitle");
    if (editor === "toolset-view" && title === englishMessage("board.agentTool")) return t("board.agentTool");
    if (editor === "video-view" && title === englishMessage("editors.videoPlayer")) return t("editors.videoPlayer");
    if ((editor === "board-view" || editor === "board-info") && boardRoot && title) {
        return boardDisplayText(boardRoot, undefined, boardMetadataKeys.name, title);
    }
    if (editor === "board-view" && title === englishMessage("board.editor")) return t("board.editor");
    if (editor === "settings-view" && title === englishMessage("settings.pageTitle")) return t("settings.pageTitle");
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
    if (editor === "mcp-view" && title === "MCP Inspector") return t("tools.mcpInspectorPageTitle");
    if (editor === "tools-hub-view" && title === "Tools & Editors") return t("tools.toolsHubPageTitle");
    return title ?? "";
}
