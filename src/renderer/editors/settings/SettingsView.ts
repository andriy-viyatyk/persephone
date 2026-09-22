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

function createSettingsContentItems(): SettingsContentItem[] {
    const groups: SettingsContentItem[] = [];
    for (const section of SETTINGS_CATALOG) {
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

const SETTINGS_CONTENT_ITEMS = createSettingsContentItems();

function getSettingsContentChildren(item: SettingsContentItem): SettingsContentItem[] | undefined {
    return item.items;
}

function getSettingsContentName(item: SettingsContentItem): string {
    return item.kind === "group"
        ? `settings-content-group-${item.value.slice("group:".length)}`
        : `settings-content-section-${item.value.slice("section:".length)}`;
}

export class SettingsView extends VanillaView<SettingsEditorProps> {
    private contentTree: TreeView<SettingsContentItem> | undefined;
    private readonly sectionViews = new Map<string, SettingsChildView>();
    private readonly sectionWrappers = new Map<string, HTMLDivElement>();
    private selectedContentValue = `section:${SETTINGS_CATALOG[0]?.id ?? ""}`;

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

        const tree = this.child(new TreeView<SettingsContentItem>(this.contentTreeProps()));
        this.contentTree = tree;
        treePane.append(tree.root);
        tree.mount();

        for (const section of SETTINGS_CATALOG) this.appendSectionPanel(section, panels);

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
        this.contentTree = undefined;
        this.sectionViews.clear();
        this.sectionWrappers.clear();
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
        this.sectionWrappers.set(section.id, wrapper);
        view.mount();
    }

    private contentTreeProps() {
        return {
            name: "settings-content-tree",
            items: SETTINGS_CONTENT_ITEMS,
            getChildren: getSettingsContentChildren,
            isSelected: (item: SettingsContentItem): boolean => item.value === this.selectedContentValue,
            onChange: this.handleContentChange,
            defaultExpandAll: true,
            keyboardNav: true,
            getName: getSettingsContentName,
        };
    }

    private readonly handleContentChange = (item: SettingsContentItem): void => {
        this.selectedContentValue = item.value;
        const tree = this.contentTree;
        if (!tree) return;
        tree.update(this.contentTreeProps());
        if (item.kind === "group") tree.model.expandItem(item.value);
    };

    private readonly handleOpenSettingsFile = (): void => {
        const filePath = settings.settingsFilePath;
        if (filePath) void app.events.openRawLink.sendAsync(createLinkData(filePath));
    };
}

export type { SettingsEditor } from "./SettingsEditor";
