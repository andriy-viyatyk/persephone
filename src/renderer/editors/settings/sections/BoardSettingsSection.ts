import { api } from "../../../../ipc/renderer/api";
import { ui } from "../../../api/ui";
import type { BoardSettingDeclaration, BoardSettingValue } from "../../../../shared/board/board-settings-declarations";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { errMessage } from "../../../../shared/utils";
import { t } from "../../../../shared/i18n/t";
import { boardDisplayText, boardMetadataKeys } from "../../../api/boards/board-display-text";
import { BoardCheckboxField, BoardChoiceField, BoardMultilineField, BoardMultiselectField, BoardStringField } from "../fields/BoardSettingFields";
import type { BoardSettingErrorOperation } from "../fields/BoardSettingFields";
import { createBoardSettingsStore, type SettingsStore } from "../fields/settings-store";
import { NumberField } from "../fields/NumberField";
import { PathField } from "../fields/PathField";
import { createSectionRoot, helpHeader, helpIcon, panel, settingsFieldLabel } from "./settings-native";
import "../../../uikit/Button/Button.css";

export interface BoardSettingsSectionProps {
    boardRoot: string;
    displayName: string;
    declarations: readonly BoardSettingDeclaration[];
}

type BoardSettingFieldView =
    | BoardCheckboxField
    | BoardChoiceField
    | BoardMultilineField
    | BoardMultiselectField
    | BoardStringField
    | NumberField
    | PathField;

// Board inputs, selects and multi-selects sit on the label's line at this width.
const CONTROL_WIDTH = 280;

export class BoardSettingsSectionView extends VanillaView<BoardSettingsSectionProps> {
    private readonly store: SettingsStore<BoardSettingValue>;

    public constructor(props: BoardSettingsSectionProps) {
        super(props, createSectionRoot("settings-section"));
        this.store = createBoardSettingsStore(props.boardRoot);
    }

    protected onMount(): void {
        this.root.append(
            helpHeader(this.props.displayName, t("settings.boardSettingsDescription"), (cleanup) => this.own(cleanup)),
        );
        for (const declaration of this.props.declarations) this.mountDeclaration(declaration);
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

    private mountDeclaration(declaration: BoardSettingDeclaration): void {
        const id = declaration.id;
        const name = `board-setting-${id}`;
        const label = this.settingLabel(declaration);
        const description = this.settingDescription(declaration);
        const onError = (operation: BoardSettingErrorOperation, error: unknown): void => {
            const message = operation === "read"
                ? t("settings.boardSettingReadFailed", { id })
                : operation === "write"
                  ? t("settings.boardSettingSaveFailed", { id })
                  : t("settings.boardSettingResetFailed", { id });
            ui.notify(errMessage(error, message), "warning");
        };

        if (declaration.type === "string" && declaration.format === "folderPath") {
            const section = createSectionRoot("settings-section");
            section.append(helpHeader(
                label,
                description || t("settings.boardFolderDescription"),
                (cleanup) => this.own(cleanup),
            ));
            const field = new PathField({
                store: this.store as unknown as SettingsStore<string | undefined>,
                id,
                title: label,
                emptyText: t("settings.boardSettingNotSet"),
                fallback: typeof declaration.default === "string" ? declaration.default : undefined,
                browse: async () => {
                    const current = await this.store.get(id);
                    const result = await api.showOpenFolderDialog({
                        title: label,
                        defaultPath: typeof current === "string" && current ? current : undefined,
                    });
                    if (result?.[0]) await this.store.set(id, result[0]);
                },
                clear: async () => { await this.store.reset?.(id); },
                clearLabel: t("settings.reset"),
                onError: (operation, error) => {
                    const setting = label.toLowerCase();
                    const fallback = operation === "read"
                        ? t("settings.failedRead", { setting })
                        : operation === "choose"
                          ? t("settings.failedChoose", { setting })
                          : t("settings.failedReset", { setting });
                    ui.notify(errMessage(error, fallback), "warning");
                },
            });
            this.child(field);
            section.append(field.root);
            this.root.append(section);
            field.mount();
            return;
        }

        const multiline = declaration.type === "string" && declaration.format === "multiline";
        const row = panel({ direction: "row", align: "center", gap: "md", paddingBottom: multiline ? "none" : "md" });
        const help = description ? helpIcon(label, description, (cleanup) => this.own(cleanup)).root : undefined;
        if (declaration.type !== "boolean") {
            const labelRow = panel({ direction: "row", align: "center", shrink: false }, settingsFieldLabel(label));
            if (help) labelRow.append(help);
            row.append(labelRow);
        }

        let field: BoardSettingFieldView;
        let below: HTMLElement | undefined;
        if (declaration.type === "boolean") {
            const checkboxRow = panel({ direction: "row", align: "center" });
            field = new BoardCheckboxField({ store: this.store, id, fallback: declaration.default as boolean, label, onError });
            checkboxRow.append(field.root);
            if (help) checkboxRow.append(help);
            row.append(checkboxRow);
        } else if (declaration.type === "enum") {
            field = new BoardChoiceField({ store: this.store, id, fallback: declaration.default as string, declaration, width: CONTROL_WIDTH, name, onError });
            row.append(field.root);
        } else if (declaration.type === "string" && declaration.format === "multiselect") {
            field = new BoardMultiselectField({ store: this.store, id, fallback: declaration.default as string, declaration, width: CONTROL_WIDTH, name, onError });
            row.append(field.root);
        } else if (multiline) {
            field = new BoardMultilineField({ store: this.store, id, fallback: declaration.default as string, name, onError });
            below = field.root;
        } else if (declaration.type === "number") {
            field = new NumberField({
                store: this.store as unknown as SettingsStore<number>,
                id,
                fallback: declaration.default as number,
                width: CONTROL_WIDTH,
                name,
                commitOnEnter: false,
                onError,
            });
            row.append(field.root);
        } else {
            field = new BoardStringField({ store: this.store, id, fallback: declaration.default as string, width: CONTROL_WIDTH, name, onError });
            row.append(field.root);
        }

        const reset = this.child(new ButtonView({
            variant: "link",
            size: "sm",
            background: "light",
            onClick: () => void field.reset(),
            children: t("settings.reset"),
        }));
        row.append(reset.root);
        reset.mount();
        if (below) {
            this.child(field);
            const textareaRow = panel({ direction: "column", paddingTop: "sm", paddingBottom: "md" }, below);
            this.root.append(row, textareaRow);
            field.mount();
        } else {
            this.child(field);
            this.root.append(row);
            field.mount();
        }
    }
}
