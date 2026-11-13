import { EditorId } from "../../../shared/editor-ids";
import { englishMessage, t } from "../../../shared/i18n/t";
import { boardDisplayText, boardMetadataKeys } from "../../api/boards/board-display-text";

/** Localized presentation for app-owned page titles whose stored/API identity stays English. */
export function displayPageTitle(editor: string | undefined, title: string | undefined, boardRoot?: string): string {
    if (editor === EditorId.aboutView && title === "About") return t("editors.about");
    if (editor === EditorId.boardInfo && title === englishMessage("board.infoInstallTitle")) return t("board.infoInstallTitle");
    if (editor === EditorId.toolsetView && title === englishMessage("board.agentTool")) return t("board.agentTool");
    if (editor === EditorId.videoView && title === englishMessage("editors.videoPlayer")) return t("editors.videoPlayer");
    if ((editor === EditorId.boardView || editor === EditorId.boardInfo) && boardRoot && title) {
        return boardDisplayText(boardRoot, undefined, boardMetadataKeys.name, title);
    }
    if (editor === EditorId.boardView && title === englishMessage("board.editor")) return t("board.editor");
    if (editor === EditorId.settingsView && title === englishMessage("settings.pageTitle")) return t("settings.pageTitle");
    if (editor === EditorId.browserView && title === "Browser") return t("browser.pageTitle");
    if (editor === EditorId.browserView && title === "Browser (agent)") return t("browser.pageTitleAgent");
    if (editor === EditorId.monaco && title?.startsWith("Source: ")) {
        return t("browser.sourceTitle", { title: title.slice("Source: ".length) });
    }
    if (editor === EditorId.monaco && title?.startsWith("DOM: ")) {
        return t("browser.domTitle", { title: title.slice("DOM: ".length) });
    }
    if (editor === EditorId.linkView && title?.endsWith(" — Resources")) {
        return t("browser.resourcesTitle", { title: title.slice(0, -" — Resources".length) });
    }
    if (editor === EditorId.htmlView && title === "Pasted HTML") return t("api.pastedHtml");
    if (editor === EditorId.mcpView && title === "MCP Inspector") return t("tools.mcpInspectorPageTitle");
    if (editor === EditorId.toolsHubView && title === "Tools & Editors") return t("tools.toolsHubPageTitle");
    return title ?? "";
}
