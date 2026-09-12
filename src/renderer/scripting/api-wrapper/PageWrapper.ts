import { pagesModel } from "../../api/pages";
import type { PageModel } from "../../api/pages/PageModel";
import type { IPageHost } from "../../api/pages/IPageHost";
import { editorRegistry } from "../../editors/base/editorRegistry";
import type { EditorModel } from "../../editors/base/EditorModel";
import { isTextFileModel, type TextFileModel } from "../../editors/text/TextEditorModel";
import { customEditorRegistry, isBoardEditorId } from "../../editors/board/custom-editor-registry";
import type { BoardEditorModel } from "../../editors/board/BoardEditorModel";
import type { BoardInfoEditorModel } from "../../editors/board-info/BoardInfoEditorModel";
import { MonacoEditor } from "../../editors/monaco/MonacoEditor";
import { GridEditor } from "../../editors/grid/GridEditor";
import { NotebookEditor } from "../../editors/notebook/NotebookEditor";
import { RestClientEditor } from "../../editors/rest-client/RestClientEditor";
import { EnvVarsEditor } from "../../editors/env-vars/EnvVarsEditor";
import { ArchiveEditor } from "../../editors/archive/ArchiveEditor";
import { LinkEditor } from "../../editors/link-editor/LinkEditor";
import { MarkdownEditor } from "../../editors/markdown/MarkdownEditor";
import { SvgEditor } from "../../editors/svg/SvgEditor";
import { HtmlEditor } from "../../editors/html/HtmlEditor";
import { MermaidEditor } from "../../editors/mermaid/MermaidEditor";
import { DrawEditor } from "../../editors/draw/DrawEditor";
import type { ImageEditor } from "../../editors/image/ImageEditor";
import type { VideoEditor } from "../../editors/video/VideoEditor";
import type { FileDiffEditor } from "../../editors/file-diff/FileDiffEditor";
import type { BrowserEditorModel } from "../../editors/browser/BrowserEditorModel";
import type { McpInspectorEditorModel } from "../../editors/mcp-inspector/McpInspectorEditorModel";
import type { ScriptOutputFlags } from "../ScriptContext";
import type { IAiChild, IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import { agentMayAccessBrowserPage, privateBrowserRefusal } from "../../editors/browser/agent-access";
import { BrowserEditorFacade } from "./BrowserEditorFacade";
import { DrawEditorFacade } from "./DrawEditorFacade";
import { GenericEditorFacade } from "./GenericEditorFacade";
import { GridEditorFacade } from "./GridEditorFacade";
import { HtmlEditorFacade } from "./HtmlEditorFacade";
import { ImageEditorFacade } from "./ImageEditorFacade";
import { LinkEditorFacade } from "./LinkEditorFacade";
import { MarkdownEditorFacade } from "./MarkdownEditorFacade";
import { AboutEditorFacade } from "./AboutEditorFacade";
import type { IAiCallContext } from "../ai-vision/root";
import { McpInspectorFacade } from "./McpInspectorFacade";
import { MermaidEditorFacade } from "./MermaidEditorFacade";
import { NotebookEditorFacade } from "./NotebookEditorFacade";
import { RestClientEditorFacade } from "./RestClientEditorFacade";
import { EnvVarsEditorFacade } from "./EnvVarsEditorFacade";
import { ArchiveEditorFacade } from "./ArchiveEditorFacade";
import { PageEditorSwitchesNode } from "../ai-vision/page-editor-switches";
import { PagePanelsNode } from "../ai-vision/page-panels";
import { PageTabNode } from "../ai-vision/page-tab";
import { SvgEditorFacade } from "./SvgEditorFacade";
import { TextEditorFacade } from "./TextEditorFacade";
import { VideoEditorFacade } from "./VideoEditorFacade";
import { FileDiffEditorFacade } from "./FileDiffEditorFacade";
import { LogViewEditorFacade } from "./LogViewEditorFacade";
import type { LogViewEditor } from "../../editors/log-view/LogViewEditor";
import { FolderViewEditorFacade } from "./FolderViewEditorFacade";
import { GitTreeEditorFacade } from "./GitTreeEditorFacade";
import { BoardEditorFacade } from "./BoardEditorFacade";
import { BoardInfoEditorFacade } from "./BoardInfoEditorFacade";
import { ToolsetEditorFacade } from "./ToolsetEditorFacade";
import { ToolsHubEditorFacade } from "./ToolsHubEditorFacade";
import { MnemeConfigEditorFacade } from "./MnemeConfigEditorFacade";
import { MnemeRootEditorFacade } from "./MnemeRootEditorFacade";
import type { CategoryEditorModel } from "../../editors/category/CategoryEditorModel";
import type { GitTreeEditorModel } from "../../editors/git-tree/GitTreeEditorModel";
import type { ToolsetEditorModel } from "../../editors/toolset/ToolsetEditorModel";
import type { ToolsHubEditor } from "../../editors/tools-hub/ToolsHubEditor";
import type { MnemeConfigEditorModel } from "../../editors/mneme-config/MnemeConfigEditorModel";
import type { MnemeRootEditorModel } from "../../editors/mneme-root/MnemeRootEditorModel";
import type { AboutEditor } from "../../editors/about/AboutEditor";

type EditorOrHost = EditorModel | TextFileModel;
type EditorFacade =
    | TextEditorFacade | GridEditorFacade | NotebookEditorFacade | LinkEditorFacade
    | MarkdownEditorFacade | AboutEditorFacade | SvgEditorFacade | HtmlEditorFacade | MermaidEditorFacade
    | DrawEditorFacade | BrowserEditorFacade | McpInspectorFacade
    | ImageEditorFacade | VideoEditorFacade | FileDiffEditorFacade | RestClientEditorFacade
    | EnvVarsEditorFacade | ArchiveEditorFacade
    | LogViewEditorFacade | FolderViewEditorFacade | GitTreeEditorFacade | BoardEditorFacade
    | BoardInfoEditorFacade | ToolsetEditorFacade | ToolsHubEditorFacade
    | MnemeConfigEditorFacade | MnemeRootEditorFacade | GenericEditorFacade;
type EditorFacadeFactory =
    (editor: EditorModel, id: string, name: string, callContext?: IAiCallContext) => EditorFacade;

const BOARD_FACADE_FACTORY: EditorFacadeFactory = (editor, id, name, callContext) =>
    new BoardEditorFacade(editor as BoardEditorModel, id as "board-view" | `board-editor:${string}`, name, callContext);

const BOARD_INFO_FACADE_FACTORY: EditorFacadeFactory = (editor, id, name) =>
    new BoardInfoEditorFacade(editor as BoardInfoEditorModel, id as "board-info", name);

const FACADE_FOR_EDITOR: Record<string, EditorFacadeFactory> = {
    "monaco": (editor, id, name) => new TextEditorFacade(editor as MonacoEditor, id, name),
    "grid-json": (editor, id, name) => new GridEditorFacade(editor as GridEditor, id, name),
    "grid-csv": (editor, id, name) => new GridEditorFacade(editor as GridEditor, id, name),
    "grid-jsonl": (editor, id, name) => new GridEditorFacade(editor as GridEditor, id, name),
    "notebook-view": (editor, id, name) => new NotebookEditorFacade(editor as NotebookEditor, id, name),
    "rest-client": (editor, id, name) => new RestClientEditorFacade(editor as RestClientEditor, id as "rest-client", name),
    "env-vars-view": (editor, id, name) => new EnvVarsEditorFacade(editor as EnvVarsEditor, id as "env-vars-view", name),
    "archive-view": (editor, id, name) => new ArchiveEditorFacade(editor as ArchiveEditor, id as "archive-view", name),
    "link-view": (editor, id, name) => new LinkEditorFacade(editor as LinkEditor, id, name),
    "md-view": (editor, id, name) => new MarkdownEditorFacade(editor as MarkdownEditor, id, name),
    "about-view": (editor, id, name) => new AboutEditorFacade(editor as AboutEditor, id as "about-view", name),
    "svg-view": (editor, id, name) => new SvgEditorFacade(editor as SvgEditor, id, name),
    "html-view": (editor, id, name) => new HtmlEditorFacade(editor as HtmlEditor, id, name),
    "mermaid-view": (editor, id, name) => new MermaidEditorFacade(editor as MermaidEditor, id, name),
    "draw-view": (editor, id, name) => new DrawEditorFacade(editor as DrawEditor, id, name),
    "browser-view": (editor, id, name, callContext) => new BrowserEditorFacade(editor as unknown as BrowserEditorModel, id, name, callContext),
    "mcp-view": (editor, id, name) => new McpInspectorFacade(editor as unknown as McpInspectorEditorModel, id, name),
    "image-view": (editor, id, name) => new ImageEditorFacade(editor as unknown as ImageEditor, id, name),
    "video-view": (editor, id, name) => new VideoEditorFacade(editor as unknown as VideoEditor, id, name),
    "file-diff": (editor, id, name) => new FileDiffEditorFacade(editor as FileDiffEditor, id, name),
    "log-view": (editor, id, name) => new LogViewEditorFacade(editor as LogViewEditor, id as "log-view", name),
    "category-view": (editor, id, name) => new FolderViewEditorFacade(editor as CategoryEditorModel, id as "category-view", name),
    "git-tree": (editor, id, name) => new GitTreeEditorFacade(editor as GitTreeEditorModel, id as "git-tree", name),
    "board-view": BOARD_FACADE_FACTORY,
    "board-info": BOARD_INFO_FACADE_FACTORY,
    "toolset-view": (editor, id, name) => new ToolsetEditorFacade(editor as ToolsetEditorModel, id as "toolset-view", name),
    "tools-hub-view": (editor, id, name) => new ToolsHubEditorFacade(editor as ToolsHubEditor, id as "tools-hub-view", name),
    "mneme-config": (editor, id, name) => new MnemeConfigEditorFacade(editor as MnemeConfigEditorModel, id as "mneme-config", name),
    "mneme-root": (editor, id, name) => new MnemeRootEditorFacade(editor as MnemeRootEditorModel, id as "mneme-root", name),
};

const PAGE_MEMBERS: readonly IAiMember[] = [
    { name: "id", kind: "property", summary: "Stable page id (use in pages[\"<id>\"])." },
    { name: "title", kind: "property", summary: "Tab title." },
    { name: "filePath", kind: "property", summary: "Backing file path, or nothing for an unsaved page." },
    { name: "modified", kind: "property", summary: "Whether there are unsaved changes." },
    { name: "pinned", kind: "property", summary: "Whether the tab is pinned." },
    { name: "content", kind: "property", writable: true, summary: "The page's text (text-based editors only; empty for browser/image pages). Assign with \"value\"." },
    { name: "language", kind: "property", writable: true, summary: "Language id. Assigning changes it and returns { ok: true }; use page.tab.highlight(\"tab-language\") when the user asks where it is changed." },
    { name: "tab", kind: "property", node: true, summary: "This page's tab-strip entry and its visible controls." },
    { name: "editor", kind: "property", node: true, summary: "Current editor facade; inspect its id to discover the available operations. A tab left open after its editor was closed reports an empty id and no .editor child — open a file into it with pages.navigatePageTo, or close it." },
    { name: "editorSwitches", kind: "property", node: true, summary: "The current editor, toolbar-identical switch options, and unrestricted editor switching." },
    { name: "data", kind: "property", summary: "Free-form per-page data bag shared between scripts." },
    { name: "panels", kind: "property", node: true, summary: "Live sidebar panels, read-only open/width state, bare-id expansion, and whole-sidebar toggle." },
    { name: "grouped", kind: "property", summary: "The page shown beside this one.", caution: "reading it CREATES a grouped page if none exists" },
    { name: "runScript", kind: "method", signature: "runScript()", summary: "Run this page's JavaScript/TypeScript content as a script; returns the output text." },
];

const PAGE_HELP = `
One open page (tab). Plain properties describe it; content holds text for text-based editors and can
be assigned with value. editor is the current editor facade; inspect editor.id to narrow its operation
union (for example, if page.editor.id is "grid-json", page.editor.addRows(5) is valid). editorSwitches
exposes the toolbar's merged options and switchTo(id), which accepts any registered editor id.
tab is this page's tab-strip entry and its curated controls; its title remains available even when a
pinned tab hides title text. Use pages.showPage, closePage, pinTab, unpinTab, and moveTab for tab
actions. The panels node is a live view of the page's sidebar. Grouped is a side-by-side page and
creates one when none exists. A successful content read or assignment reports the raw source, not
that a structured editor rendered it successfully. Parse JSON before writing notebook or links,
or REST content, then activate the page and use window.screen.snapshot() when you need to verify the
rendered editor. A page can have NO editor: a tab stays open when its editor is closed under it (for
example after its board is deleted), rendering as an "Empty" tab. Such a page is listed here like any
other and can be activated, pinned, moved and closed; its editor id is empty, content and language
read empty, and pages.navigatePageTo(pageId, filePath) opens a file into it.
`;

interface IBrowserPrivacyState {
    profileName?: string;
    isIncognito?: boolean;
    isTor?: boolean;
    openedByAgent?: boolean;
    url?: string;
}

/**
 * One open page for the agent. Identified by its PAGE, not by its editor: a page whose main
 * editor has been detached (`mainEditorId === null`) is a real tab the user sees — it renders
 * the empty-page state and is titled "Empty" — so it must be visible and actionable here too
 * (US-1408). `model` is therefore nullable, and every member falls back to what such a page
 * genuinely has rather than throwing or pretending an editor is present.
 */
export class PageWrapper implements IAiVisible {
    constructor(
        private readonly model: EditorOrHost | null,
        private readonly releaseList: Array<() => void>,
        private readonly outputFlags?: ScriptOutputFlags,
        private readonly callContext?: IAiCallContext,
        /** The page this wrapper stands for. Optional so editor-first call sites keep working;
         *  required to represent a page that has no editor to derive it from. */
        private readonly pageModel?: PageModel | null,
    ) {}

    private get page(): IPageHost | PageModel | null {
        return this.pageModel ?? this.model?.page ?? null;
    }

    private get mainEditor(): EditorModel | null {
        const pageId = this.page?.id;
        if (!pageId) return null;
        return pagesModel.findPage(pageId)?.mainEditorInstance ?? null;
    }

    /** The empty id is meaningful: this page has no editor at all. Never fall back to "monaco"
     *  for such a page — an agent reading `page.editor.id === "monaco"` would go on to write
     *  text into a tab with nothing to write into. */
    private currentEditorId(): string {
        if (!this.model && !this.mainEditor) return "";
        return this.mainEditor?.editorId
            ?? (this.model?.state.get() as { editor?: string } | undefined)?.editor
            ?? "monaco";
    }

    /** False for a page whose editor was closed while the tab stayed open. */
    get hasEditor(): boolean { return !!this.model || !!this.mainEditor; }

    get id(): string { return this.page?.id ?? this.model?.id ?? ""; }
    get title(): string { return this.model?.title ?? "Empty"; }
    get modified(): boolean { return this.model?.modified ?? false; }
    get pinned(): boolean { return this.page?.pinned ?? false; }
    get filePath(): string | undefined { return this.model?.filePath; }

    get content(): string {
        return this.model && isTextFileModel(this.model) ? this.model.state.get().content : "";
    }

    set content(value: string) {
        if (this.model && isTextFileModel(this.model)) this.model.changeContent(value);
    }

    get language(): string { return this.model?.state.get().language ?? ""; }

    set language(value: string) {
        editorRegistry.assertKnownLanguage(value);
        if (!this.model) {
            throw new Error(
                `Page ${JSON.stringify(this.id)} has no editor, so it has no language. Open a `
                + "file into this empty tab with pages.navigatePageTo(pageId, filePath).",
            );
        }
        if (!this.model.noLanguage) this.model.changeLanguage(value);
    }

    get editor(): EditorFacade {
        const id = this.currentEditorId();
        if (!id) return new GenericEditorFacade("", "None");
        const name = editorRegistry.getById(id)?.name
            ?? customEditorRegistry.entries.find((entry) => entry.editorId === id)?.name
            ?? id;
        const editor = this.mainEditor;
        const factory = editor
            ? FACADE_FOR_EDITOR[id]
                ?? (isBoardEditorId(id) ? BOARD_FACADE_FACTORY : undefined)
            : undefined;
        return factory ? factory(editor, id, name, this.callContext) : new GenericEditorFacade(id, name);
    }

    get editorSwitches(): PageEditorSwitchesNode {
        return new PageEditorSwitchesNode(() => this.page);
    }

    get tab(): PageTabNode { return new PageTabNode(() => this.page); }

    // An editorless page has no editor to hold a script data bag. Hand back a fresh object so a
    // read or write is harmless rather than a TypeError mid-iteration; it does not persist.
    get data(): Record<string, unknown> { return this.model?.scriptData ?? {}; }
    get panels(): PagePanelsNode { return new PagePanelsNode(() => this.page); }

    get grouped(): PageWrapper {
        const pageId = this.id;
        const groupedPage = pagesModel.getGroupedPage(pageId);
        const editor = groupedPage?.mainEditor ?? pagesModel.requireGroupedText(pageId);
        return new GroupedPageWrapper(editor, this.releaseList, this.outputFlags, this.callContext);
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Page",
            summary: "One open page (tab): its text, language, editor facade, editor switches, live sidebar panels, and grouped page.",
            members: PAGE_MEMBERS,
            help: PAGE_HELP,
            identity: () => `pages[${JSON.stringify(this.id)}]`,
            children: () => this.aiChildren(),
            restricted: () => this.aiRestricted(),
            summarize: () => this.aiSummary(),
        };
    }

    private browserState(): IBrowserPrivacyState | undefined {
        return this.model && this.currentEditorId() === "browser-view"
            ? this.model.state.get() as IBrowserPrivacyState
            : undefined;
    }

    private aiRestricted(): string | undefined {
        const state = this.browserState();
        return !state || agentMayAccessBrowserPage(state) ? undefined : privateBrowserRefusal(state, "call");
    }

    private aiChildren(): IAiChild[] {
        const editor = this.editor;
        // No `.editor` child on an empty page: there is nothing to drive, and offering one would
        // read as "this page has an editor". `navigatePageTo` is what makes the tab useful again.
        const children: IAiChild[] = editor.id
            ? [{
                segment: ".editor",
                kind: editor.aiVision.kind,
                summary: `facade for the current editor (${editor.id})`,
            }]
            : [];
        const pageId = this.id;
        if (pagesModel.isGrouped(pageId)) {
            const grouped = pagesModel.getGroupedPage(pageId);
            if (grouped) children.push({ segment: ".grouped", kind: "Page", summary: `grouped beside this page: "${grouped.title}"` });
        }
        return children;
    }

    private aiSummary(): Record<string, unknown> {
        const editorId = this.editor.id;
        const summary: Record<string, unknown> = {
            kind: "Page", id: this.id, title: this.title, editor: editorId || null,
            language: this.language, filePath: this.filePath, modified: this.modified,
            pinned: this.pinned, active: pagesModel.activePage?.id === this.id,
        };
        if (!editorId) {
            summary.note = "This tab is open but has no editor. Open a file into it with "
                + "pages.navigatePageTo(pageId, filePath), or close it with pages.closePage(pageId).";
        }
        const state = this.browserState();
        if (state) {
            summary.profileName = state.profileName ?? "";
            summary.isIncognito = !!state.isIncognito;
            summary.isTor = !!state.isTor;
            if (state.openedByAgent) summary.openedByAgent = true;
            if (agentMayAccessBrowserPage(state) && state.url) summary.url = state.url;
        }
        return summary;
    }

    async runScript(): Promise<string> {
        if (!this.model) {
            throw new Error(`Page ${JSON.stringify(this.id)} has no editor, so there is no script to run.`);
        }
        const language = this.model.state.get().language ?? "";
        const { isScriptLanguage } = await import("../transpile");
        if (!isScriptLanguage(language)) throw new Error("runScript() is only available for javascript/typescript pages");
        const { scriptRunner } = await import("../ScriptRunner");
        return scriptRunner.runWithResult(this.model.id, this.content, this.model, language);
    }
}

class GroupedPageWrapper extends PageWrapper {
    constructor(
        model: EditorOrHost | null,
        releaseList: Array<() => void>,
        private readonly flags?: ScriptOutputFlags,
        callContext?: IAiCallContext,
        pageModel?: PageModel | null,
    ) {
        super(model, releaseList, flags, callContext, pageModel);
    }

    set content(value: string) {
        super.content = value;
        if (this.flags) this.flags.groupedContentWritten = true;
    }

    get content(): string { return super.content; }
}
