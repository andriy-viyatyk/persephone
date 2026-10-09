import { settings } from "../../../api/settings";
import { ui } from "../../../api/ui";
import { app } from "../../../api/app";
import { deleteCustomTheme } from "../../../api/custom-theme-storage";
import { getMissingEditCapabilityMessage, isCapabilityErrorWithCode } from "../../../api/capability-feedback";
import { errMessage } from "../../../../shared/utils";
import { applyTheme, getAvailableThemes } from "../../../theme/themes";
import type { ThemeDefinition } from "../../../theme/themes/types";
import { themeState } from "../../../theme/theme-state";
import { applyPanelAttributes, resolvePanelAttributes } from "../../../uikit/Panel/panel-style";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { IconButtonView } from "../../../uikit/IconButton/IconButtonView";
import "../../../uikit/IconButton/IconButton.css";
import { createSectionRoot, panel, text } from "./settings-native";

interface ThemePreviewProps {
    bgDefault: string;
    bgDark: string;
    textDefault: string;
    accentColor: string;
}

class ThemePreviewView extends VanillaView<ThemePreviewProps> {
    private header: HTMLDivElement | undefined;
    private body: HTMLDivElement | undefined;
    private accentLine: HTMLDivElement | undefined;
    private textLine: HTMLDivElement | undefined;
    private shortLine: HTMLDivElement | undefined;

    public constructor(props: ThemePreviewProps) {
        const root = document.createElement("div");
        root.dataset.type = "settings-theme-preview";
        super(props, root);
    }

    protected onMount(): void {
        this.header = document.createElement("div");
        this.header.dataset.part = "header";
        this.body = document.createElement("div");
        this.body.dataset.part = "body";
        this.accentLine = this.createLine("line-accent");
        this.textLine = this.createLine("line-long");
        this.shortLine = this.createLine("line-short");
        this.body.append(this.accentLine, this.textLine, this.shortLine);
        this.root.append(this.header, this.body);
        this.applyProps(this.props);
    }

    protected onUpdate(props: ThemePreviewProps): void {
        this.applyProps(props);
    }

    protected onDispose(): void {
        this.header = undefined;
        this.body = undefined;
        this.accentLine = undefined;
        this.textLine = undefined;
        this.shortLine = undefined;
    }

    private createLine(part: string): HTMLDivElement {
        const line = document.createElement("div");
        line.dataset.part = "line";
        line.dataset.kind = part;
        return line;
    }

    private applyProps(props: ThemePreviewProps): void {
        if (this.header) this.header.style.backgroundColor = props.bgDark;
        if (this.body) this.body.style.backgroundColor = props.bgDefault;
        if (this.accentLine) this.accentLine.style.backgroundColor = props.accentColor;
        if (this.textLine) this.textLine.style.backgroundColor = props.textDefault;
        if (this.shortLine) this.shortLine.style.backgroundColor = props.textDefault;
    }
}

interface ThemeOption {
    theme: ThemeDefinition;
    /** The clickable wrapper — the element placed in the grid. */
    element: HTMLDivElement;
    panel: HTMLDivElement;
    view: ThemePreviewView;
    name: HTMLSpanElement;
    /** The edit action on every theme tile. */
    editButton: IconButtonView;
    /** The × button on a custom theme's tile. */
    removeButton?: IconButtonView;
    disposeClick: () => void;
    disposeKeydown: () => void;
}

const THEME_EDITOR_MISSING_MESSAGE = "The Theme Editor board is not installed. Search for and install the Theme Editor board in Tools & Editors.";

