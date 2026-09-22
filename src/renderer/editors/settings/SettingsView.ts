import { app } from "../../api/app";
import { settings } from "../../api/settings";
import { createLinkData } from "../../../shared/link-data";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { TreeView } from "../../uikit/Tree/TreeView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { SETTINGS_CATALOG, type SettingsCatalogSection } from "./settings-catalog";
import { BrowserProfilesSectionView } from "./sections/BrowserProfilesSection";
import { ClipboardSectionView } from "./sections/ClipboardSection";
import { DefaultBrowserSectionView } from "./sections/DefaultBrowserSection";
import { FileSearchSectionView } from "./sections/FileSearchSection";
import { McpSectionView } from "./sections/McpSection";
import { ThemeSectionView } from "./sections/ThemeSection";
import {
    BoardVarsSectionView,
    DrawingLibrarySectionView,
    EditorBehaviorSectionView,
    GitIntegrationSectionView,
    LinkBehaviorSectionView,
    ScriptLibrarySectionView,
    TerminalSectionView,
    VideoPlayerSectionView,
    WindowBehaviorSectionView,
} from "./sections/SettingsSections";
import { panel, text } from "./sections/settings-native";
import "./settings.css";
import "../../uikit/Button/Button.css";

export interface SettingsEditorProps {
    model: import("./SettingsEditor").SettingsEditor;
}

interface SettingsContentItem {
    readonly kind: "group" | "section";
    readonly value: string;
    readonly label: string;
    readonly items?: SettingsContentItem[];
}

type SettingsChildView = VanillaView<Record<string, never>>;

const SECTION_VIEW_FACTORIES: Readonly<Record<string, () => SettingsChildView>> = {
    theme: () => new ThemeSectionView({}),
    "window-behavior": () => new WindowBehaviorSectionView({}),
    clipboard: () => new ClipboardSectionView({}),
    terminal: () => new TerminalSectionView({}),
    "file-search": () => new FileSearchSectionView({}),
    "editor-behavior": () => new EditorBehaviorSectionView({}),
    "script-library": () => new ScriptLibrarySectionView({}),
    "video-player": () => new VideoPlayerSectionView({}),
    "drawing-library": () => new DrawingLibrarySectionView({}),
    "browser-profiles": () => new BrowserProfilesSectionView({}),
    "default-browser": () => new DefaultBrowserSectionView({}),
    "link-behavior": () => new LinkBehaviorSectionView({}),
    mcp: () => new McpSectionView({}),
    "git-integration": () => new GitIntegrationSectionView({}),
    "board-vars": () => new BoardVarsSectionView({}),
};

const SECTION_INTRODUCTIONS: Readonly<Record<string, () => Node[]>> = {
    "link-behavior": () => [
        panel({ paddingBottom: "lg" }, text("Links", { bold: true, size: "sm" })),
        panel({ paddingBottom: "md" }, text("How external links open from editors (Monaco, Markdown)", { color: "light", size: "xs" })),
    ],
    "default-browser": () => [
        panel({ paddingBottom: "lg" }, text("Default Browser", { bold: true, size: "sm" })),
    ],
};

function createSettingsContentItems(
    isNavigableSection: (sectionId: string) => boolean,
): SettingsContentItem[] {
    const groups: SettingsContentItem[] = [];
    for (const section of SETTINGS_CATALOG) {
        if (!isNavigableSection(section.id)) continue;
        let group = groups[groups.length - 1];
        if (!group || group.value !== `group:${section.groupId}`) {
            group = {
                kind: "group",
                value: `group:${section.groupId}`,
                label: section.groupTitle,
                items: [],
            };
            groups.push(group);
        }
        group.items?.push({
            kind: "section",
            value: `section:${section.id}`,
            label: section.title,
        });
    }
    return groups;
}

function getSettingsContentChildren(item: SettingsContentItem): SettingsContentItem[] | undefined {
    return item.items;
}

function getSettingsContentName(item: SettingsContentItem): string {
    return item.kind === "group"
        ? `settings-content-group-${item.value.slice("group:".length)}`
        : `settings-content-section-${item.value.slice("section:".length)}`;
}

interface SettingsNavigationTarget {
    readonly sectionId: string;
    readonly wrapper: HTMLDivElement;
}

