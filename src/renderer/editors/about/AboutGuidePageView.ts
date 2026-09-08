import { app } from "../../api/app";
import { getGuideIndex } from "../../guides";
import { TComponentState } from "../../core/state/state";
import { ComponentQueue } from "../../core/state/ComponentQueue";
import { guard } from "../../core/utils/guard";
import { createLinkData } from "../../../shared/link-data";
import type { GuideTreeNode } from "../../../shared/guides";
import { guideUrl, parseGuideUrl } from "../../../shared/guides/guide-links";
import { errMessage } from "../../../shared/utils";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { IOwnedView } from "../../uikit/shared/vanilla-view";
import type {
    MarkdownBodyHostState,
    MarkdownBodyModel,
    MarkdownBodyState,
    MarkdownQueueEvent,
    MarkdownQueueRequest,
} from "../markdown/MarkdownBodyModel";
import type { AboutGuideBrowserState, AboutGuideLocation } from "./AboutEditor";

export interface AboutGuidePageViewProps {
    browser: AboutGuideBrowserState;
    openGuide: (path: string, fragment?: string) => Promise<void>;
    back: () => void;
}

interface Breadcrumb {
    label: string;
    path?: string;
}

const DEFAULT_BODY_STATE: MarkdownBodyState = {
    compactMode: false,
    searchVisible: false,
    searchText: "",
    currentMatchIndex: 0,
    totalMatches: 0,
};

const DEFAULT_HOST_STATE: MarkdownBodyHostState = {
    content: "",
    filePath: undefined,
    title: "",
};

