import type { BoardSettingsRegistration } from "../../api/boards/custom-editor-registry";
import { t } from "../../../shared/i18n/t";
import type { SettingsSectionDescriptor } from "./settings-catalog";

export interface SettingsLayoutSection {
    readonly kind: "catalog" | "board";
    readonly groupId: string;
    readonly groupLabel: string;
    readonly id: string;
    readonly label: string;
    readonly elementName: string;
    readonly panelName: string;
    readonly descriptor?: SettingsSectionDescriptor;
    readonly board?: BoardSettingsRegistration;
}

export interface SettingsContentItem {
    readonly kind: "group" | "section";
    readonly value: string;
    readonly label: string;
    readonly items?: SettingsContentItem[];
}

export class SettingsLayoutModel {
    private orderedSections: SettingsLayoutSection[] = [];
    private contentTreeItems: SettingsContentItem[] = [];
    private selectedValue: string | undefined;

    public constructor(private readonly catalog: readonly SettingsSectionDescriptor[]) {}

    public get sections(): readonly SettingsLayoutSection[] {
        return this.orderedSections;
    }

    public get selectedContentValue(): string | undefined {
        return this.selectedValue;
    }

    public set selectedContentValue(value: string | undefined) {
        this.selectedValue = value;
    }

    public get contentItems(): SettingsContentItem[] {
        return this.contentTreeItems;
    }

    public rebuild(
        settingsBoards: readonly BoardSettingsRegistration[],
        displayNames: readonly string[],
    ): void {
        const namesByBoard = new Map(settingsBoards.map((board, index) => [board, displayNames[index]]));
        const builtInSections = this.catalog.map((descriptor): SettingsLayoutSection => ({
            kind: "catalog",
            groupId: descriptor.catalog.groupId,
            groupLabel: t(descriptor.catalog.groupTitleKey),
            id: descriptor.catalog.id,
            label: t(descriptor.catalog.titleKey),
            elementName: descriptor.catalog.elementName,
            panelName: descriptor.catalog.panelName,
            descriptor,
        }));
        const editorSections = settingsBoards
            .filter((board) => board.editorAssociation !== null)
            .map((board): SettingsLayoutSection => this.createBoardSection(board, "editors", "settings.groupEditors", namesByBoard.get(board)));
        const boardSections = settingsBoards
            .filter((board) => board.editorAssociation === null)
            .map((board): SettingsLayoutSection => this.createBoardSection(board, "boards", "settings.groupBoards", namesByBoard.get(board)));
        const lastEditor = builtInSections.reduce(
            (lastIndex, section, index) => section.groupId === "editors" ? index : lastIndex,
            -1,
        );
        builtInSections.splice(lastEditor + 1, 0, ...editorSections);
        this.orderedSections = [...builtInSections, ...boardSections];
    }

    public rebuildContentItems(isNavigableSection: (sectionId: string) => boolean): void {
        const groups: SettingsContentItem[] = [];
        for (const section of this.orderedSections) {
            if (!isNavigableSection(section.id)) continue;
            let group = groups[groups.length - 1];
            if (!group || group.value !== `group:${section.groupId}`) {
                group = {
                    kind: "group",
                    value: `group:${section.groupId}`,
                    label: section.groupLabel,
                    items: [],
                };
                groups.push(group);
            }
            group.items?.push({
                kind: "section",
                value: `section:${section.id}`,
                label: section.label,
            });
        }
        this.contentTreeItems = groups;
        if (!this.containsContentValue(this.selectedValue)) {
            this.selectedValue = this.firstSectionValue();
        }
    }

    public firstSectionOf(groupId: string): SettingsLayoutSection | undefined {
        return this.orderedSections.find((section) => section.groupId === groupId);
    }

    public lastSection(): SettingsLayoutSection | undefined {
        return this.orderedSections[this.orderedSections.length - 1];
    }

    private createBoardSection(
        board: BoardSettingsRegistration,
        groupId: "editors" | "boards",
        groupLabelKey: "settings.groupEditors" | "settings.groupBoards",
        displayName: string | undefined,
    ): SettingsLayoutSection {
        const id = `board-${encodeURIComponent(board.namespace)}`;
        return {
            kind: "board",
            groupId,
            groupLabel: t(groupLabelKey),
            id,
            label: displayName ?? board.name,
            elementName: `settings-section-${id}`,
            panelName: `settings-panel-${id}`,
            board,
        };
    }

    private containsContentValue(value: string | undefined): boolean {
        if (!value) return false;
        return this.contentTreeItems.some((group) =>
            group.value === value || group.items?.some((item) => item.value === value) === true,
        );
    }

    private firstSectionValue(): string | undefined {
        for (const group of this.contentTreeItems) {
            const firstSection = group.items?.[0];
            if (firstSection) return firstSection.value;
        }
        return undefined;
    }
}
