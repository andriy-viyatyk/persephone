import { api } from "../../../../ipc/renderer/api";
import { getBoardSetting, setBoardSetting, subscribeBoardSettings, unsetBoardSetting } from "../../../api/board-settings/board-settings-bridge";
import { ui } from "../../../api/ui";
import type { BoardSettingDeclaration, BoardSettingValue } from "../../../api/board-settings/types";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { errMessage } from "../../../../shared/utils";
import { LibraryPathSectionView } from "./SettingsSections";
import { createSectionRoot, panel, settingsFieldLabel, text } from "./settings-native";

export interface BoardSettingsSectionProps {
    boardRoot: string;
    displayName: string;
    declarations: readonly BoardSettingDeclaration[];
}

interface BoardSettingControl {
    declaration: BoardSettingDeclaration;
    input?: InputView;
    checkbox?: CheckboxView;
    select?: SelectView<IListBoxItem>;
    draft?: string;
    readGeneration: number;
}

function settingLabel(declaration: BoardSettingDeclaration): string {
    return declaration.label || declaration.id;
}

function settingText(value: BoardSettingValue): string {
    return typeof value === "string" ? value : String(value);
}

export class BoardSettingsSectionView extends VanillaView<BoardSettingsSectionProps> {
    private readonly controls = new Map<string, BoardSettingControl>();
    private lifecycleGeneration = 0;

    public constructor(props: BoardSettingsSectionProps) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        this.root.append(
            panel({ paddingBottom: "lg" }, text(this.props.displayName, { bold: true, size: "sm" })),
            panel({ paddingBottom: "md" }, text("Settings provided by this board.", { color: "light", size: "xs" })),
        );

