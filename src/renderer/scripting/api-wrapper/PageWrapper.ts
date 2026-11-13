import "./register-editor-facades";
import { pages } from "../../api/pages";
import type { PageModel } from "../../api/pages/PageModel";
import type { IPageHost } from "../../api/pages/IPageHost";
import { editorRegistry } from "../../editors/base/editorRegistry";
import type { EditorModel } from "../../editors/base/EditorModel";
import type { IContentPipe } from "../../api/types/io.pipe";
import { customEditorRegistry } from "../../api/boards/custom-editor-registry";
import type { BrowserEditor } from "../../editors/browser/BrowserEditor";
import type { ScriptOutputFlags } from "../ScriptContext";
import type { IAiChild, IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import { agentMayAccessBrowserPage, privateBrowserRefusal } from "../../editors/browser/agent-access";
import { editorFacadeRegistry, type IEditorFacade } from "./editor-facade-registry";
import type { IAiCallContext } from "../ai-vision/root";
import { PageEditorSwitchesNode } from "../ai-vision/page-editor-switches";
import { PagePanelsNode } from "../ai-vision/page-panels";
import { PageTabNode } from "../ai-vision/page-tab";
import { isArchiveFile, isArchivePath, isPlainLocalPath } from "../../core/utils/file-path";

const PAGE_MEMBERS: readonly IAiMember[] = [
    { name: "id", kind: "property", summary: "Stable page id (use in pages[\"<id>\"])." },
    { name: "title", kind: "property", summary: "Tab title." },
    { name: "filePath", kind: "property", summary: "Backing file path, or nothing for an unsaved page." },
    { name: "workspaceFolder", kind: "property", summary: "The project folder this page's Explorer is rooted at — this page's workspace (Persephone's equivalent of a VS Code workspace folder). Nothing when the page has no folder Explorer." },
    { name: "modified", kind: "property", summary: "Whether there are unsaved changes, including a board-reported draft." },
    { name: "pinned", kind: "property", summary: "Whether the tab is pinned on the left; right-pinned tabs are false." },
    { name: "pinSide", kind: "property", summary: "Tab pin side: left, right, or undefined when unpinned." },
    { name: "content", kind: "property", writable: true, summary: "The page's text (text-based editors only; empty for browser/image pages). Assign with \"value\"." },
    { name: "pipe", kind: "property", node: true, summary: "The current primary content pipe and its live provider/transformer status." },
    { name: "language", kind: "property", writable: true, summary: "Language id. Assigning changes it and returns { ok: true }; use page.tab.highlight(\"tab-language\") when the user asks where it is changed." },
    { name: "tab", kind: "property", node: true, summary: "This page's tab-strip entry and its visible controls." },
    { name: "editor", kind: "property", node: true, summary: "Current editor facade; inspect its id to discover the available operations. A tab left open after its editor was closed reports an empty id and no .editor child — open a file into it with pages.navigatePageTo, or close it." },
    { name: "editorSwitches", kind: "property", node: true, summary: "The current editor, toolbar-identical switch options, and unrestricted editor switching." },
    { name: "data", kind: "property", summary: "Free-form per-page data bag shared between scripts." },
    { name: "panels", kind: "property", node: true, summary: "Live sidebar panels, writable persistent width, bare-id expansion, and whole-sidebar toggle." },
    { name: "grouped", kind: "property", summary: "The page shown beside this one.", caution: "reading it CREATES a grouped page if none exists" },
    { name: "runScript", kind: "method", signature: "runScript()", summary: "Run this page's JavaScript/TypeScript content as a script; returns the output text." },
];

const PAGE_HELP = `
One open page (tab). page and pages.activePage identify the active page the user works on; a
right-pinned page may appear in a popover over it without becoming active. Plain properties describe
the page; content holds text for text-based editors and can
be assigned with value. editor is the current editor facade; inspect editor.id to narrow its operation
union (for example, if page.editor.id is "grid-json", page.editor.addRows(5) is valid). editorSwitches
exposes the toolbar's merged options and switchTo(id), which accepts any registered editor id.
tab is this page's tab-strip entry and its curated controls; its title remains available even when a
pinned tab hides title text. Use pages.showPage, closePage, pinTab, unpinTab, and moveTab for tab
actions. The panels node is a live view of the page's sidebar. Grouped is a side-by-side page and
creates one when none exists. A successful content read or assignment reports the raw source, not
that a structured editor rendered it successfully. Parse JSON before writing structured content,
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
 *. `model` is therefore nullable, and every member falls back to what such a page
 * genuinely has rather than throwing or pretending an editor is present.
 */
export class PageWrapper implements IAiVisible {
    constructor(
        private readonly model: EditorModel | null,
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
        return pages.query.findPage(pageId)?.mainEditor ?? null;
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
    get ready(): Promise<void> { return this.pageModel?.restore.ready ?? Promise.resolve(); }
    get title(): string {
        return this.model?.contentHost?.state.get().title ?? this.model?.title ?? "Empty";
    }
    get modified(): boolean { return this.model?.modified ?? false; }
    get pinned(): boolean { return this.page?.pinned ?? false; }
    get pinSide(): "left" | "right" | undefined { return pages.query.findPage(this.id)?.pinSide; }
    get filePath(): string | undefined {
        return this.model?.contentHost
            ? this.model.contentHost.filePath
            : this.model?.filePath;
    }

    /** The folder this page's Explorer is rooted at — Persephone's equivalent of a VS Code
     * workspace folder; undefined when the page has no Explorer or is browsing an archive. */
    get workspaceFolder(): string | undefined {
        const explorer = (this.page as PageModel | null)?.findExplorer?.();
        if (!explorer) return undefined;
        const state = explorer.state.get() as { rootPath?: string };
        const rootPath = state.rootPath;
        // Archive pages use the raw archive file as the Explorer root, so reject both archive
        // entries and archive files while retaining the required plain-local-path gate.
        if (!rootPath || !isPlainLocalPath(rootPath)
            || isArchivePath(rootPath) || isArchiveFile(rootPath)) {
            return undefined;
        }
        return rootPath;
    }

    get content(): string {
        return this.model?.contentHost?.state.get().content ?? "";
    }

    get pipe(): IContentPipe | undefined {
        const host = this.model?.contentHost;
        return host ? host.pipe ?? undefined : this.mainEditor?.pipe ?? undefined;
    }

    set content(value: string) {
        this.model?.contentHost?.changeContent(value);
    }

    get language(): string {
        return this.model?.contentHost
            ? this.model.contentHost.state.get().language ?? ""
            : this.model?.state.get().language ?? "";
    }

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

    get editor(): IEditorFacade {
        const id = this.currentEditorId();
        if (!id) return editorFacadeRegistry.create("", null, "None");
        const name = customEditorRegistry.findByEditorId(id)?.name
            ?? editorRegistry.resolveDefinition(id)?.name
            ?? id;
        return editorFacadeRegistry.create(id, this.mainEditor, name, this.callContext);
    }

    get editorSwitches(): PageEditorSwitchesNode {
        return new PageEditorSwitchesNode(() => this.page);
    }

    get tab(): PageTabNode { return new PageTabNode(() => this.page); }

    // An editorless page has no editor to hold a script data bag. Hand back a fresh object so a
    // read or write is harmless rather than a TypeError mid-iteration; it does not persist.
    get data(): Record<string, unknown> {
        return this.model?.contentHost?.scriptData ?? this.model?.scriptData ?? {};
    }
    get panels(): PagePanelsNode { return new PagePanelsNode(() => this.page); }

    get grouped(): PageWrapper {
        const pageId = this.id;
        const groupedPage = pages.query.getGroupedPage(pageId);
        const editor = groupedPage?.mainEditor ?? pages.layout.requireGroupedText(pageId);
        return new GroupedPageWrapper(editor, this.releaseList, this.outputFlags, this.callContext);
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Page",
            summary: "One open page (tab): its text, content pipe status, language, editor facade, editor switches, live sidebar panels, and grouped page.",
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
        return !state || agentMayAccessBrowserPage(state) ? undefined : privateBrowserRefusal(state);
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
        if (this.pipe) children.push({
            segment: ".pipe",
            kind: "ContentPipe",
            summary: "the primary content pipe's read-only stage status",
        });
        const pageId = this.id;
        if (pages.query.isGrouped(pageId)) {
            const grouped = pages.query.getGroupedPage(pageId);
            if (grouped) children.push({ segment: ".grouped", kind: "Page", summary: `grouped beside this page: "${grouped.title}"` });
        }
        return children;
    }

    private aiSummary(): Record<string, unknown> {
        const editorId = this.editor.id;
        const workspaceFolder = this.workspaceFolder;
        const summary: Record<string, unknown> = {
            kind: "Page", id: this.id, title: this.title, editor: editorId || null,
            language: this.language, filePath: this.filePath, modified: this.modified,
            pinSide: this.pinSide, pinned: this.pinned, active: pages.query.activePage?.id === this.id,
        };
        if (workspaceFolder) summary.workspaceFolder = workspaceFolder;
        if (!editorId) {
            // A folder-browsing page is editorless BY DESIGN — `openFile(folderPath)` opens
            // exactly this, an empty page whose Explorer panel is rooted at the folder. The
            // generic note below reads as a failure there and tells the caller to close the
            // page it just successfully opened, so name what the page actually is instead.
            summary.note = workspaceFolder
                ? `This tab has no editor because it is a workspace page: its Explorer `
                    + `panel is rooted at ${workspaceFolder}. Browse it through `
                    + `pages["${this.id}"].panels.explorer, or open one of its files into this `
                    + `tab with pages.navigatePageTo(pageId, filePath).`
                : "This tab is open but has no editor. Open a file into it with "
                    + "pages.navigatePageTo(pageId, filePath), or close it with pages.closePage(pageId).";
        }
        const state = this.browserState();
        if (state) {
            summary.profileName = state.profileName ?? "";
            summary.isIncognito = !!state.isIncognito;
            summary.isTor = !!state.isTor;
            if (state.openedByAgent) summary.openedByAgent = true;
            if (agentMayAccessBrowserPage(state)) {
                const url = (this.model as unknown as BrowserEditor).currentUrl;
                if (url) summary.url = url;
            }
        }
        return summary;
    }

    async runScript(): Promise<string> {
        if (!this.model) {
            throw new Error(`Page ${JSON.stringify(this.id)} has no editor, so there is no script to run.`);
        }
        const language = this.language;
        const { isScriptLanguage } = await import("../transpile");
        if (!isScriptLanguage(language)) throw new Error("runScript() is only available for javascript/typescript pages");
        const { scriptRunner } = await import("../ScriptRunner");
        return scriptRunner.runWithResult(this.model.id, this.content, this.model, language);
    }
}

class GroupedPageWrapper extends PageWrapper {
    constructor(
        model: EditorModel | null,
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
