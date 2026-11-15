import type { PageModel } from "../../api/pages/PageModel";
import type { IPageHistoryEntry } from "../../api/types/page-history";
import type { IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";

const HISTORY_MEMBERS: readonly IAiMember[] = [
    { name: "canGoBack", kind: "property", summary: "Whether this page has a page-model destination in its Back stack." },
    { name: "canGoForward", kind: "property", summary: "Whether this page has a page-model destination in its Forward stack." },
    { name: "entries", kind: "property", summary: "Copies of the Back and Forward stacks, oldest first; the last entry is next." },
    { name: "back", kind: "method", signature: "back(): Promise<boolean>", summary: "Navigate this page to its previous page-model destination.", caution: "navigates this page" },
    { name: "forward", kind: "method", signature: "forward(): Promise<boolean>", summary: "Navigate this page to its next page-model destination.", caution: "navigates this page" },
];

/** Script-facing, read-only projection of a page's navigation history. */
export class PageHistoryNode implements IAiVisible {
    constructor(private readonly pageProvider: () => PageModel | undefined) {}

    get canGoBack(): boolean { return this.pageProvider()?.history.canGoBack ?? false; }
    get canGoForward(): boolean { return this.pageProvider()?.history.canGoForward ?? false; }

    get entries(): {
        readonly back: readonly IPageHistoryEntry[];
        readonly forward: readonly IPageHistoryEntry[];
    } {
        const snapshot = this.pageProvider()?.history.snapshot();
        const project = (entry: { title: string; filePath: string; target: string }) => ({
            title: entry.title,
            filePath: entry.filePath,
            target: entry.target,
        });
        return {
            back: (snapshot?.back ?? []).map(project),
            forward: (snapshot?.forward ?? []).map(project),
        };
    }

    async back(): Promise<boolean> {
        return (await this.pageProvider()?.history.back()) ?? false;
    }

    async forward(): Promise<boolean> {
        return (await this.pageProvider()?.history.forward()) ?? false;
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "PageHistory",
            summary: "Live page-model Back and Forward destinations for this page.",
            members: HISTORY_MEMBERS,
            help: "entries contains fresh copies of the page's Back and Forward stacks, each oldest first with the next destination last. Entries expose only title, filePath, and target; sourceLink replay metadata is private. back() and forward() resolve true only when a move commits, false for a normal no-op such as an empty stack, cancellation, or an interceptor taking the request, and reject on actual navigation errors. This is page-model history. Browser webview navigation has separate history; these methods do not control it.",
            summarize: () => ({
                kind: "PageHistory",
                canGoBack: this.canGoBack,
                canGoForward: this.canGoForward,
                entries: this.entries,
            }),
        };
    }
}
