import { app } from "../../api/app";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { customEditorRegistry, type BoardSettingsRegistration } from "../board/custom-editor-registry";
import { createLinkData } from "../../../shared/link-data";
import { errMessage } from "../../../shared/utils";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { TreeView } from "../../uikit/Tree/TreeView";
import { VanillaView, type IOwnedView } from "../../uikit/shared/vanilla-view";
import { SETTINGS_CATALOG, type SettingsCatalogSection } from "./settings-catalog";
import { BrowserProfilesSectionView } from "./sections/BrowserProfilesSection";
import { ClipboardSectionView } from "./sections/ClipboardSection";
import { DefaultBrowserSectionView } from "./sections/DefaultBrowserSection";
import { FileSearchSectionView } from "./sections/FileSearchSection";
import { McpSectionView } from "./sections/McpSection";
import { ThemeSectionView } from "./sections/ThemeSection";
import { BoardSettingsSectionView } from "./sections/BoardSettingsSection";
import {
    BoardVarsSectionView,
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

interface BoardSettingsSectionDescriptor {
    readonly kind: "board";
    readonly groupId: string;
    readonly groupTitle: string;
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly elementName: string;
    readonly panelName: string;
    readonly board: BoardSettingsRegistration;
}

type SettingsSectionDescriptor = SettingsCatalogSection | BoardSettingsSectionDescriptor;

type SettingsChildView = IOwnedView;
type SettingsBuiltInView = VanillaView<Record<string, never>>;

const SECTION_VIEW_FACTORIES: Readonly<Record<string, () => SettingsBuiltInView>> = {
    theme: () => new ThemeSectionView({}),
    "window-behavior": () => new WindowBehaviorSectionView({}),
    clipboard: () => new ClipboardSectionView({}),
    terminal: () => new TerminalSectionView({}),
    "file-search": () => new FileSearchSectionView({}),
    "editor-behavior": () => new EditorBehaviorSectionView({}),
    "script-library": () => new ScriptLibrarySectionView({}),
    "video-player": () => new VideoPlayerSectionView({}),
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
    sections: readonly SettingsSectionDescriptor[],
    isNavigableSection: (sectionId: string) => boolean,
): SettingsContentItem[] {
    const groups: SettingsContentItem[] = [];
    for (const section of sections) {
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
    private readonly dynamicSectionIds = new Set<string>();
    private footerElement: HTMLDivElement | undefined;
    private initializationGeneration = 0;

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
        this.own(customEditorRegistry.state.subscribe<readonly BoardSettingsRegistration[]>(
            (settingsBoards) => {
                if (!this.isDisposed) this.rebuildDynamicSections(settingsBoards);
            },
            (state) => state.settingsBoards,
        ));
        this.rebuildDynamicSections(customEditorRegistry.settingsBoards);
        this.rebuildContentItems();

        const tree = this.child(new TreeView<SettingsContentItem>(this.contentTreeProps()));
        this.contentTree = tree;
        // The tree takes the pane's remaining height so the footer below it stays pinned to the
        // bottom; `minHeight: 0` lets it shrink rather than pushing the footer out of view.
        tree.root.style.flex = "1 1 auto";
        tree.root.style.minHeight = "0";
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
            justify: "start",
            width: "100%",
            paddingY: "sm",
            shrink: false,
            borderTop: true,
        });
        footer.dataset.part = "footer";
        this.footerElement = footer;
        const viewFileButton = this.child(new ButtonView({
            name: "settings-view-file",
            variant: "link",
            size: "sm",
            background: "light",
            onClick: this.handleOpenSettingsFile,
            children: "View Settings File",
        }));
        footer.append(viewFileButton.root);
        treePane.append(footer);
        viewFileButton.mount();

        const generation = this.initializationGeneration;
        void customEditorRegistry.ensureInitialized().catch((error: unknown) => {
            if (this.isDisposed || generation !== this.initializationGeneration) return;
            ui.notify(errMessage(error, "Failed to load board settings."), "warning");
        });
    }

    protected onDispose(): void {
        this.initializationGeneration++;
        this.cancelProgrammaticScroll();
        this.contentTree = undefined;
        this.panelsElement = undefined;
        this.footerElement = undefined;
        this.sectionViews.clear();
        this.sectionPanels.clear();
        this.sectionWrappers.clear();
        this.dynamicSectionIds.clear();
        this.settingsContentItems = [];
    }

    private appendSectionPanel(section: SettingsSectionDescriptor, parent: HTMLDivElement): HTMLDivElement {
        let view: SettingsChildView;
        if ("kind" in section && section.kind === "board") {
            const boardView = this.child(new BoardSettingsSectionView({
                boardRoot: section.board.boardRoot,
                displayName: section.board.name,
                declarations: section.board.declarations,
            }));
            boardView.mount();
            view = boardView;
        } else {
            const builtInView = this.child(this.createBuiltInSectionView(section as SettingsCatalogSection));
            builtInView.mount();
            view = builtInView;
        }
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
            // Outlined rather than filled: `border: true` alone resolves to the subtle token
            // (#2b2b2b), which is nearly invisible against the page background (#1f1f1f), so the
            // panel edge is stated explicitly.
            border: true,
            borderColor: "default",
            rounded: "lg",
        });
        sectionPanel.dataset.part = "section-panel";
        sectionPanel.append(wrapper);
        parent.append(sectionPanel);
        this.sectionViews.set(section.id, view);
        this.sectionPanels.set(section.id, sectionPanel);
        this.sectionWrappers.set(section.id, wrapper);
        return sectionPanel;
    }

    private createBuiltInSectionView(section: SettingsCatalogSection): SettingsBuiltInView {
        const factory = SECTION_VIEW_FACTORIES[section.id];
        if (!factory) throw new Error(`No Settings section view registered for ${section.id}.`);
        return factory();
    }

    private rebuildDynamicSections(settingsBoards: readonly BoardSettingsRegistration[]): void {
        const panels = this.panelsElement;
        if (!panels || this.isDisposed) return;

        for (const sectionId of this.dynamicSectionIds) {
            const view = this.sectionViews.get(sectionId);
            if (view) this.releaseChild(view);
            const panel = this.sectionPanels.get(sectionId);
            panel?.remove();
            this.sectionViews.delete(sectionId);
            this.sectionPanels.delete(sectionId);
            this.sectionWrappers.delete(sectionId);
        }
        this.dynamicSectionIds.clear();

        const dynamicSections = this.createRuntimeSections(settingsBoards)
            .filter((section): section is BoardSettingsSectionDescriptor => "kind" in section && section.kind === "board");
        const runtimeSections = this.createRuntimeSections(settingsBoards);
        for (let index = dynamicSections.length - 1; index >= 0; index--) {
            const section = dynamicSections[index];
            const runtimeIndex = runtimeSections.findIndex((candidate) => candidate.id === section.id);
            const nextPanel = runtimeSections
                .slice(runtimeIndex + 1)
                .map((candidate) => this.sectionPanels.get(candidate.id))
                .find((candidate): candidate is HTMLDivElement => candidate !== undefined);
            const panel = this.appendSectionPanel(section, panels);
            // The footer used to sit last in this stack; it now lives in the Content pane, so a
            // panel with no successor simply goes at the end.
            panels.insertBefore(panel, nextPanel ?? null);
            this.dynamicSectionIds.add(section.id);
        }
        this.rebuildContentItems();
    }

    private createRuntimeSections(settingsBoards: readonly BoardSettingsRegistration[]): SettingsSectionDescriptor[] {
        const editorSections = settingsBoards
            .filter((board) => board.editorAssociation !== null)
            .map((board) => this.createBoardSectionDescriptor(board, "editors", "Editors"));
        const boardSections = settingsBoards
            .filter((board) => board.editorAssociation === null)
            .map((board) => this.createBoardSectionDescriptor(board, "boards", "Boards"));
        const sections: SettingsSectionDescriptor[] = [...SETTINGS_CATALOG];
        const lastEditor = sections.reduce(
            (lastIndex, section, index) => section.groupId === "editors" ? index : lastIndex,
            -1,
        );
        sections.splice(lastEditor + 1, 0, ...editorSections);
        sections.push(...boardSections);
        return sections;
    }

    private createBoardSectionDescriptor(
        board: BoardSettingsRegistration,
        groupId: "editors" | "boards",
        groupTitle: string,
    ): BoardSettingsSectionDescriptor {
        // Keyed on the board's portable identity, never on its root path: `data-name` is an
        // addressability contract (ui-element-contract.md) and a board root changes between dev
        // and packaged builds and on a reinstall elsewhere (EPIC-109 D5).
        const id = `board-${encodeURIComponent(board.namespace)}`;
        return {
            kind: "board",
            groupId,
            groupTitle,
            id,
            title: board.name,
            description: "",
            elementName: `settings-section-${id}`,
            panelName: `settings-panel-${id}`,
            board,
        };
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
        this.settingsContentItems = createSettingsContentItems(
            this.createRuntimeSections(customEditorRegistry.settingsBoards),
            (sectionId) => this.isNavigableSection(sectionId),
        );
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
        return this.createRuntimeSections(customEditorRegistry.settingsBoards).find((section) =>
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
        for (const section of this.createRuntimeSections(customEditorRegistry.settingsBoards)) {
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
        const sections = this.createRuntimeSections(customEditorRegistry.settingsBoards);
        for (let index = sections.length - 1; index >= 0; index--) {
            const section = sections[index];
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
