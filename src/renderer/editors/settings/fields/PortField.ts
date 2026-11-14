import { NumberField } from "./NumberField";
import type { SettingsStore } from "./settings-store";
import { VanillaView } from "../../../uikit/shared/vanilla-view";

export interface PortFieldProps {
    store: SettingsStore<number>;
    id: string;
    range: { min: number; max: number };
    width: number | string;
    fallback: number;
    disabled?: boolean;
}

/** A number field that keeps the settings ports' integer-prefix parsing and range rule. */
export class PortField extends VanillaView<PortFieldProps> {
    private readonly numberField: NumberField;

    public constructor(props: PortFieldProps) {
        const numberField = new NumberField({
            store: props.store,
            id: props.id,
            fallback: props.fallback,
            width: props.width,
            format: String,
            preserveDraftOnSameValue: true,
            parse: (draft) => parseInt(draft, 10),
            parseFirst: true,
            accepts: (port) => port >= props.range.min && port <= props.range.max,
            disabled: props.disabled,
        });
        super(props, numberField.root);
        this.numberField = this.child(numberField);
    }

    protected onMount(): void {
        this.numberField.mount();
    }

    public setDisabled(disabled: boolean): void {
        this.numberField.setDisabled(disabled);
    }
}
