import { app } from "../../api/app";
import { shell } from "../../api/shell";
import { getGuideIndex, getGuidePage } from "../../guides";
import type { GuideTreeNode } from "../../../shared/guides";
import { selectReleaseNotes } from "../../../shared/guides/release-notes";
import { guard } from "../../core/utils/guard";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { CheckboxView } from "../../uikit/Checkbox/CheckboxView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { TreeView } from "../../uikit/Tree/TreeView";
import type { ITreeItem, TreeProps } from "../../uikit/Tree/types";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { AboutEditor, type AboutGuideLocation } from "./AboutEditor";
import { AboutGuidePageView } from "./AboutGuidePageView";
import "../../uikit/Button/Button.css";
import "../../uikit/Checkbox/Checkbox.css";
import "./AboutView.css";

interface AboutGuideBrowserProps {
    model: AboutEditor;
}

interface AboutGuideTreeItem extends Omit<ITreeItem, "items"> {
    node: GuideTreeNode;
    items?: AboutGuideTreeItem[];
}

function stripInlineMarkdown(value: string): string {
    return value
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/~~(.*?)~~/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .trim();
}

function projectReleaseNotes(notes: string): Node[] {
    const lines = notes.split(/\r?\n/);
    const projected: Node[] = [];
    let subsectionActive = false;
    let bulletCount = 0;

    const flushSubsection = (): void => {
        subsectionActive = false;
        bulletCount = 0;
    };

    for (const line of lines) {
        if (/^## Version\s/.test(line)) {
            flushSubsection();
            projected.push(createTextElement(stripInlineMarkdown(line.replace(/^##\s+/, "")), {
                size: "md",
                bold: true,
            }));
            continue;
        }
        if (/^###\s+/.test(line)) {
            flushSubsection();
            projected.push(createTextElement(stripInlineMarkdown(line.replace(/^###\s+/, "")), {
                size: "sm",
                bold: true,
            }));
            subsectionActive = true;
            continue;
        }
        if (subsectionActive && /^\s*[-*+]\s+/.test(line) && bulletCount < 3) {
            const bullet = createTextElement(`• ${stripInlineMarkdown(line.replace(/^\s*[-*+]\s+/, ""))}`, {
                size: "sm",
                color: "light",
                preWrap: true,
            });
            bullet.classList.add("about-release-bullet");
            projected.push(bullet);
            bulletCount += 1;
        }
    }
    flushSubsection();

    if (projected.length === 0 && notes.trim()) {
        projected.push(createTextElement(stripInlineMarkdown(notes), { size: "sm", color: "light" }));
    }
    return projected;
}

function mapGuideNodes(nodes: readonly GuideTreeNode[]): AboutGuideTreeItem[] {
    return nodes.map((node) => {
        if (node.kind === "folder") {
            return {
                value: node.path,
                label: node.name,
                node,
                items: mapGuideNodes(node.children),
            };
        }
        return {
            value: node.path,
            label: node.title,
            node,
        };
    });
}

export class AboutGuideBrowserView extends VanillaView<AboutGuideBrowserProps> {
    private readonly model: AboutEditor;
    private alive = false;
    private loading = false;
    private loadGeneration = 0;
    private loadedShowAgentGuides: boolean | undefined;
    private guideItems: AboutGuideTreeItem[] = [];
    private releaseNotes = "";

    private contentsHost: HTMLDivElement | undefined;
    private guidePageMount: HTMLDivElement | undefined;
    private releaseNotesText: HTMLDivElement | undefined;
    private tree: TreeView<AboutGuideTreeItem> | undefined;
    private showAgentGuidesToggle: CheckboxView | undefined;
    private guidePage: AboutGuidePageView | undefined;

    public constructor(props: AboutGuideBrowserProps) {
        super(props, createPanelElement({
            name: "about-guide-browser",
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
        }));
        this.model = props.model;
        this.root.classList.add("about-guide-browser-root");
    }

    public get currentLocation(): AboutGuideLocation {
        return this.model.guideBrowser.currentLocation;
    }

    public get canGoBack(): boolean {
        return this.model.guideBrowser.canGoBack;
    }

    public get guidePageHost(): HTMLDivElement {
        if (!this.guidePageMount) {
            throw new Error("The About guide page mount is not available before mount().");
        }
        return this.guidePageMount;
    }

    public back(): void {
        this.model.guideBrowser.back();
    }

    public async openGuide(path: string, fragment?: string): Promise<void> {
        const filter = this.model.guideBrowser.showAgentGuides ? "all" : "user";
        const page = await guard("Failed to open guide", () => getGuideIndex().getPage(path, filter));
        if (!page || !this.alive) return;
        this.model.guideBrowser.openGuide({
            kind: "guide",
            path,
            ...(fragment ? { fragment } : {}),
        });
    }

    protected onMount(): void {
        this.alive = true;
        this.mountContents();
        this.guidePageMount = createPanelElement({
            name: "about-guide-page",
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
        });
        this.guidePageMount.classList.add("about-guide-page");
        this.root.append(this.guidePageMount);
        this.guidePage = this.child(new AboutGuidePageView({
            browser: this.model.guideBrowser,
            openGuide: (path, fragment) => this.openGuide(path, fragment),
            back: () => this.back(),
        }));
        this.guidePageMount.append(this.guidePage.root);
        this.guidePage.mount();

        this.ownSubscription(this.model.guideBrowser.subscribe(this.handleBrowserStateChange));
        this.applyLocation();
        void this.loadContents();
    }

    protected onDispose(): void {
        this.alive = false;
        this.loadGeneration += 1;
        this.root.replaceChildren();
        this.contentsHost = undefined;
        this.guidePageMount = undefined;
        this.releaseNotesText = undefined;
        this.tree = undefined;
        this.showAgentGuidesToggle = undefined;
        this.guidePage = undefined;
    }

    private mountContents(): void {
        this.contentsHost = createPanelElement({
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            padding: "xxl",
            gap: "xl",
        });
        this.contentsHost.classList.add("about-guide-contents");

        const whatsNew = createPanelElement({
            name: "about-whats-new",
            direction: "column",
            gap: "md",
            shrink: false,
        });
        whatsNew.append(createTextElement("What's New", { size: "lg", bold: true }));
        this.releaseNotesText = document.createElement("div");
        this.releaseNotesText.classList.add("about-release-notes");
        whatsNew.append(this.releaseNotesText);
        const openWhatsNew = this.child(new ButtonView({
            name: "about-whats-new-open",
            variant: "link",
            size: "sm",
            onClick: () => { void this.openGuide("whats-new"); },
            children: "View full What's New",
        }));
        whatsNew.append(openWhatsNew.root);
        openWhatsNew.mount();

        const resources = createPanelElement({
            name: "about-resources",
            direction: "row",
            align: "center",
            gap: "md",
            wrap: true,
            shrink: false,
        });
        resources.append(createTextElement("Resources:", { size: "lg", bold: true }));
        const resourceActions = createPanelElement({
            direction: "row",
            wrap: true,
            gap: "lg",
            align: "center",
            minWidth: 0,
        });
        this.appendResourceButton(resourceActions, "about-resource-repository", "Repository", () => {
            void guard("Failed to open repository", () => shell.openExternal("https://github.com/andriy-viyatyk/persephone"));
        });
        this.appendResourceButton(resourceActions, "about-resource-issues", "Issues", () => {
            void guard("Failed to open issues", () => shell.openExternal("https://github.com/andriy-viyatyk/persephone/issues"));
        });
        this.appendResourceButton(resourceActions, "about-resource-boards", "Boards catalogue", () => {
            void this.openGuide("boards");
        });
        this.appendResourceButton(resourceActions, "about-resource-mcp-setup", "MCP setup", () => {
            void this.openGuide("mcp-setup");
        });
        resources.append(resourceActions);

        const treeSection = createPanelElement({
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            gap: "md",
        });
        this.showAgentGuidesToggle = this.child(new CheckboxView({
            name: "about-show-agent-guides",
            checked: this.model.guideBrowser.showAgentGuides,
            onChange: (checked) => { this.model.guideBrowser.setShowAgentGuides(checked); },
            children: "Show agent guides",
        }));
        treeSection.append(this.showAgentGuidesToggle.root);
        this.showAgentGuidesToggle.mount();

        this.tree = this.child(new TreeView<AboutGuideTreeItem>(this.treeProps()));
        treeSection.append(this.tree.root);
        this.tree.mount();

        this.contentsHost.append(whatsNew, resources, treeSection);
        this.root.append(this.contentsHost);
    }

    private appendResourceButton(
        parent: HTMLElement,
        name: string,
        label: string,
        onClick: () => void,
    ): void {
        const button = this.child(new ButtonView({
            name,
            variant: "link",
            size: "sm",
            onClick,
            children: label,
        }));
        parent.append(button.root);
        button.mount();
    }

    private readonly handleBrowserStateChange = (): void => {
        if (!this.alive) return;
        this.showAgentGuidesToggle?.update({
            name: "about-show-agent-guides",
            checked: this.model.guideBrowser.showAgentGuides,
            onChange: (checked) => { this.model.guideBrowser.setShowAgentGuides(checked); },
            children: "Show agent guides",
        });
        this.applyLocation();
        if (this.loadedShowAgentGuides !== this.model.guideBrowser.showAgentGuides) {
            void this.loadContents();
        }
    };

    private applyLocation(): void {
        const isGuide = this.model.guideBrowser.currentLocation.kind === "guide";
        if (this.contentsHost) this.contentsHost.hidden = isGuide;
        if (this.guidePageMount) this.guidePageMount.hidden = !isGuide;
    }

    private async loadContents(): Promise<void> {
        const showAgentGuides = this.model.guideBrowser.showAgentGuides;
        const generation = ++this.loadGeneration;
        this.loadedShowAgentGuides = showAgentGuides;
        this.loading = true;
        this.guideItems = [];
        this.releaseNotes = "";
        this.updateContentsProjection();

        const filter = showAgentGuides ? "all" : "user";
        const result = await guard("Failed to load guide browser", async () => {
            const [nodes, whatsNew] = await Promise.all([
                getGuideIndex().getTree(filter),
                getGuidePage("whats-new"),
            ]);
            return { nodes, whatsNew };
        });
        if (this.alive && generation === this.loadGeneration && result) {
            this.guideItems = mapGuideNodes(result.nodes);
            this.releaseNotes = selectReleaseNotes(
                result.whatsNew?.content ?? "",
                app.version || "...",
                { includeUpcoming: import.meta.env.DEV || showAgentGuides },
            );
        }
        if (!this.alive || generation !== this.loadGeneration) return;
        this.loading = false;
        this.updateContentsProjection();
    }

    private updateContentsProjection(): void {
        this.releaseNotesText?.replaceChildren(...projectReleaseNotes(this.releaseNotes));
        this.tree?.update(this.treeProps());
    }

    private treeProps(): TreeProps<AboutGuideTreeItem> {
        return {
            name: "about-guide-tree",
            items: this.guideItems,
            getChildren: (item) => item.items,
            onChange: this.handleGuideTreeChange,
            getTooltip: (item) => item.node.kind === "page" ? item.node.summary : undefined,
            renderTrailing: this.renderTreeSummary,
            defaultExpandAll: false,
            keyboardNav: true,
            focusSelection: true,
            rowHeight: 24,
            loading: this.loading,
            emptyMessage: "No guides available.",
        };
    }

    private readonly renderTreeSummary = (item: AboutGuideTreeItem): Node | undefined => {
        if (item.node.kind !== "page") return undefined;
        const summary = createTextElement(item.node.summary, { size: "sm", color: "light", truncate: true });
        summary.classList.add("about-guide-summary");
        return summary;
    };

    private readonly handleGuideTreeChange = (item: AboutGuideTreeItem): void => {
        if (item.node.kind !== "page") return;
        void this.openGuide(item.node.path);
    };
}
