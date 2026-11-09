import { api } from "../../../../ipc/renderer/api";
import { getBoardSetting, setBoardSetting, subscribeBoardSettings, unsetBoardSetting } from "../../../api/board-settings/board-settings-bridge";
import { ui } from "../../../api/ui";
import type { BoardSettingDeclaration, BoardSettingValue } from "../../../api/board-settings/types";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { TextareaView } from "../../../uikit/Textarea/TextareaView";
import type { TextareaProps } from "../../../uikit/Textarea/TextareaView";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import { MultiSelectView, type MultiSelectViewProps } from "../../../uikit/MultiSelect/MultiSelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { errMessage } from "../../../../shared/utils";
import { t } from "../../../../shared/i18n/t";
import { LibraryPathSectionView } from "./SettingsSections";
import { createSectionRoot, helpHeader, helpIcon, panel, settingsFieldLabel } from "./settings-native";
import { boardDisplayText, boardMetadataKeys } from "../../board/board-display-text";
import "../../../uikit/Textarea/Textarea.css";

export interface BoardSettingsSectionProps {
    boardRoot: string;
    displayName: string;
    declarations: readonly BoardSettingDeclaration[];
}

interface BoardSettingControl {
    declaration: BoardSettingDeclaration;
    input?: InputView;
    textarea?: TextareaView;
    checkbox?: CheckboxView;
    select?: SelectView<IListBoxItem>;
    multiSelect?: MultiSelectView<IListBoxItem>;
    draft?: string;
    persistedValue?: string;
    readGeneration: number;
}

