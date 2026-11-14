import { SelectView } from "../../../uikit/Select/SelectView";
import type { SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Select/Select.css";

export interface ChoiceFieldItem<V extends string = string> extends IListBoxItem {
    value: V;
}

export interface ChoiceFieldProps<V extends string = string> {
    store: SettingsStore<V>;
    id: string;
    items: readonly ChoiceFieldItem<V>[];
    name?: string;
    ariaLabel?: string;
    size?: SelectViewProps<IListBoxItem>["size"];
    width?: number | string;
    initialValue?: V;
    keepUnknownValue?: boolean;
    fallbackToFirst?: boolean;
    onError?: (operation: "read" | "write", error: unknown) => void;
}

export class ChoiceField<V extends string = string> extends VanillaView<ChoiceFieldProps<V>> {
    private select: SelectView<IListBoxItem> | undefined;
    private value: V | undefined;
    private readGeneration = 0;

    public constructor(props: ChoiceFieldProps<V>) {
        const select = new SelectView<IListBoxItem>({
            items: [...props.items],
            value: null,
            onChange: () => {},
        });
        super(props, select.root);
        this.select = this.child(select);
        this.value = props.initialValue;
    }

    protected onMount(): void {
        this.select?.update(this.selectProps());
        this.select?.mount();
        this.own(this.props.store.subscribe(this.props.id, (value) => this.applyValue(value)));
        this.loadValue();
    }

    protected onUpdate(): void {
        this.select?.update(this.selectProps());
    }

    protected onDispose(): void {
        this.select = undefined;
    }

    private selectProps(): SelectViewProps<IListBoxItem> {
        const items = [...this.props.items];
        let selected = items.find((item) => item.value === this.value) ?? (this.props.fallbackToFirst ? items[0] ?? null : null);
        if (this.props.keepUnknownValue && this.value !== undefined && selected === null) {
            selected = { value: this.value, label: this.value };
            items.push(selected);
        }
        return {
            name: this.props.name,
            "aria-label": this.props.ariaLabel,
            size: this.props.size,
            width: this.props.width,
            items,
            value: selected,
            onChange: (item) => { void this.writeValue(item.value as V); },
        };
    }

    private applyValue(value: V): void {
        this.value = value;
        this.select?.update(this.selectProps());
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
                    if (this.props.initialValue !== undefined) this.applyValue(this.props.initialValue);
                    this.props.onError?.("read", error);
                });
            } else {
                this.applyValue(result);
            }
        } catch (error: unknown) {
            if (this.props.initialValue !== undefined) this.applyValue(this.props.initialValue);
            this.props.onError?.("read", error);
        }
    }

    private async writeValue(value: V): Promise<void> {
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