interface PendingProgrammaticScroll {
    readonly selectionValue: string;
    readonly sectionId: string;
    readonly targetWrapper: HTMLDivElement;
    lastScrollTop: number;
    stableFrameCount: number;
}

const SCROLL_GEOMETRY_TOLERANCE = 2;

export class SettingsView extends VanillaView<SettingsEditorProps> {
    private contentTree: TreeView<SettingsContentItem> | undefined;
    private readonly sectionViews = new Map<string, SettingsChildView>();
    private readonly sectionPanels = new Map<string, HTMLDivElement>();
    private readonly sectionWrappers = new Map<string, HTMLDivElement>();
    private settingsContentItems: SettingsContentItem[] = [];
    private panelsElement: HTMLDivElement | undefined;
    private pendingProgrammaticScroll: PendingProgrammaticScroll | undefined;
    private programmaticSettleFrame: number | undefined;
    private selectedContentValue: string | undefined;

    public constructor(props: SettingsEditorProps) {
        const root = createPanelElement({
            name: "settings-root",
            direction: "column",
            align: "stretch",
            flex: true,
            height: 0,
            minHeight: 0,
            width: "100%",
            padding: "xxxl",
        });
        root.dataset.type = "settings-view";
        root.dataset.part = "root";
        super(props, root);
    }

    protected onMount(): void {
        const title = document.createElement("h1");
        title.textContent = "Settings";

        const content = createPanelElement({
            name: "settings-content",
            direction: "row",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            width: "100%",
            gap: "xxl",
        });
        content.dataset.part = "content";

        const treePane = createPanelElement({
            name: "settings-content-pane",
            direction: "column",
            width: 220,
            minHeight: 0,
            shrink: false,
            overflow: "hidden",
        });
        treePane.dataset.part = "content-pane";

        const panels = createPanelElement({
            name: "settings-panels",
            direction: "column",
            flex: true,
            minWidth: 0,
            minHeight: 0,
            width: "100%",
            overflowY: "auto",
            gap: "xl",
        });
        panels.dataset.part = "panels";

        content.append(treePane, panels);
        this.root.append(title, content);

        this.panelsElement = panels;
        for (const section of SETTINGS_CATALOG) this.appendSectionPanel(section, panels);
        this.rebuildContentItems();

        const tree = this.child(new TreeView<SettingsContentItem>(this.contentTreeProps()));
        this.contentTree = tree;
        treePane.append(tree.root);
        tree.mount();

        this.listen(panels, "scroll", this.handlePanelsScroll);
        const hiddenObserver = new MutationObserver(() => {
            if (!this.isDisposed) this.rebuildContentItems();
        });
        hiddenObserver.observe(panels, {
            attributes: true,
            attributeFilter: ["hidden"],
            subtree: true,
        });
        this.own(() => hiddenObserver.disconnect());

        const footer = createPanelElement({
            direction: "row",
            justify: "end",
            width: "100%",
            paddingY: "sm",
        });
        footer.dataset.part = "footer";
        const viewFileButton = this.child(new ButtonView({
            name: "settings-view-file",
            variant: "link",
            size: "sm",
            background: "light",
            onClick: this.handleOpenSettingsFile,
            children: "View Settings File",
        }));
        footer.append(viewFileButton.root);
        panels.append(footer);
        viewFileButton.mount();
    }

    protected onDispose(): void {
        this.cancelProgrammaticScroll();
        this.contentTree = undefined;
        this.panelsElement = undefined;
        this.sectionViews.clear();
        this.sectionPanels.clear();
        this.sectionWrappers.clear();
        this.settingsContentItems = [];
    }

    private appendSectionPanel(section: SettingsCatalogSection, parent: HTMLDivElement): void {
        const factory = SECTION_VIEW_FACTORIES[section.id];
        if (!factory) throw new Error(`No Settings section view registered for ${section.id}.`);

        const view = this.child(factory());
        const wrapper = document.createElement("div");
        wrapper.dataset.name = section.elementName;
        wrapper.dataset.part = "section-wrapper";
        wrapper.className = "settings-section-wrapper";
        wrapper.append(...(SECTION_INTRODUCTIONS[section.id]?.() ?? []), view.root);

        const sectionPanel = createPanelElement({
            name: section.panelName,
            direction: "column",
            width: "100%",
            shrink: false,
            padding: "xxl",
            background: "light",
            rounded: "lg",
        });
        sectionPanel.dataset.part = "section-panel";
        sectionPanel.append(wrapper);
        parent.append(sectionPanel);
        this.sectionViews.set(section.id, view);
        this.sectionPanels.set(section.id, sectionPanel);
        this.sectionWrappers.set(section.id, wrapper);
        view.mount();
    }

