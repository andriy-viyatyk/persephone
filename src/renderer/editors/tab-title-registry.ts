import { EditorId } from "../../shared/editor-ids";
import { formatAboutTabTitle } from "./about/about-tab-title";
import { formatBoardTabTitle, type BoardTabTitleContext, type BoardTabTitleState } from "./board/board-tab-title";
import { formatBoardInfoTabTitle, type BoardInfoTabTitleState } from "./board-info/board-info-tab-title";
import { formatBrowserTabTitle } from "./browser/browser-tab-title";
import { formatMonacoTabTitle } from "./monaco/monaco-tab-title";
import { formatLinkTabTitle } from "./link-editor/link-tab-title";
import { formatHtmlTabTitle } from "./html/html-tab-title";
import { formatMcpTabTitle } from "./mcp-inspector/mcp-tab-title";
import { formatToolsHubTabTitle } from "./tools-hub/tools-hub-tab-title";
import { formatSettingsTabTitle } from "./settings/settings-tab-title";
import { formatToolsetTabTitle } from "./toolset/toolset-tab-title";
import { formatVideoTabTitle } from "./video/video-tab-title";

export interface TabTitleState extends BoardTabTitleState, BoardInfoTabTitleState {
    editor?: string;
    title?: string;
}

export interface TabTitleOptions {
    context: BoardTabTitleContext;
    model?: unknown;
    editorStateTitle?: string;
}

type TabTitleFormatter = (state: TabTitleState, options: TabTitleOptions) => string | undefined;
type EditorIdValue = typeof EditorId[keyof typeof EditorId];

/** Localized presentation for app-owned page titles whose stored/API identity stays English. */
const TAB_TITLE_FORMATTERS: Partial<Record<EditorIdValue, TabTitleFormatter>> = {
    [EditorId.aboutView]: ({ title }) => formatAboutTabTitle(title),
    [EditorId.boardView]: (state, options) => formatBoardTabTitle(
        state,
        options.context,
        options.model,
        options.editorStateTitle,
    ),
    [EditorId.boardInfo]: (state) => formatBoardInfoTabTitle(state),
    [EditorId.toolsetView]: ({ title }) => formatToolsetTabTitle(title),
    [EditorId.videoView]: ({ title }) => formatVideoTabTitle(title),
    [EditorId.browserView]: ({ title }) => formatBrowserTabTitle(title),
    [EditorId.monaco]: ({ title }) => formatMonacoTabTitle(title),
    [EditorId.linkView]: ({ title }) => formatLinkTabTitle(title),
    [EditorId.htmlView]: ({ title }) => formatHtmlTabTitle(title),
    [EditorId.mcpView]: ({ title }) => formatMcpTabTitle(title),
    [EditorId.toolsHubView]: ({ title }) => formatToolsHubTabTitle(title),
    [EditorId.settingsView]: ({ title }) => formatSettingsTabTitle(title),
};

export function displayPageTitle(state: TabTitleState, options: TabTitleOptions): string {
    return TAB_TITLE_FORMATTERS[state.editor as EditorIdValue]?.(state, options) ?? state.title ?? "";
}
