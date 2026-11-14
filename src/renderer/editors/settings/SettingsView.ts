import { app } from "../../api/app";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { customEditorRegistry, type BoardSettingsRegistration } from "../../api/boards/custom-editor-registry";
import { boardSettingsDisplayName, ensureBoardDisplayNames } from "../../api/boards/board-display-text";
import { createLinkData } from "../../../shared/link-data";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { TreeView } from "../../uikit/Tree/TreeView";
import { VanillaView, type IOwnedView } from "../../uikit/shared/vanilla-view";
import { createSettingsSectionDescriptors } from "./settings-catalog";
import { SettingsLayoutModel, type SettingsContentItem, type SettingsLayoutSection } from "./SettingsLayoutModel";
import { ScrollSpy } from "./ScrollSpy";
import { BrowserProfilesSectionView } from "./sections/BrowserProfilesSection";
import { SiteExtensionsSectionView } from "./sections/SiteExtensionsSection";
import { ClipboardSectionView } from "./sections/ClipboardSection";
import { DefaultBrowserSectionView } from "./sections/DefaultBrowserSection";
import { FileSearchSectionView } from "./sections/FileSearchSection";
import { McpSectionView } from "./sections/McpSection";
import { ThemeSectionView } from "./sections/ThemeSection";
import { LanguageSectionView } from "./sections/LanguageSection";
import { BoardSettingsSectionView } from "./sections/BoardSettingsSection";
import {
    BoardVarsSectionView,
    EditorBehaviorSectionView,
    GitIntegrationSectionView,
    LinkBehaviorSectionView,
    createScriptLibrarySection,
    TerminalSectionView,
    VideoPlayerSectionView,
    WindowBehaviorSectionView,
    VoiceTypingSettingsSectionView,
    MicrophoneAudioSectionView,
} from "./sections/SettingsSections";
import { helpHeader, sectionTitle } from "./sections/settings-native";
import "./settings.css";
import "../../uikit/Button/Button.css";

export interface SettingsEditorProps {
    model: import("./SettingsEditor").SettingsEditor;
}

type SettingsChildView = IOwnedView;
type SettingsBuiltInView = VanillaView<Record<string, never>>;

class SettingsSectionMount implements IOwnedView {
    private disposed = false;

    public constructor(
        private readonly view: SettingsChildView,
        private readonly headerCleanups: Array<() => void>,
        private readonly mountView: () => void,
    ) {}

    public get root(): HTMLElement {
        return this.view.root;
    }

    public mount(): void {
        this.mountView();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        try {
            this.view.dispose();
        } finally {
            this.headerCleanups.splice(0).forEach((cleanup) => cleanup());
        }
    }
}

const SECTION_VIEW_FACTORIES: Readonly<Record<string, () => SettingsBuiltInView>> = {
    theme: () => new ThemeSectionView({}),
    language: () => new LanguageSectionView({}),
    "window-behavior": () => new WindowBehaviorSectionView({}),
    clipboard: () => new ClipboardSectionView({}),
    terminal: () => new TerminalSectionView({}),
    "file-search": () => new FileSearchSectionView({}),
    "editor-behavior": () => new EditorBehaviorSectionView({}),
    "script-library": createScriptLibrarySection,
    "video-player": () => new VideoPlayerSectionView({}),
    "browser-profiles": () => new BrowserProfilesSectionView({}),
    "site-extensions": () => new SiteExtensionsSectionView({}),
    "default-browser": () => new DefaultBrowserSectionView({}),
    "link-behavior": () => new LinkBehaviorSectionView({}),
    mcp: () => new McpSectionView({}),
    "git-integration": () => new GitIntegrationSectionView({}),
    "board-vars": () => new BoardVarsSectionView({}),
    "voice-typing": () => new VoiceTypingSettingsSectionView({}),
    "microphone-audio": () => new MicrophoneAudioSectionView({}),
};


function getSettingsContentChildren(item: SettingsContentItem): SettingsContentItem[] | undefined {
    return item.items;
}

function getSettingsContentName(item: SettingsContentItem): string {
    return item.kind === "group"
        ? `settings-content-group-${item.value.slice("group:".length)}`
        : `settings-content-section-${item.value.slice("section:".length)}`;
}