    private isNavigableSection(sectionId: string): boolean {
        const panel = this.sectionPanels.get(sectionId);
        const wrapper = this.sectionWrappers.get(sectionId);
        const sectionRoot = this.sectionViews.get(sectionId)?.root;
        if (!panel || !wrapper || !sectionRoot) return false;
        // Explicit `hidden` only — deliberately NOT geometry. A section that measures 0x0 is not
        // necessarily hidden: this runs during mount before first layout, and a page that is open
        // but not the active tab measures zero for everything it contains. Testing rects here made
        // every section non-navigable and rendered an empty Content tree on any mount that happened
        // before layout, which is most of them.
        return !panel.hidden && !wrapper.hidden && !sectionRoot.hidden;
    }

    private rebuildContentItems(): void {
        this.settingsContentItems = createSettingsContentItems((sectionId) => this.isNavigableSection(sectionId));
        if (!this.containsContentValue(this.selectedContentValue)) {
            this.selectedContentValue = this.firstSectionValue() ?? undefined;
        }
        if (this.pendingProgrammaticScroll && !this.isNavigableSection(this.pendingProgrammaticScroll.sectionId)) {
            this.cancelProgrammaticScroll();
        }
        this.contentTree?.update(this.contentTreeProps());
    }

    private containsContentValue(value: string | undefined): boolean {
        if (!value) return false;
        return this.settingsContentItems.some((group) =>
            group.value === value || group.items?.some((item) => item.value === value) === true,
        );
    }

    private firstSectionValue(): string | undefined {
        for (const group of this.settingsContentItems) {
            const firstSection = group.items?.[0];
            if (firstSection) return firstSection.value;
        }
        return undefined;
    }

    private contentTreeProps() {
        return {
            name: "settings-content-tree",
            items: this.settingsContentItems,
            getChildren: getSettingsContentChildren,
            isSelected: (item: SettingsContentItem): boolean => item.value === this.selectedContentValue,
            onChange: this.handleContentChange,
            defaultExpandAll: true,
            keyboardNav: true,
            getName: getSettingsContentName,
        };
    }

    private readonly handleContentChange = (item: SettingsContentItem): void => {
        const target = this.resolveNavigationTarget(item);
        if (!target) return;

        this.selectedContentValue = item.value;
        const tree = this.contentTree;
        if (!tree) return;
        tree.update(this.contentTreeProps());
        if (item.kind === "group") tree.model.expandItem(item.value);
        this.beginProgrammaticScroll(item.value, target);
    };

    private resolveNavigationTarget(item: SettingsContentItem): SettingsNavigationTarget | undefined {
        const sectionId = item.kind === "section"
            ? this.sectionIdFromValue(item.value, "section:")
            : this.firstVisibleSectionId(item.value);
        if (!sectionId || !this.isNavigableSection(sectionId)) return undefined;
        const wrapper = this.sectionWrappers.get(sectionId);
        return wrapper ? { sectionId, wrapper } : undefined;
    }

    private firstVisibleSectionId(groupValue: string): string | undefined {
        const groupId = this.sectionIdFromValue(groupValue, "group:");
        if (!groupId) return undefined;
        return SETTINGS_CATALOG.find((section) =>
            section.groupId === groupId && this.isNavigableSection(section.id),
        )?.id;
    }

    private sectionIdFromValue(value: string, prefix: string): string | undefined {
        return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
    }

    private beginProgrammaticScroll(selectionValue: string, target: SettingsNavigationTarget): void {
        const panels = this.panelsElement;
        if (!panels) return;

        this.cancelProgrammaticScroll();
        this.pendingProgrammaticScroll = {
            selectionValue,
            sectionId: target.sectionId,
            targetWrapper: target.wrapper,
            lastScrollTop: panels.scrollTop,
            stableFrameCount: 0,
        };
        target.wrapper.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
        this.queueProgrammaticSettleCheck();
    }

    private readonly handlePanelsScroll = (): void => {
        if (this.pendingProgrammaticScroll) {
            this.queueProgrammaticSettleCheck();
            return;
        }
        this.updateSelectionFromScroll();
    };

