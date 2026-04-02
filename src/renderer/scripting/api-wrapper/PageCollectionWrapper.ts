import type { PagesModel } from "../../api/pages/PagesModel";
import { PageWrapper } from "./PageWrapper";
import { EditorView } from "../../../shared/types";

/**
 * Safe wrapper around PagesModel for script access.
 * Implements the IPageCollection interface from api/types/pages.d.ts.
 *
 * All query methods return PageWrapper instances (not raw EditorModel).
 */
export class PageCollectionWrapper {
    constructor(
        private readonly pages: PagesModel,
        private readonly releaseList: Array<() => void>,
    ) {}

    private wrap(model: any): PageWrapper | undefined {
        return model ? new PageWrapper(model, this.releaseList) : undefined;
    }

    // ── Queries ───────────────────────────────────────────────────────

    get all(): PageWrapper[] {
        return this.pages.pages.map((p) => new PageWrapper(p, this.releaseList));
    }

    get activePage(): PageWrapper | undefined {
        return this.wrap(this.pages.activePage);
    }

    get groupedPage(): PageWrapper | undefined {
        return this.wrap(this.pages.groupedPage);
    }

    findPage(pageId: string): PageWrapper | undefined {
        return this.wrap(this.pages.findPage(pageId));
    }

    getGroupedPage(withPageId: string): PageWrapper | undefined {
        return this.wrap(this.pages.getGroupedPage(withPageId));
    }

    isLastPage(pageId?: string): boolean {
        return this.pages.isLastPage(pageId);
    }

    isGrouped(pageId: string): boolean {
        return this.pages.isGrouped(pageId);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    async openFile(filePath: string): Promise<PageWrapper | undefined> {
        const model = await this.pages.openFile(filePath);
        return this.wrap(model);
    }

    closePage(pageId: string): Promise<boolean> {
        return this.pages.closePage(pageId);
    }

    openFileWithDialog(): Promise<void> {
        return this.pages.openFileWithDialog();
    }

    navigatePageTo(
        pageId: string,
        newFilePath: string,
        options?: {
            revealLine?: number;
            highlightText?: string;
            forceTextEditor?: boolean;
        },
    ): Promise<boolean> {
        return this.pages.navigatePageTo(pageId, newFilePath, options);
    }

    addEmptyPage(): PageWrapper {
        const model = this.pages.addEmptyPage();
        return new PageWrapper(model, this.releaseList);
    }

    addEditorPage(
        editor: EditorView,
        language: string,
        title: string,
    ): PageWrapper {
        const model = this.pages.addEditorPage(editor, language, title);
        return new PageWrapper(model, this.releaseList);
    }

    async addDrawPage(dataUrl: string, title?: string): Promise<PageWrapper> {
        const model = await this.pages.addDrawPage(dataUrl, title);
        return new PageWrapper(model, this.releaseList);
    }

    openDiff(params: {
        firstPath: string;
        secondPath: string;
    }): Promise<void> {
        return this.pages.openDiff(params);
    }

    showAboutPage(): Promise<void> {
        return this.pages.showAboutPage();
    }

    showSettingsPage(): Promise<void> {
        return this.pages.showSettingsPage();
    }

    showMcpInspectorPage(options?: { url?: string }): Promise<void> {
        return this.pages.showMcpInspectorPage(options);
    }

    showBrowserPage(options?: {
        profileName?: string;
        incognito?: boolean;
        tor?: boolean;
        url?: string;
    }): Promise<void> {
        return this.pages.showBrowserPage(options);
    }

    openUrlInBrowserTab(
        url: string,
        options?: {
            incognito?: boolean;
            profileName?: string;
            external?: boolean;
        },
    ): Promise<void> {
        return this.pages.openUrlInBrowserTab(url, options);
    }

    // ── Navigation ────────────────────────────────────────────────────

    showPage(pageId: string): void {
        this.pages.showPage(pageId);
    }

    showNext(): void {
        this.pages.showNext();
    }

    showPrevious(): void {
        this.pages.showPrevious();
    }

    // ── Layout ────────────────────────────────────────────────────────

    moveTab(fromId: string, toId: string): void {
        this.pages.moveTab(fromId, toId);
    }

    pinTab(pageId: string): void {
        this.pages.pinTab(pageId);
    }

    unpinTab(pageId: string): void {
        this.pages.unpinTab(pageId);
    }

    group(leftPageId: string, rightPageId: string): void {
        this.pages.group(leftPageId, rightPageId);
    }

    ungroup(pageId: string): void {
        this.pages.ungroup(pageId);
    }
}
