import { normalizeClipboardMaxItems, settings } from "../../../api/settings";
import { createComponentModelDriver, type ComponentModelDriver } from "../../../core/state/model";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import type { CheckboxProps } from "../../../uikit/Checkbox/CheckboxView";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { NotificationView } from "../../../uikit/Notification/NotificationView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import {
    ClipboardSectionModel,
    defaultClipboardSectionState,
    type ClipboardSectionProps,
    type ClipboardSectionState,
} from "./ClipboardSectionModel";
import { createSectionRoot, panel, text } from "./settings-native";
import "../../../uikit/Checkbox/Checkbox.css";
import "../../../uikit/Input/Input.css";

export class ClipboardSectionView extends VanillaView<Record<string, never>> {
    private driver: ComponentModelDriver<ClipboardSectionState, ClipboardSectionProps, ClipboardSectionModel> | undefined;
    private model: ClipboardSectionModel | undefined;
    private enabledCheckbox: CheckboxView | undefined;
    private maxItemsInput: InputView | undefined;
    private warning: NotificationView | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const driver = createComponentModelDriver(
            this.currentProps(),
            ClipboardSectionModel,
            defaultClipboardSectionState,
        );
        this.driver = driver;
        const model = driver.model;
        this.model = model;
        this.own(() => driver.dispose());

        this.root.append(
            panel({ paddingBottom: "lg" }, text("Clipboard", { bold: true, size: "sm" })),
            panel(
                { paddingBottom: "md" },
                text("Keep a local history of copied clipboard items", { color: "light", size: "xs" }),
            ),
        );

        const enabledRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        this.enabledCheckbox = this.child(new CheckboxView(this.checkboxProps(
            model.props.clipboardEnabled,
            model.handleToggle,
            "Enable clipboard history",
        )));
        enabledRow.append(this.enabledCheckbox.root);
        this.enabledCheckbox.mount();
        this.root.append(enabledRow);

        const maxItemsRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        maxItemsRow.append(text("Maximum history items:", { size: "sm" }));
        this.maxItemsInput = this.child(new InputView(this.inputProps()));
        maxItemsRow.append(this.maxItemsInput.root);
        this.maxItemsInput.mount();
        this.root.append(maxItemsRow);

        this.warning = this.child(new NotificationView({
            type: "warning",
            message: "Occasionally-copied secrets may remain on disk in readable form.",
        }));
        this.root.append(this.warning.root);
        this.warning.mount();

        driver.mount();
        this.bind(model.state, (state) => state, (state) => this.syncState(state));
        const subscription = settings.onChanged.subscribe(({ key }) => {
            if (key === "clipboard.enabled" || key === "clipboard.max-items") {
                driver.update(this.currentProps());
                this.syncState(model.state.get());
            }
        });
        this.own(subscription);
    }

    protected onDispose(): void {
        this.driver = undefined;
        this.model = undefined;
        this.enabledCheckbox = undefined;
        this.maxItemsInput = undefined;
        this.warning = undefined;
    }

    private currentProps(): ClipboardSectionProps {
        return {
            clipboardEnabled: settings.get("clipboard.enabled"),
            clipboardMaxItems: normalizeClipboardMaxItems(settings.get("clipboard.max-items")),
        };
    }

    private checkboxProps(checked: boolean, onChange: (value: boolean) => void, children: string): CheckboxProps {
        return { checked, onChange, children };
    }

    private inputProps(value = this.model?.state.get().maxItemsValue ?? ""): InputProps {
        return {
            size: "sm",
            width: 72,
            type: "text",
            value,
            onChange: this.model?.setMaxItemsValue,
            onBlur: this.model?.handleMaxItemsBlur,
        };
    }

    private syncState(state: ClipboardSectionState): void {
        const model = this.model;
        if (!model) return;
        this.enabledCheckbox?.update(this.checkboxProps(
            model.props.clipboardEnabled,
            model.handleToggle,
            "Enable clipboard history",
        ));
        this.maxItemsInput?.update(this.inputProps(state.maxItemsValue));
    }
}

export { ClipboardSectionView as ClipboardSection };