export class SettingsView extends VanillaView<SettingsEditorProps> {
    private readonly sectionDescriptors = createSettingsSectionDescriptors(SECTION_VIEW_FACTORIES);
    private readonly layout = new SettingsLayoutModel(this.sectionDescriptors);
    private contentTree: TreeView<SettingsContentItem> | undefined;
    private readonly sectionMounts = new Map<string, SettingsSectionMount>();
    private readonly sectionPanels = new Map<string, HTMLDivElement>();
    private readonly sectionWrappers = new Map<string, HTMLDivElement>();
    private panelsElement: HTMLDivElement | undefined;
    private scrollSpy: ScrollSpy | undefined;
    private readonly dynamicSectionIds = new Set<string>();
    private dynamicSectionsGeneration = 0;
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
        title.textContent = t("settings.pageTitle");

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
            width: 280,
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
        this.layout.rebuild([], []);
        for (const section of this.layout.sections) this.appendSectionPanel(section, panels);
        this.own(customEditorRegistry.state.subscribe<readonly BoardSettingsRegistration[]>(
            (settingsBoards) => {
                if (!this.isDisposed) void this.rebuildDynamicSections(settingsBoards);
            },
            (state) => state.settingsBoards,
        ));
        void this.rebuildDynamicSections(customEditorRegistry.settingsBoards);
        this.rebuildContentItems();

        const tree = this.child(new TreeView<SettingsContentItem>(this.contentTreeProps()));
        this.contentTree = tree;
        // The tree takes the pane's remaining height so the footer below it stays pinned to the
        // bottom; `minHeight: 0` lets it shrink rather than pushing the footer out of view.
        tree.root.style.flex = "1 1 auto";
        tree.root.style.minHeight = "0";
        treePane.append(tree.root);
        tree.mount();