        for (const declaration of this.props.declarations) this.mountDeclaration(declaration);
        this.own(subscribeBoardSettings(this.props.boardRoot, ({ id, value }) => {
            if (this.isDisposed) return;
            const control = this.controls.get(id);
            if (control) this.applyValue(control, value);
        }));
        for (const control of this.controls.values()) void this.loadValue(control);
    }

    protected onDispose(): void {
        this.lifecycleGeneration++;
        this.controls.clear();
    }

    private mountDeclaration(declaration: BoardSettingDeclaration): void {
        const control: BoardSettingControl = {
            declaration,
            readGeneration: 0,
            draft: settingText(declaration.default),
        };
        this.controls.set(declaration.id, control);

        if (declaration.type === "string" && declaration.format === "folderPath") {
            const library = this.child(new LibraryPathSectionView({}, {
                title: settingLabel(declaration),
                description: declaration.description || "Folder path provided by this board.",
                emptyText: "Not set",
                read: async () => {
                    const value = await getBoardSetting(this.props.boardRoot, declaration.id);
                    return typeof value === "string" ? value : undefined;
                },
                subscribe: (listener) => subscribeBoardSettings(
                    this.props.boardRoot,
                    (change) => { if (change.id === declaration.id) listener(); },
                ),
                browse: async () => {
                    const current = await getBoardSetting(this.props.boardRoot, declaration.id);
                    const result = await api.showOpenFolderDialog({
                        title: settingLabel(declaration),
                        defaultPath: typeof current === "string" && current ? current : undefined,
                    });
                    if (result?.[0]) await setBoardSetting(this.props.boardRoot, declaration.id, result[0]);
                },
                reset: () => unsetBoardSetting(this.props.boardRoot, declaration.id),
                clearLabel: "Reset",
            }));
            this.root.append(library.root);
            library.mount();
            return;
        }

        const row = panel({ direction: "column", gap: "sm", paddingBottom: "lg" });
        if (declaration.type !== "boolean") row.append(settingsFieldLabel(settingLabel(declaration)));
        if (declaration.description) row.append(text(declaration.description, { color: "light", size: "xs" }));

        if (declaration.type === "boolean") {
            const checkboxRow = panel({ direction: "row", align: "center", gap: "md" });
            const checkbox = this.child(new CheckboxView({
                checked: declaration.default === true,
                onChange: (value) => { void this.writeValue(control, value); },
                children: settingLabel(declaration),
            }));
            control.checkbox = checkbox;
            checkboxRow.append(checkbox.root);
            checkbox.mount();
            row.append(checkboxRow);
        } else if (declaration.type === "enum") {
            const select = this.child(new SelectView(this.selectProps(control)));
            control.select = select;
            row.append(select.root);
            select.mount();
        } else {
            const input = this.child(new InputView(this.inputProps(control)));
            control.input = input;
            row.append(input.root);
            input.mount();
        }

        const reset = this.child(new ButtonView({
            variant: "link",
            size: "sm",
            background: "light",
            onClick: () => void this.resetValue(control),
            children: "Reset",
        }));
        row.append(reset.root);
        reset.mount();
        this.root.append(row);
    }

    private inputProps(control: BoardSettingControl): InputProps {
        const { declaration } = control;
        return {
            name: `board-setting-${declaration.id}`,
            type: "text" as const,
            value: control.draft ?? settingText(declaration.default),
            onChange: (value: string) => {
                control.draft = value;
                if (declaration.type === "string") void this.writeValue(control, value);
            },
            onBlur: declaration.type === "number" ? () => void this.commitNumber(control) : undefined,
        };
    }

    private selectProps(control: BoardSettingControl): SelectViewProps<IListBoxItem> {
        const declaration = control.declaration;
        const items = (declaration.options ?? []).map((value) => ({ value, label: value }));
        const selectedValue = typeof control.draft === "string" ? control.draft : settingText(declaration.default);
        return {
            name: `board-setting-${declaration.id}`,
            items,
            value: items.find((item) => item.value === selectedValue) ?? null,
            onChange: (item: IListBoxItem): void => { void this.writeValue(control, item.value); },
        };
    }

    private applyValue(control: BoardSettingControl, value: BoardSettingValue): void {
        control.draft = settingText(value);
        control.input?.update(this.inputProps(control));
        control.checkbox?.update({
            checked: value === true,
            onChange: (nextValue) => { void this.writeValue(control, nextValue); },
            children: settingLabel(control.declaration),
        });
        control.select?.update(this.selectProps(control));
    }

    private async loadValue(control: BoardSettingControl): Promise<void> {
        const generation = ++control.readGeneration;
        const lifecycleGeneration = this.lifecycleGeneration;
        try {
            const value = await getBoardSetting(this.props.boardRoot, control.declaration.id);
            if (this.isDisposed || lifecycleGeneration !== this.lifecycleGeneration || generation !== control.readGeneration) return;
            this.applyValue(control, value);
        } catch (error: unknown) {
            if (this.isDisposed || lifecycleGeneration !== this.lifecycleGeneration || generation !== control.readGeneration) return;
            this.applyValue(control, control.declaration.default);
            ui.notify(errMessage(error, `Failed to read board setting "${control.declaration.id}".`), "warning");
        }
    }

    private async writeValue(control: BoardSettingControl, value: BoardSettingValue): Promise<void> {
        try {
            await setBoardSetting(this.props.boardRoot, control.declaration.id, value);
            if (!this.isDisposed) this.applyValue(control, value);
        } catch (error: unknown) {
            if (this.isDisposed) return;
            ui.notify(errMessage(error, `Failed to save board setting "${control.declaration.id}".`), "warning");
            await this.loadValue(control);
        }
    }

    private async resetValue(control: BoardSettingControl): Promise<void> {
        try {
            await unsetBoardSetting(this.props.boardRoot, control.declaration.id);
            await this.loadValue(control);
        } catch (error: unknown) {
            if (!this.isDisposed) ui.notify(errMessage(error, `Failed to reset board setting "${control.declaration.id}".`), "warning");
        }
    }

    private async commitNumber(control: BoardSettingControl): Promise<void> {
        const draft = control.draft ?? "";
        if (!draft.trim()) {
            await this.loadValue(control);
            return;
        }
        const value = Number(draft);
        if (!Number.isFinite(value)) {
            await this.loadValue(control);
            return;
        }
        await this.writeValue(control, value);
    }
}