    private queueProgrammaticSettleCheck(): void {
        if (!this.pendingProgrammaticScroll || this.programmaticSettleFrame !== undefined) return;
        this.programmaticSettleFrame = requestAnimationFrame(() => {
            this.programmaticSettleFrame = undefined;
            this.checkProgrammaticScrollSettled();
        });
    }

    private checkProgrammaticScrollSettled(): void {
        const pending = this.pendingProgrammaticScroll;
        const panels = this.panelsElement;
        if (!pending || !panels) return;
        if (!this.isNavigableSection(pending.sectionId)) {
            this.cancelProgrammaticScroll();
            this.rebuildContentItems();
            return;
        }

        const currentScrollTop = panels.scrollTop;
        if (currentScrollTop === pending.lastScrollTop) pending.stableFrameCount++;
        else pending.stableFrameCount = 0;
        pending.lastScrollTop = currentScrollTop;

        if (pending.stableFrameCount < 2 || !this.isProgrammaticTargetSettled(pending)) {
            this.queueProgrammaticSettleCheck();
            return;
        }

        this.pendingProgrammaticScroll = undefined;
        this.selectedContentValue = pending.selectionValue;
        this.contentTree?.update(this.contentTreeProps());
    }

    private isProgrammaticTargetSettled(pending: PendingProgrammaticScroll): boolean {
        const panels = this.panelsElement;
        if (!panels) return false;
        const viewport = panels.getBoundingClientRect();
        const target = pending.targetWrapper.getBoundingClientRect();
        const aligned = Math.abs(target.top - viewport.top) <= SCROLL_GEOMETRY_TOLERANCE;
        const maximumScrollTop = Math.max(0, panels.scrollHeight - panels.clientHeight);
        const atBottom = Math.abs(panels.scrollTop - maximumScrollTop) <= SCROLL_GEOMETRY_TOLERANCE;
        const targetIsVisible = target.bottom > viewport.top && target.top < viewport.bottom;
        const isFinalTarget = this.lastNavigableSectionId() === pending.sectionId;
        return aligned || (atBottom && isFinalTarget && targetIsVisible);
    }

    private updateSelectionFromScroll(): void {
        const sectionId = this.topmostVisibleSectionId();
        if (!sectionId) return;
        const selectionValue = `section:${sectionId}`;
        if (selectionValue === this.selectedContentValue) return;
        this.selectedContentValue = selectionValue;
        // The spy intentionally updates only the controlled selection. In particular, it must not
        // change activeIndex or call an active-row API, because TreeView would scroll the Content pane.
        this.contentTree?.update(this.contentTreeProps());
    }

    private topmostVisibleSectionId(): string | undefined {
        const panels = this.panelsElement;
        if (!panels) return undefined;
        const viewport = panels.getBoundingClientRect();
        let firstVisibleSectionId: string | undefined;
        for (const section of SETTINGS_CATALOG) {
            if (!this.isNavigableSection(section.id)) continue;
            const wrapper = this.sectionWrappers.get(section.id);
            if (!wrapper) continue;
            const rect = wrapper.getBoundingClientRect();
            if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
                firstVisibleSectionId = section.id;
                break;
            }
        }

        const maximumScrollTop = Math.max(0, panels.scrollHeight - panels.clientHeight);
        const atBottom = Math.abs(panels.scrollTop - maximumScrollTop) <= SCROLL_GEOMETRY_TOLERANCE;
        return atBottom ? this.lastNavigableSectionId() ?? firstVisibleSectionId : firstVisibleSectionId;
    }

    private lastNavigableSectionId(): string | undefined {
        for (let index = SETTINGS_CATALOG.length - 1; index >= 0; index--) {
            const section = SETTINGS_CATALOG[index];
            if (this.isNavigableSection(section.id)) return section.id;
        }
        return undefined;
    }

    private cancelProgrammaticScroll(): void {
        if (this.programmaticSettleFrame !== undefined) {
            cancelAnimationFrame(this.programmaticSettleFrame);
            this.programmaticSettleFrame = undefined;
        }
        this.pendingProgrammaticScroll = undefined;
    };

    private readonly handleOpenSettingsFile = (): void => {
        const filePath = settings.settingsFilePath;
        if (filePath) void app.events.openRawLink.sendAsync(createLinkData(filePath));
    };
}

export type { SettingsEditor } from "./SettingsEditor";