        this.scrollSpy = new ScrollSpy(
            () => this.panelsElement,
            () => this.layout.sections,
            (sectionId) => this.sectionWrappers.get(sectionId),
            this.isNavigableSection,
            this.applyScrollSelection,
            this.rebuildContentItems,
        );
        this.listen(panels, "scroll", this.handlePanelsScroll);

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
            title: t("settings.viewSettingsFile"),
            children: t("settings.viewSettingsFile"),
        }));
        footer.append(viewFileButton.root);
        treePane.append(footer);
        viewFileButton.mount();

        const generation = this.initializationGeneration;
        void customEditorRegistry.ensureInitialized().catch((error: unknown) => {
            if (this.isDisposed || generation !== this.initializationGeneration) return;
            ui.notify(errMessage(error, t("settings.failedLoadBoardSettings")), "warning");
        });
    }

    protected onDispose(): void {
        this.initializationGeneration++;
        this.dynamicSectionsGeneration++;
        this.scrollSpy?.dispose();
        this.scrollSpy = undefined;
        this.contentTree = undefined;
        this.panelsElement = undefined;
        this.footerElement = undefined;
        this.sectionMounts.clear();
        this.sectionPanels.clear();
        this.sectionWrappers.clear();
        this.dynamicSectionIds.clear();
    }

    private appendSectionPanel(section: SettingsLayoutSection, parent: HTMLDivElement): HTMLDivElement {
        const headerCleanups: Array<() => void> = [];
        let view: SettingsChildView;
        let mountView: () => void;
        if (section.kind === "board" && section.board) {
            const boardView = new BoardSettingsSectionView({
                boardRoot: section.board.boardRoot,
                displayName: section.label,
                declarations: section.board.declarations,
            });
            view = boardView;
            mountView = () => boardView.mount();
        } else if (section.descriptor) {
            const builtInView = section.descriptor.create() as SettingsBuiltInView;
            view = builtInView;
            mountView = () => builtInView.mount();
        } else {
            throw new Error(`No Settings section view registered for ${section.id}.`);
        }
        const sectionMount = this.child(new SettingsSectionMount(view, headerCleanups, mountView));
        const header = section.descriptor?.headerPlacement === "section"
            ? this.createSectionHeader(section.descriptor, headerCleanups)
            : undefined;
        if (section.descriptor?.headerPlacement === "section" && header) view.root.prepend(header);
        sectionMount.mount();

        const wrapper = document.createElement("div");
        wrapper.dataset.name = section.elementName;
        wrapper.dataset.part = "section-wrapper";
        wrapper.className = "settings-section-wrapper";
        const wrapperHeader = section.descriptor?.headerPlacement === "wrapper"
            ? this.createSectionHeader(section.descriptor, headerCleanups)
            : undefined;
        if (wrapperHeader) wrapper.append(wrapperHeader);
        wrapper.append(view.root);

        const sectionPanel = createPanelElement({
            name: section.panelName,
            direction: "column",
            width: "100%",
            shrink: false,
            // Less space above the title and below the content than at the sides; the title's own bottom space
            // (sectionTitle) separates it from the content.
            padding: "xxl",
            paddingTop: "lg",
            paddingBottom: "lg",
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
        this.sectionMounts.set(section.id, sectionMount);
        this.sectionPanels.set(section.id, sectionPanel);
        this.sectionWrappers.set(section.id, wrapper);
        return sectionPanel;
    }

    private createSectionHeader(
        descriptor: NonNullable<SettingsLayoutSection["descriptor"]>,
        headerCleanups: Array<() => void>,
    ): HTMLDivElement {
        const title = t(descriptor.titleKey);
        const own = (cleanup: () => void): void => { headerCleanups.push(cleanup); };
        return descriptor.helpKey
            ? helpHeader(title, t(descriptor.helpKey), own)
            : sectionTitle(title);
    }

    private async rebuildDynamicSections(settingsBoards: readonly BoardSettingsRegistration[]): Promise<void> {
        const generation = ++this.dynamicSectionsGeneration;
        await ensureBoardDisplayNames(settingsBoards);
        if (generation !== this.dynamicSectionsGeneration || this.isDisposed) return;
        const panels = this.panelsElement;
        if (!panels || this.isDisposed) return;

        const displayNames = settingsBoards.map(boardSettingsDisplayName);
        this.layout.rebuild(settingsBoards, displayNames);

        for (const sectionId of this.dynamicSectionIds) {
            const sectionMount = this.sectionMounts.get(sectionId);
            if (sectionMount) this.releaseChild(sectionMount);
            const panel = this.sectionPanels.get(sectionId);
            panel?.remove();
            this.sectionMounts.delete(sectionId);
            this.sectionPanels.delete(sectionId);
            this.sectionWrappers.delete(sectionId);
        }
        this.dynamicSectionIds.clear();

        const dynamicSections = this.layout.sections.filter((section) => section.kind === "board");
        for (let index = dynamicSections.length - 1; index >= 0; index--) {
            const section = dynamicSections[index];
            const runtimeIndex = this.layout.sections.findIndex((candidate) => candidate.id === section.id);
            const nextPanel = this.layout.sections
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

    private readonly isNavigableSection = (sectionId: string): boolean => {
        const panel = this.sectionPanels.get(sectionId);
        const wrapper = this.sectionWrappers.get(sectionId);
        const sectionRoot = this.sectionMounts.get(sectionId)?.root;
        if (!panel || !wrapper || !sectionRoot) return false;
        // Explicit `hidden` only — deliberately NOT geometry. A section that measures 0x0 is not
        // necessarily hidden: this runs during mount before first layout, and a page that is open
        // but not the active tab measures zero for everything it contains. Testing rects here made
        // every section non-navigable and rendered an empty Content tree on any mount that happened
        // before layout, which is most of them.
        return !panel.hidden && !wrapper.hidden && !sectionRoot.hidden;
    };

    private readonly rebuildContentItems = (): void => {
        this.layout.rebuildContentItems(this.isNavigableSection);
        this.scrollSpy?.cancelIfSectionNotNavigable();
        this.contentTree?.update(this.contentTreeProps());
    };

    private contentTreeProps() {
        return {
            name: "settings-content-tree",
            items: this.layout.contentItems,
            getChildren: getSettingsContentChildren,
            isSelected: (item: SettingsContentItem): boolean => item.value === this.layout.selectedContentValue,
            onChange: this.handleContentChange,
            defaultExpandAll: true,
            keyboardNav: true,
            getTooltip: (item: SettingsContentItem) => item.label,
            getName: getSettingsContentName,
        };
    }

    private readonly handleContentChange = (item: SettingsContentItem): void => {
        const target = this.resolveNavigationTarget(item);
        if (!target) return;

        this.layout.selectedContentValue = item.value;
        const tree = this.contentTree;
        if (!tree) return;
        tree.update(this.contentTreeProps());
        if (item.kind === "group") tree.model.expandItem(item.value);
        this.scrollSpy?.scrollTo(item.value, target);
    };

    private resolveNavigationTarget(item: SettingsContentItem): { sectionId: string; wrapper: HTMLDivElement } | undefined {
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
        return this.layout.sections.find((section) =>
            section.groupId === groupId && this.isNavigableSection(section.id),
        )?.id;
    }

    private sectionIdFromValue(value: string, prefix: string): string | undefined {
        return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
    }

    private readonly handlePanelsScroll = (): void => {
        this.scrollSpy?.handleScroll();
    };

    private readonly applyScrollSelection = (selectionValue: string, force = false): void => {
        if (!force && selectionValue === this.layout.selectedContentValue) return;
        this.layout.selectedContentValue = selectionValue;
        // The spy intentionally updates only the controlled selection. In particular, it must not
        // change activeIndex or call an active-row API, because TreeView would scroll the Content pane.
        this.contentTree?.update(this.contentTreeProps());
    };

    private readonly handleOpenSettingsFile = (): void => {
        const filePath = settings.settingsFilePath;
        if (filePath) void app.events.openRawLink.sendAsync(createLinkData(filePath));
    };
}

export type { SettingsEditor } from "./SettingsEditor";