// Board inputs, selects and multi-selects sit on the label's line at this width.
const CONTROL_WIDTH = 280;

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
            helpHeader(this.props.displayName, t("settings.boardSettingsDescription"), (cleanup) => this.own(cleanup)),
        );

        for (const declaration of this.props.declarations) this.mountDeclaration(declaration);
        this.own(subscribeBoardSettings(this.props.boardRoot, ({ id, value }) => {
            if (this.isDisposed) return;
            const control = this.controls.get(id);
            if (control) this.applyValue(control, value);
        }));
        for (const control of this.controls.values()) void this.loadValue(control);
    }

    private settingLabel(declaration: BoardSettingDeclaration): string {
        return boardDisplayText(
            this.props.boardRoot,
            undefined,
            boardMetadataKeys.settingLabel(declaration.id),
            declaration.label || declaration.id,
        );
    }

    private settingDescription(declaration: BoardSettingDeclaration): string | undefined {
        if (!declaration.description) return undefined;
        return boardDisplayText(
            this.props.boardRoot,
            undefined,
            boardMetadataKeys.settingDescription(declaration.id),
            declaration.description,
        );
    }

    protected onDispose(): void {
        this.lifecycleGeneration++;
        for (const control of this.controls.values()) {
            if (control.textarea && control.draft !== control.persistedValue) {
                void this.writeValue(control, control.draft ?? "");
            }
        }
        this.controls.clear();
    }

    private mountDeclaration(declaration: BoardSettingDeclaration): void {
        const control: BoardSettingControl = {
            declaration,
            readGeneration: 0,
            draft: settingText(declaration.default),
            persistedValue: settingText(declaration.default),
        };
        this.controls.set(declaration.id, control);

        if (declaration.type === "string" && declaration.format === "folderPath") {
            const library = this.child(new LibraryPathSectionView({}, {
                title: this.settingLabel(declaration),
                description: this.settingDescription(declaration) || t("settings.boardFolderDescription"),
                emptyText: t("settings.boardSettingNotSet"),
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
                        title: this.settingLabel(declaration),
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

        // Label, control and Reset share one line; only a multiline textarea gets a line of its own
        // below its label row (which then carries the Reset button).
        const multiline = declaration.type === "string" && declaration.format === "multiline";
        const row = panel({ direction: "row", align: "center", gap: "md", paddingBottom: multiline ? "none" : "md" });
        const description = this.settingDescription(declaration);
        const help = description ? helpIcon(this.settingLabel(declaration), description, (cleanup) => this.own(cleanup)).root : undefined;
        if (declaration.type !== "boolean") {
            const label = panel({ direction: "row", align: "center", shrink: false }, settingsFieldLabel(this.settingLabel(declaration)));
            if (help) label.append(help);
            row.append(label);
        }

        let below: HTMLElement | undefined;
        if (declaration.type === "boolean") {
            const checkboxRow = panel({ direction: "row", align: "center" });
            const checkbox = this.child(new CheckboxView({
                checked: declaration.default === true,
                onChange: (value) => { void this.writeValue(control, value); },
                children: this.settingLabel(declaration),
            }));
            control.checkbox = checkbox;
            checkboxRow.append(checkbox.root);
            if (help) checkboxRow.append(help);
            checkbox.mount();
            row.append(checkboxRow);
        } else if (declaration.type === "enum") {
            const select = this.child(new SelectView(this.selectProps(control)));
            control.select = select;
            row.append(select.root);
            select.mount();
        } else if (declaration.type === "string" && declaration.format === "multiselect") {
            const multiSelect = this.child(new MultiSelectView(this.multiSelectProps(control)));
            control.multiSelect = multiSelect;
            row.append(multiSelect.root);
            multiSelect.mount();
        } else if (multiline) {
            const textarea = this.child(new TextareaView(this.textareaProps(control)));
            control.textarea = textarea;
            below = textarea.root;
            textarea.mount();
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
            children: t("settings.reset"),
        }));
        row.append(reset.root);
        reset.mount();
        if (below) {
            this.root.append(row, panel({ direction: "column", paddingTop: "sm", paddingBottom: "md" }, below));
        } else {
            this.root.append(row);
        }
    }

    private inputProps(control: BoardSettingControl): InputProps {
        const { declaration } = control;
        return {
            name: `board-setting-${declaration.id}`,
            type: "text" as const,
            size: "sm",
            width: CONTROL_WIDTH,
            value: control.draft ?? settingText(declaration.default),
            onChange: (value: string) => {
                control.draft = value;
                if (declaration.type === "string") void this.writeValue(control, value);
            },
            onBlur: declaration.type === "number" ? () => void this.commitNumber(control) : undefined,
        };
    }

    private textareaProps(control: BoardSettingControl): TextareaProps {
        return {
            name: `board-setting-${control.declaration.id}`,
            value: control.draft ?? settingText(control.declaration.default),
            size: "sm",
            onChange: (value: string) => { control.draft = value; },
            onBlur: () => {
                if (control.draft !== control.persistedValue) void this.writeValue(control, control.draft ?? "");
            },
        };
    }

    private selectProps(control: BoardSettingControl): SelectViewProps<IListBoxItem> {
        const declaration = control.declaration;
        const items = (declaration.options ?? [])
            .filter((option): option is string => typeof option === "string")
            .map((value) => ({ value, label: value }));
        const selectedValue = typeof control.draft === "string" ? control.draft : settingText(declaration.default);
        return {
            name: `board-setting-${declaration.id}`,
            width: CONTROL_WIDTH,
            items,
            value: items.find((item) => item.value === selectedValue) ?? null,
            onChange: (item: IListBoxItem): void => { void this.writeValue(control, item.value); },
        };
    }

    private multiSelectProps(control: BoardSettingControl): MultiSelectViewProps<IListBoxItem> {
        const declaration = control.declaration;
        const options = (declaration.options ?? []).map((option) => typeof option === "string"
            ? { value: option, label: option }
            : { value: option.value, label: option.label ?? option.value });
        const knownValues = new Set(options.map((option) => option.value));
        const storedTokens = splitSettingTokens(control.draft ?? settingText(declaration.default));
        const unknownTokens = storedTokens.filter((token, index) =>
            !knownValues.has(token) && storedTokens.indexOf(token) === index);
        const items = [
            ...options,
            ...unknownTokens.map((value) => ({ value, label: value })),
        ];
        const selected = new Set(storedTokens);
        const value = items.filter((item) => selected.has(item.value));

        return {
            name: `board-setting-${declaration.id}`,
            width: CONTROL_WIDTH,
            items,
            value,
            formatSelection: (selection) => selection.map((item) => item.value).join(", "),
            onChange: (selection) => {
                const selectedValues = new Set(selection.map((item) => item.value));
                const nextValues = [
                    ...options.filter((option) => selectedValues.has(option.value)).map((option) => option.value),
                    ...unknownTokens.filter((token) => selectedValues.has(token)),
                ];
                void this.writeValue(control, nextValues.join(","));
            },
        };
    }

    private applyValue(control: BoardSettingControl, value: BoardSettingValue): void {
        const nextValue = settingText(value);
        if (control.textarea && document.activeElement === control.textarea.root && control.draft !== nextValue) {
            control.persistedValue = nextValue;
            return;
        }
        control.draft = nextValue;
        control.persistedValue = nextValue;
        control.input?.update(this.inputProps(control));
        control.textarea?.update(this.textareaProps(control));
        control.checkbox?.update({
            checked: value === true,
            onChange: (nextValue) => { void this.writeValue(control, nextValue); },
            children: this.settingLabel(control.declaration),
        });
        control.select?.update(this.selectProps(control));
        control.multiSelect?.update(this.multiSelectProps(control));
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
            ui.notify(errMessage(error, t("settings.boardSettingReadFailed", { id: control.declaration.id })), "warning");
        }
    }

    private async writeValue(control: BoardSettingControl, value: BoardSettingValue): Promise<void> {
        try {
            await setBoardSetting(this.props.boardRoot, control.declaration.id, value);
            control.persistedValue = settingText(value);
            if (!this.isDisposed) this.applyValue(control, value);
        } catch (error: unknown) {
            if (this.isDisposed) return;
            ui.notify(errMessage(error, t("settings.boardSettingSaveFailed", { id: control.declaration.id })), "warning");
            await this.loadValue(control);
        }
    }

    private async resetValue(control: BoardSettingControl): Promise<void> {
        try {
            await unsetBoardSetting(this.props.boardRoot, control.declaration.id);
            await this.loadValue(control);
        } catch (error: unknown) {
            if (!this.isDisposed) ui.notify(errMessage(error, t("settings.boardSettingResetFailed", { id: control.declaration.id })), "warning");
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

function splitSettingTokens(value: string): string[] {
    return value.split(",").map((token) => token.trim()).filter(Boolean);
}
