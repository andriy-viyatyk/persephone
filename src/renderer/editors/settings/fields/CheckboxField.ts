import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import type { CheckboxProps } from "../../../uikit/Checkbox/CheckboxView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Checkbox/Checkbox.css";

export interface CheckboxFieldProps {
    store: SettingsStore<boolean>;
    id: string;
    label: string;
    name?: string;
    initialValue?: boolean;
    onError?: (operation: "read" | "write", error: unknown) => void;
}

export class CheckboxField extends VanillaView<CheckboxFieldProps> {
    private checkbox: CheckboxView | undefined;
    private value: boolean;
    private readGeneration = 0;

    public constructor(props: CheckboxFieldProps) {
        const checkbox = new CheckboxView({
            name: props.name,
            checked: props.initialValue ?? false,
            onChange: () => {},
            children: props.label,
        });
        super(props, checkbox.root);
        this.checkbox = this.child(checkbox);
        this.value = props.initialValue ?? false;
    }

    protected onMount(): void {
        this.checkbox?.update(this.checkboxProps());
        this.checkbox?.mount();
        this.own(this.props.store.subscribe(this.props.id, (value) => this.applyValue(value)));
        this.loadValue();
    }

    protected onDispose(): void {
        this.checkbox = undefined;
    }

    private checkboxProps(): CheckboxProps {
        return {
            name: this.props.name,
            checked: this.value,
            onChange: (value) => { void this.writeValue(value); },
            children: this.props.label,
        };
    }

    private applyValue(value: boolean): void {
        this.value = value;
        this.checkbox?.update(this.checkboxProps());
    }

    private loadValue(): void {
        const generation = ++this.readGeneration;
        try {
            const result = this.props.store.get(this.props.id);
            if (result instanceof Promise) {
                void result.then((value) => {
                    if (!this.isDisposed && generation === this.readGeneration) this.applyValue(value);
                }).catch((error: unknown) => {
                    if (this.isDisposed || generation !== this.readGeneration) return;
                    this.applyValue(this.props.initialValue ?? false);
                    this.props.onError?.("read", error);
                });
            } else {
                this.applyValue(result);
            }
        } catch (error: unknown) {
            this.applyValue(this.props.initialValue ?? false);
            this.props.onError?.("read", error);
        }
    }

    private async writeValue(value: boolean): Promise<void> {
        try {
            await this.props.store.set(this.props.id, value);
            if (!this.isDisposed) this.applyValue(value);
        } catch (error: unknown) {
            if (this.isDisposed) return;
            this.props.onError?.("write", error);
            this.loadValue();
        }
    }
}
