import { PageModel } from "../../editors/base";
import { isTextFileModel } from "../../editors/text/TextPageModel";
import { pagesModel } from "../../api/pages";
import { PageEditor } from "../../../shared/types";
import type { TextViewModel } from "../../editors/text/TextEditor";
import type { GridViewModel } from "../../editors/grid/GridViewModel";
import type { NotebookViewModel } from "../../editors/notebook/NotebookViewModel";
import type { TodoViewModel } from "../../editors/todo/TodoViewModel";
import type { LinkViewModel } from "../../editors/link-editor/LinkViewModel";
import type { MarkdownViewModel } from "../../editors/markdown/MarkdownViewModel";
import type { SvgViewModel } from "../../editors/svg/SvgViewModel";
import type { HtmlViewModel } from "../../editors/html/HtmlViewModel";
import type { MermaidViewModel } from "../../editors/mermaid/MermaidViewModel";
import type { BrowserPageModel } from "../../editors/browser/BrowserPageModel";
import { TextEditorFacade } from "./TextEditorFacade";
import { GridEditorFacade } from "./GridEditorFacade";
import { NotebookEditorFacade } from "./NotebookEditorFacade";
import { TodoEditorFacade } from "./TodoEditorFacade";
import { LinkEditorFacade } from "./LinkEditorFacade";
import { MarkdownEditorFacade } from "./MarkdownEditorFacade";
import { SvgEditorFacade } from "./SvgEditorFacade";
import { HtmlEditorFacade } from "./HtmlEditorFacade";
import { MermaidEditorFacade } from "./MermaidEditorFacade";
import { BrowserEditorFacade } from "./BrowserEditorFacade";

/**
 * Safe wrapper around PageModel for script access.
 * Implements the IPage interface from api/types/page.d.ts.
 *
 * - Exposes only script-safe properties and methods
 * - Shares a releaseList for auto-releasing ViewModels on script completion
 */
export class PageWrapper {
    constructor(
        private readonly model: PageModel,
        private readonly releaseList: Array<() => void>,
    ) {}

    // ── IPageInfo readonly properties ─────────────────────────────────

    get id() {
        return this.model.id;
    }

    get type() {
        return this.model.state.get().type;
    }

    get title() {
        return this.model.title;
    }

    get modified() {
        return this.model.modified;
    }

    get pinned() {
        return this.model.pinned ?? false;
    }

    get filePath() {
        return this.model.filePath;
    }

    // ── IPage read/write properties ───────────────────────────────────

    get content(): string {
        if (isTextFileModel(this.model)) {
            return this.model.state.get().content;
        }
        return "";
    }

    set content(value: string) {
        if (isTextFileModel(this.model)) {
            this.model.changeContent(value);
        }
    }

    get language(): string {
        return this.model.state.get().language ?? "";
    }

    set language(value: string) {
        if (!this.model.noLanguage) {
            this.model.changeLanguage(value);
        }
    }

    get editor(): PageEditor {
        return this.model.state.get().editor ?? "monaco";
    }

    set editor(value: PageEditor) {
        if (isTextFileModel(this.model)) {
            this.model.changeEditor(value);
        }
    }

    get data(): Record<string, any> {
        return this.model.scriptData;
    }

    get grouped(): PageWrapper {
        let grouped = pagesModel.getGroupedPage(this.model.id);
        if (!grouped) {
            grouped = pagesModel.requireGroupedText(this.model.id);
        }
        return new PageWrapper(grouped, this.releaseList);
    }

    // ── Editor facades ────────────────────────────────────────────────

    async asText(): Promise<TextEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asText() is only available for text pages");
        }

        const vm = await model.acquireViewModel("monaco") as TextViewModel;
        this.releaseList.push(() => model.releaseViewModel("monaco"));
        return new TextEditorFacade(vm);
    }

    async asGrid(): Promise<GridEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asGrid() is only available for text pages");
        }

        const editorId = this.resolveGridEditorId();
        const vm = await model.acquireViewModel(editorId) as GridViewModel;
        this.releaseList.push(() => model.releaseViewModel(editorId));
        return new GridEditorFacade(vm);
    }

    private resolveGridEditorId(): PageEditor {
        const currentEditor = this.model.state.get().editor;
        if (currentEditor === "grid-json" || currentEditor === "grid-csv") {
            return currentEditor;
        }

        const language = this.model.state.get().language;
        if (language === "json") return "grid-json";
        if (language === "csv") return "grid-csv";

        throw new Error("asGrid(): content is not JSON or CSV");
    }

    async asNotebook(): Promise<NotebookEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asNotebook() is only available for text pages");
        }

        const vm = await model.acquireViewModel("notebook-view") as NotebookViewModel;
        this.releaseList.push(() => model.releaseViewModel("notebook-view"));
        return new NotebookEditorFacade(vm);
    }

    async asTodo(): Promise<TodoEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asTodo() is only available for text pages");
        }

        const vm = await model.acquireViewModel("todo-view") as TodoViewModel;
        this.releaseList.push(() => model.releaseViewModel("todo-view"));
        return new TodoEditorFacade(vm);
    }

    async asLink(): Promise<LinkEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asLink() is only available for text pages");
        }

        const vm = await model.acquireViewModel("link-view") as LinkViewModel;
        this.releaseList.push(() => model.releaseViewModel("link-view"));
        return new LinkEditorFacade(vm);
    }

    async asMarkdown(): Promise<MarkdownEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asMarkdown() is only available for text pages");
        }

        const vm = await model.acquireViewModel("md-view") as MarkdownViewModel;
        this.releaseList.push(() => model.releaseViewModel("md-view"));
        return new MarkdownEditorFacade(vm);
    }

    async asSvg(): Promise<SvgEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asSvg() is only available for text pages");
        }

        const vm = await model.acquireViewModel("svg-view") as SvgViewModel;
        this.releaseList.push(() => model.releaseViewModel("svg-view"));
        return new SvgEditorFacade(vm);
    }

    async asHtml(): Promise<HtmlEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asHtml() is only available for text pages");
        }

        const vm = await model.acquireViewModel("html-view") as HtmlViewModel;
        this.releaseList.push(() => model.releaseViewModel("html-view"));
        return new HtmlEditorFacade(vm);
    }

    async asMermaid(): Promise<MermaidEditorFacade> {
        const model = this.model;
        if (!isTextFileModel(model)) {
            throw new Error("asMermaid() is only available for text pages");
        }

        const vm = await model.acquireViewModel("mermaid-view") as MermaidViewModel;
        this.releaseList.push(() => model.releaseViewModel("mermaid-view"));
        return new MermaidEditorFacade(vm);
    }

    async asBrowser(): Promise<BrowserEditorFacade> {
        if (this.model.state.get().type !== "browserPage") {
            throw new Error("asBrowser() is only available for browser pages");
        }

        return new BrowserEditorFacade(this.model as unknown as BrowserPageModel);
    }
}
