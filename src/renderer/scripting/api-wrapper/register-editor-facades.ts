import { registerEditorFacade } from "./editor-facade-registry";
import { BOARD_EDITOR_ID_PREFIX, isBoardEditorId, parseBoardEditorId } from "../../../shared/board/board-editor-id";
import type { MonacoEditor } from "../../editors/monaco/MonacoEditor";
import type { GridEditor } from "../../editors/grid/GridEditor";
import type { EnvVarsEditor } from "../../editors/env-vars/EnvVarsEditor";
import type { ArchiveEditor } from "../../editors/archive/ArchiveEditor";
import type { LinkEditor } from "../../editors/link-editor";
import type { MarkdownEditor } from "../../editors/markdown";
import type { AboutEditor } from "../../editors/about/AboutEditor";
import type { SvgEditor } from "../../editors/svg";
import type { HtmlEditor } from "../../editors/html";
import type { MermaidEditor } from "../../editors/mermaid";
import type { BrowserEditor } from "../../editors/browser/BrowserEditor";
import type { McpInspectorEditorModel } from "../../editors/mcp-inspector/McpInspectorEditorModel";
import type { ImageEditor } from "../../editors/image/ImageEditor";
import type { VideoEditor } from "../../editors/video/VideoEditor";
import type { FileDiffEditor } from "../../editors/file-diff/FileDiffEditor";
import type { LogViewEditor } from "../../editors/log-view/LogViewEditor";
import type { CategoryEditorModel } from "../../editors/category/CategoryEditorModel";
import type { GitTreeEditorModel } from "../../editors/git-tree/GitTreeEditorModel";
import type { BoardEditorModel } from "../../editors/board/BoardEditorModel";
import type { BoardInfoEditorModel } from "../../editors/board-info/BoardInfoEditorModel";
import type { ToolsetEditorModel } from "../../editors/toolset/ToolsetEditorModel";
import type { ToolsHubEditor } from "../../editors/tools-hub/ToolsHubEditor";
import type { MnemeConfigEditorModel } from "../../editors/mneme-config/MnemeConfigEditorModel";
import type { MnemeRootEditorModel } from "../../editors/mneme-root/MnemeRootEditorModel";
import { TextEditorFacade } from "./TextEditorFacade";
import { GridEditorFacade } from "./GridEditorFacade";
import { EnvVarsEditorFacade } from "./EnvVarsEditorFacade";
import { ArchiveEditorFacade } from "./ArchiveEditorFacade";
import { LinkEditorFacade } from "./LinkEditorFacade";
import { MarkdownEditorFacade } from "./MarkdownEditorFacade";
import { AboutEditorFacade } from "./AboutEditorFacade";
import { SvgEditorFacade } from "./SvgEditorFacade";
import { HtmlEditorFacade } from "./HtmlEditorFacade";
import { MermaidEditorFacade } from "./MermaidEditorFacade";
import { BrowserEditorFacade } from "./BrowserEditorFacade";
import { McpInspectorFacade } from "./McpInspectorFacade";
import { ImageEditorFacade } from "./ImageEditorFacade";
import { VideoEditorFacade } from "./VideoEditorFacade";
import { FileDiffEditorFacade } from "./FileDiffEditorFacade";
import { LogViewEditorFacade } from "./LogViewEditorFacade";
import { FolderViewEditorFacade } from "./FolderViewEditorFacade";
import { GitTreeEditorFacade } from "./GitTreeEditorFacade";
import { BoardEditorFacade } from "./BoardEditorFacade";
import { BoardInfoEditorFacade } from "./BoardInfoEditorFacade";
import { ToolsetEditorFacade } from "./ToolsetEditorFacade";
import { ToolsHubEditorFacade } from "./ToolsHubEditorFacade";
import { MnemeConfigEditorFacade } from "./MnemeConfigEditorFacade";
import { MnemeRootEditorFacade } from "./MnemeRootEditorFacade";