export class ThemeSectionView extends VanillaView<Record<string, never>> {
    private readonly options = new Map<string, ThemeOption>();
    private createThemeButton: IconButtonView | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        this.renderThemes();
        this.own(themeState.subscribe(
            () => this.renderThemes(),
            (state) => ({ id: state.id, revision: state.revision }),
        ));
    }

    protected onDispose(): void {
        for (const option of this.options.values()) {
            option.view.dispose();
            option.editButton.dispose();
            option.removeButton?.dispose();
            option.disposeClick();
            option.disposeKeydown();
        }
        this.createThemeButton?.dispose();
        this.createThemeButton = undefined;
        this.options.clear();
    }

    private createGrid(): HTMLDivElement {
        const grid = panel({ direction: "row", wrap: true, gap: "lg", justify: "start", paddingBottom: "xl" });
        return grid;
    }

    private renderThemes(): void {
        const themes = getAvailableThemes();
        const customThemes = themes.filter((theme) => theme.id.startsWith("custom-")).sort((left, right) =>
            left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id)
        );
        const groups = [
            { name: "Dark", themes: themes.filter((theme) => !theme.id.startsWith("custom-") && theme.isDark) },
            { name: "Light", themes: themes.filter((theme) => !theme.id.startsWith("custom-") && !theme.isDark) },
            { name: "Custom", themes: customThemes },
        ];
        const activeIds = new Set(themes.map((theme) => theme.id));
        for (const [id, option] of this.options) {
            if (activeIds.has(id)) continue;
            option.view.dispose();
            option.editButton.dispose();
            option.removeButton?.dispose();
            option.disposeClick();
            option.disposeKeydown();
            option.element.remove();
            this.options.delete(id);
        }
        this.root.replaceChildren(panel({ paddingBottom: "lg" }, text("Theme", { bold: true, size: "sm" })));
        groups.forEach(({ name, themes: groupThemes }) => {
            this.root.append(panel({ paddingBottom: "md" }, text(name, { variant: "uppercased", color: "light", bold: true, size: "xs" })));
            const grid = this.createGrid();
            groupThemes.forEach((theme) => {
                let option = this.options.get(theme.id);
                if (!option) option = this.createOption(theme);
                option.theme = theme;
                option.view.update(this.previewProps(theme));
                option.name.textContent = theme.name;
                option.element.setAttribute("aria-label", `${theme.name} theme`);
                option.panel.setAttribute("aria-label", `Apply ${theme.name} theme`);
                option.editButton.update({
                    size: "sm", icon: "edit", title: `Edit ${theme.name}`,
                    "aria-label": `Edit ${theme.name}`,
                    onClick: (event) => {
                        event.stopPropagation();
                        void this.handleThemeEdit(theme.id);
                    },
                });
                option.removeButton?.update({
                    size: "sm", icon: "close", title: `Delete ${theme.name}`,
                    "aria-label": `Delete ${theme.name}`,
                    onClick: (event) => {
                        event.stopPropagation();
                        void this.handleThemeDelete(theme.id);
                    },
                });
                this.applySelection(option);
                grid.append(option.element);
            });
            if (name === "Custom") {
                const createButton = this.getCreateThemeButton();
                grid.append(createButton.root);
            }
            this.root.append(grid);
        });
    }

    private previewProps(theme: ThemeDefinition): ThemePreviewProps {
        return {
            bgDefault: theme.colors["--color-bg-default"],
            bgDark: theme.colors["--color-bg-dark"],
            textDefault: theme.colors["--color-text-default"],
            accentColor: theme.colors["--color-misc-blue"],
        };
    }

    private createOption(theme: ThemeDefinition): ThemeOption {
        const option = document.createElement("div");
        option.dataset.type = "settings-theme-option";
        option.setAttribute("role", "group");
        option.setAttribute("aria-label", `${theme.name} theme`);
        const preview = this.child(new ThemePreviewView(this.previewProps(theme)));
        const name = text(theme.name, { size: "sm", align: "center" });
        const themePanel = panel({
                direction: "column",
                align: "center",
                justify: "center",
                gap: "md",
                paddingY: "lg",
                paddingX: "md",
                width: 160,
                height: 100,
                background: "dark",
                border: true,
                borderColor: "default",
                rounded: "md",
            });
        themePanel.setAttribute("role", "button");
        themePanel.tabIndex = 0;
        themePanel.setAttribute("aria-label", `Apply ${theme.name} theme`);
        const disposeClick = this.listen(themePanel, "click", () => this.handleThemeChange(theme.id));
        const disposeKeydown = this.listen(themePanel, "keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.handleThemeChange(theme.id);
        });
        option.append(themePanel);
        themePanel.append(preview.root, name);
        preview.mount();
        const actions = document.createElement("div");
        actions.dataset.part = "actions";
        const editButton = this.child(new IconButtonView({
            size: "sm",
            icon: "edit",
            title: `Edit ${theme.name}`,
            "aria-label": `Edit ${theme.name}`,
            onClick: (event) => {
                event.stopPropagation();
                void this.handleThemeEdit(theme.id);
            },
        }));
        actions.append(editButton.root);
        editButton.mount();

        let removeButton: IconButtonView | undefined;
        if (theme.id.startsWith("custom-")) {
            removeButton = this.child(new IconButtonView({
                size: "sm", icon: "close", title: `Delete ${theme.name}`,
                "aria-label": `Delete ${theme.name}`,
                onClick: (event) => {
                    event.stopPropagation();
                    void this.handleThemeDelete(theme.id);
                },
            }));
            actions.append(removeButton.root);
            removeButton.mount();
        }
        option.append(actions);
        const result = {
            theme, element: option, panel: themePanel, view: preview, name, editButton,
            removeButton, disposeClick, disposeKeydown,
        };
        this.options.set(theme.id, result);
        return result;
    }

    private handleThemeChange(themeId: string): void {
        applyTheme(themeId);
        settings.set("theme", themeId);
    }

    private async handleThemeEdit(themeId: string): Promise<void> {
        this.handleThemeChange(themeId);
        try {
            await app.capabilities.invoke("theme.edit", { mode: "edit", themeId }, {
                version: 1,
                deadlineMs: 30_000,
            });
        } catch (error) {
            await this.reportThemeEditFailure(error);
        }
    }

    private async handleThemeCreate(): Promise<void> {
        try {
            await app.capabilities.invoke("theme.edit", { mode: "new" }, {
                version: 1,
                deadlineMs: 30_000,
            });
        } catch (error) {
            await this.reportThemeEditFailure(error);
        }
    }

    private async reportThemeEditFailure(error: unknown): Promise<void> {
        if (isCapabilityErrorWithCode(error, "timeout")) {
            ui.notify("Theme editor did not respond", "warning");
            return;
        }

        const missingMessage = getMissingEditCapabilityMessage(error, "theme.edit");
        if (missingMessage === THEME_EDITOR_MISSING_MESSAGE) {
            try {
                await app.pages.showToolsHubPage({ tab: "search" });
            } catch (navigationError) {
                ui.notify(`Could not open Tools & Editors: ${errMessage(navigationError)}`, "error");
            }
            ui.notify(missingMessage, "warning");
            return;
        }

        ui.notify(`Failed to open Theme Editor: ${errMessage(error)}`, "error");
    }

    private getCreateThemeButton(): IconButtonView {
        if (this.createThemeButton) return this.createThemeButton;
        const button = this.child(new IconButtonView({
            size: "md",
            icon: "plus",
            title: "Create a new theme",
            "aria-label": "Create a new theme",
            onClick: (event) => {
                event.stopPropagation();
                void this.handleThemeCreate();
            },
        }));
        button.root.dataset.part = "create";
        button.mount();
        this.createThemeButton = button;
        return button;
    }

    private async handleThemeDelete(themeId: string): Promise<void> {
        const name = this.options.get(themeId)?.theme.name ?? themeId;
        const result = await ui.confirm(
            `Delete the custom theme "${name}"? This cannot be undone.`,
            { title: "Delete Theme", buttons: ["Delete", "Cancel"] },
        );
        if (result !== "Delete") return;
        try {
            await deleteCustomTheme(themeId);
        } catch (error) {
            ui.notify(errMessage(error, `Failed to delete theme "${name}".`), "warning");
        }
    }

    private applySelection({ theme, panel: themePanel }: ThemeOption): void {
            applyPanelAttributes(themePanel, resolvePanelAttributes({
                direction: "column",
                align: "center",
                justify: "center",
                gap: "md",
                paddingY: "lg",
                paddingX: "md",
                width: 160,
                height: 100,
                background: "dark",
                border: true,
                borderColor: theme.id === themeState.get().id ? "active" : "default",
                rounded: "md",
            }));
    }
}

export { ThemeSectionView as ThemeSection };