function humanizeFolderName(name: string): string {
    const words = name.replace(/[-_]+/g, " ").trim();
    return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function findFolderName(nodes: readonly GuideTreeNode[], path: string): string | undefined {
    for (const node of nodes) {
        if (node.kind !== "folder") continue;
        if (node.path === path) return node.name;
        const nested = findFolderName(node.children, path);
        if (nested) return nested;
    }
    return undefined;
}

export class AboutGuidePageView extends VanillaView<AboutGuidePageViewProps> {
    private readonly bodyState = new TComponentState({ ...DEFAULT_BODY_STATE });
    private readonly bodyHostState = new TComponentState({ ...DEFAULT_HOST_STATE });
    private readonly bodyQueue = new ComponentQueue<MarkdownQueueEvent, MarkdownQueueRequest>();
    private readonly bodyModel: MarkdownBodyModel;

    private readonly breadcrumbs: HTMLDivElement;
    private readonly bodyHost: HTMLDivElement;
    private readonly backButton: ButtonView;
    private readonly openInTabButton: ButtonView;
    private readonly breadcrumbButtons: ButtonView[] = [];
    private bodyView: IOwnedView | undefined;
    private alive = false;
    private locationGeneration = 0;

    public constructor(props: AboutGuidePageViewProps) {
        super(props, createPanelElement({
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
        }));
        this.root.classList.add("about-guide-page-view");

        this.bodyModel = {
            state: this.bodyState,
            host: { state: this.bodyHostState },
            typedQueue: this.bodyQueue,
            page: undefined,
            openSearch: this.openSearch,
            closeSearch: this.closeSearch,
            setSearchText: this.setSearchText,
            setMatchCount: this.setMatchCount,
            nextMatch: this.nextMatch,
            prevMatch: this.prevMatch,
            navigateLink: this.navigateLink,
        };
        this.own(() => this.bodyQueue.dispose());

        const header = createPanelElement({
            direction: "row",
            align: "center",
            gap: "md",
            padding: "md",
            shrink: false,
        });
        header.classList.add("about-guide-header");

        this.backButton = this.child(new ButtonView({
            name: "about-guide-back",
            variant: "ghost",
            size: "sm",
            disabled: true,
            onClick: props.back,
            children: "Back",
        }));
        this.openInTabButton = this.child(new ButtonView({
            name: "about-guide-open-in-tab",
            variant: "primary",
            size: "sm",
            disabled: true,
            onClick: this.openInTab,
            children: "Open in tab",
        }));
        this.breadcrumbs = createPanelElement({
            name: "about-guide-breadcrumbs",
            direction: "row",
            align: "center",
            gap: "xs",
            flex: true,
            minWidth: 0,
            overflow: "hidden",
        });
        this.breadcrumbs.classList.add("about-guide-breadcrumbs");
        this.bodyHost = createPanelElement({
            name: "about-guide-body",
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
        });
        this.bodyHost.classList.add("about-guide-body");

        header.append(this.backButton.root, this.breadcrumbs, this.openInTabButton.root);
        this.root.append(header, this.bodyHost);
    }

    protected onMount(): void {
        this.alive = true;
        this.backButton.mount();
        this.openInTabButton.mount();
        this.ownSubscription(this.props.browser.subscribe(this.handleLocationChange));
        this.renderLocation(this.props.browser.currentLocation);
    }

    protected onDispose(): void {
        this.alive = false;
        this.locationGeneration += 1;
        this.releaseBody();
    }

    private readonly handleLocationChange = (location: AboutGuideLocation): void => {
        if (!this.alive) return;
        this.renderLocation(location);
    };

    private renderLocation(location: AboutGuideLocation): void {
        const generation = ++this.locationGeneration;
        this.releaseBody();
        this.resetBodyProjection();
        this.renderBreadcrumbs([]);
        this.updateControls(location);
        if (location.kind === "guide") void this.loadGuide(location, generation);
    }

    private async loadGuide(
        location: Extract<AboutGuideLocation, { kind: "guide" }>,
        generation: number,
    ): Promise<void> {
        const filter = this.props.browser.showAgentGuides ? "all" : "user";
        try {
            const [{ MarkdownBodyView }, page] = await Promise.all([
                import("../markdown/MarkdownBodyView"),
                getGuideIndex().getPage(location.path, filter),
            ]);
            if (!this.isCurrent(location, generation)) return;
            if (!page) {
                this.showLoadError("This guide is not available.");
                return;
            }

            const breadcrumbs = await this.resolveBreadcrumbs(location.path, filter, page.title);
            if (!this.isCurrent(location, generation)) return;

            this.bodyHostState.set({
                content: page.content,
                filePath: guideUrl(location.path),
                title: page.title,
            });
            this.renderBreadcrumbs(breadcrumbs);
            // No editorConfig: the pane wants the editor's own defaults — the
            // minimap, and with it a hidden scrollbar. maxEditorHeight in
            // particular must stay unset or the body view skips link handling.
            const body = this.child(new MarkdownBodyView({ model: this.bodyModel }));
            this.bodyHost.append(body.root);
            this.bodyView = body;
            body.mount();
            if (location.fragment) this.revealFragment(location.fragment);
        } catch (error: unknown) {
            if (!this.isCurrent(location, generation)) return;
            this.showLoadError(errMessage(error, "Failed to load guide."));
        }
    }

    private async resolveBreadcrumbs(
        path: string,
        filter: "user" | "all",
        currentTitle: string,
    ): Promise<Breadcrumb[]> {
        const segments = path.split("/");
        const folderPaths = segments.slice(0, -1).map((_, index) =>
            segments.slice(0, index + 1).join("/"));
        const parentPaths = folderPaths.filter(folderPath => `${folderPath}/index` !== path);
        if (parentPaths.length === 0) return [{ label: currentTitle }];

        const index = getGuideIndex();
        const [folders, ...indexPages] = await Promise.all([
            index.getTree(filter),
            ...parentPaths.map(folderPath => index.getPage(`${folderPath}/index`, filter)),
        ]);
        const crumbs = parentPaths.map((folderPath, indexPosition) => {
            const indexPage = indexPages[indexPosition];
            return {
                label: indexPage?.title ?? humanizeFolderName(
                    findFolderName(folders, folderPath) ?? folderPath.slice(folderPath.lastIndexOf("/") + 1),
                ),
                ...(indexPage ? { path: indexPage.path } : {}),
            };
        });
        crumbs.push({ label: currentTitle });
        return crumbs;
    }

    private renderBreadcrumbs(crumbs: readonly Breadcrumb[]): void {
        for (const button of this.breadcrumbButtons.splice(0)) this.releaseChild(button);
        this.breadcrumbs.replaceChildren();
        crumbs.forEach((crumb, index) => {
            if (index > 0) {
                this.breadcrumbs.append(createTextElement("›", { size: "sm", color: "light" }));
            }
            if (crumb.path) {
                const button = this.child(new ButtonView({
                    variant: "link",
                    size: "sm",
                    onClick: () => { void this.props.openGuide(crumb.path as string); },
                    children: crumb.label,
                }));
                this.breadcrumbButtons.push(button);
                this.breadcrumbs.append(button.root);
                button.mount();
            } else {
                // The current page is not a link. A chip keeps it legible beside the
                // link crumbs without borrowing their colour, and stops the trail
                // reading as one run of text with the Back button.
                const current = createTextElement(crumb.label, { size: "base", truncate: true });
                current.classList.add("about-guide-crumb-current");
                this.breadcrumbs.append(current);
            }
        });
    }

    private updateControls(location: AboutGuideLocation): void {
        const isGuide = location.kind === "guide";
        this.backButton.update({
            name: "about-guide-back",
            variant: "ghost",
            size: "sm",
            disabled: !this.props.browser.canGoBack,
            onClick: this.props.back,
            children: "Back",
        });
        this.openInTabButton.update({
            name: "about-guide-open-in-tab",
            variant: "primary",
            size: "sm",
            disabled: !isGuide,
            onClick: this.openInTab,
            children: "Open in tab",
        });
    }

    private readonly openInTab = (): void => {
        const location = this.props.browser.currentLocation;
        if (location.kind !== "guide") return;
        void guard("Failed to open guide in tab", () => app.events.openRawLink.sendAsync(
            createLinkData(guideUrl(location.path), {
                target: "md-view",
                sourceId: "about-guide-open-in-tab",
            }),
        ));
    };

    private readonly navigateLink = (href: string): boolean => {
        const parsed = parseGuideUrl(href);
        if (!parsed) return false;

        const location = this.props.browser.currentLocation;
        if (location.kind === "guide" && location.path === parsed.path) {
            if (parsed.fragment) this.revealFragment(parsed.fragment);
            return true;
        }

        void this.props.openGuide(parsed.path, parsed.fragment);
        return true;
    };

    private readonly revealFragment = (fragment: string): void => {
        if (fragment) this.bodyQueue.send({ type: "anchor", fragment });
    };

    private resetBodyProjection(): void {
        this.bodyState.set({ ...DEFAULT_BODY_STATE });
        this.bodyHostState.set({ ...DEFAULT_HOST_STATE });
    }

    private showLoadError(message: string): void {
        this.bodyHost.replaceChildren(createTextElement(message, { size: "sm", color: "light" }));
    }

    private releaseBody(): void {
        if (this.bodyView) {
            this.releaseChild(this.bodyView);
            this.bodyView = undefined;
        }
        this.bodyHost.replaceChildren();
    }

    private isCurrent(location: AboutGuideLocation, generation: number): boolean {
        return this.alive
            && this.locationGeneration === generation
            && this.props.browser.currentLocation === location;
    }

    private readonly openSearch = (): void => {
        this.bodyState.update((state) => { state.searchVisible = true; });
    };

    private readonly closeSearch = (): void => {
        this.bodyState.update((state) => {
            state.searchVisible = false;
            state.searchText = "";
            state.currentMatchIndex = 0;
            state.totalMatches = 0;
        });
    };

    private readonly setSearchText = (text: string): void => {
        this.bodyState.update((state) => {
            state.searchText = text;
            state.currentMatchIndex = 0;
        });
    };

    private readonly setMatchCount = (count: number): void => {
        this.bodyState.update((state) => {
            state.totalMatches = count;
            state.currentMatchIndex = count > 0 && state.currentMatchIndex >= count
                ? 0
                : state.currentMatchIndex;
        });
    };

    private readonly nextMatch = (): void => {
        const { totalMatches, currentMatchIndex } = this.bodyState.get();
        if (totalMatches === 0) return;
        this.bodyState.update((state) => {
            state.currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
        });
    };

    private readonly prevMatch = (): void => {
        const { totalMatches, currentMatchIndex } = this.bodyState.get();
        if (totalMatches === 0) return;
        this.bodyState.update((state) => {
            state.currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
        });
    };
}