registerEditorFacade<MonacoEditor>("monaco", (editor, id, name) => new TextEditorFacade(editor, id, name));
const gridFactory = (editor: GridEditor, id: string, name: string) => new GridEditorFacade(editor, id, name);
registerEditorFacade<GridEditor>("grid-json", gridFactory);
registerEditorFacade<GridEditor>("grid-csv", gridFactory);
registerEditorFacade<GridEditor>("grid-jsonl", gridFactory);
registerEditorFacade<EnvVarsEditor>("env-vars-view", (editor, _id, name) => new EnvVarsEditorFacade(editor, "env-vars-view", name));
registerEditorFacade<ArchiveEditor>("archive-view", (editor, _id, name) => new ArchiveEditorFacade(editor, "archive-view", name));
registerEditorFacade<LinkEditor>("link-view", (editor, id, name) => new LinkEditorFacade(editor, id, name));
registerEditorFacade<MarkdownEditor>("md-view", (editor, id, name) => new MarkdownEditorFacade(editor, id, name));
registerEditorFacade<AboutEditor>("about-view", (editor, _id, name) => new AboutEditorFacade(editor, "about-view", name));
registerEditorFacade<SvgEditor>("svg-view", (editor, id, name) => new SvgEditorFacade(editor, id, name));
registerEditorFacade<HtmlEditor>("html-view", (editor, id, name) => new HtmlEditorFacade(editor, id, name));
registerEditorFacade<MermaidEditor>("mermaid-view", (editor, id, name) => new MermaidEditorFacade(editor, id, name));
registerEditorFacade<BrowserEditor>("browser-view", (editor, _id, name, context) => new BrowserEditorFacade(editor, "browser-view", name, context));
registerEditorFacade<McpInspectorEditorModel>("mcp-view", (editor, id, name) => new McpInspectorFacade(editor, id, name));
registerEditorFacade<ImageEditor>("image-view", (editor, id, name) => new ImageEditorFacade(editor, id, name));
registerEditorFacade<VideoEditor>("video-view", (editor, id, name) => new VideoEditorFacade(editor, id, name));
registerEditorFacade<FileDiffEditor>("file-diff", (editor, id, name) => new FileDiffEditorFacade(editor, id, name));
registerEditorFacade<LogViewEditor>("log-view", (editor, _id, name) => new LogViewEditorFacade(editor, "log-view", name));
registerEditorFacade<CategoryEditorModel>("category-view", (editor, _id, name) => new FolderViewEditorFacade(editor, "category-view", name));
registerEditorFacade<GitTreeEditorModel>("git-tree", (editor, _id, name) => new GitTreeEditorFacade(editor, "git-tree", name));
registerEditorFacade<BoardEditorModel>("board-view", (editor, _id, name, context) => new BoardEditorFacade(editor, "board-view", name, context));
registerEditorFacade<BoardEditorModel>(
    BOARD_EDITOR_ID_PREFIX,
    (editor, id, name, context) => {
        if (!isCustomBoardEditorId(id)) throw new Error(`Invalid board editor family id: ${id}`);
        return new BoardEditorFacade(editor, id, name, context);
    },
    isCustomBoardEditorId,
);
registerEditorFacade<BoardInfoEditorModel>("board-info", (editor, _id, name) => new BoardInfoEditorFacade(editor, "board-info", name));
registerEditorFacade<ToolsetEditorModel>("toolset-view", (editor, _id, name) => new ToolsetEditorFacade(editor, "toolset-view", name));
registerEditorFacade<ToolsHubEditor>("tools-hub-view", (editor, _id, name) => new ToolsHubEditorFacade(editor, "tools-hub-view", name));
registerEditorFacade<MnemeConfigEditorModel>("mneme-config", (editor, _id, name) => new MnemeConfigEditorFacade(editor, "mneme-config", name));
registerEditorFacade<MnemeRootEditorModel>("mneme-root", (editor, _id, name) => new MnemeRootEditorFacade(editor, "mneme-root", name));

function isCustomBoardEditorId(id: string): id is `board-editor:${string}` {
    return isBoardEditorId(id) && parseBoardEditorId(id) !== null;
}
