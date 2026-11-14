import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Input/Input.css";

export interface NumberFieldProps {
    store: SettingsStore<number>;
    id: string;
    min?: number;
    max?: number;
    integer?: boolean;
    width?: number | string;
    name?: string;
    commitOnEnter?: boolean;
    parse?: (draft: string) => number;
    parseFirst?: boolean;
    accepts?: (value: number) => boolean;
    format?: (value: number) => string;
    preserveDraftOnSameValue?: boolean;
    disabled?: boolean;
    fallback: number;
    onError?: (operation: "read" | "write" | "reset", error: unknown) => void;
}

export class NumberField extends VanillaView<NumberFieldProps> {
    private input: InputView | undefined;
    private draft: string;
    private persistedValue: string;
    private readGeneration = 0;
    private disabled: boolean;

    public constructor(props: NumberFieldProps) {
        const input = new InputView({
            type: "text",
            size: "sm",
            value: (props.format ?? String)(props.fallback),
            onChange: () => {},
        });
        super(props, input.root);
        this.input = this.child(input);
        this.draft = (props.format ?? String)(props.fallback);
        this.persistedValue = this.draft;
        this.disabled = props.disabled ?? false;
    }

    protected onMount(): void {
        this.input?.update(this.inputProps());
        this.input?.mount();
        this.own(this.props.store.subscribe(this.props.id, (value) => this.applyValue(value)));
        void this.loadValue(true);
    }

    protected onDispose(): void {
        this.input = undefined;
    }

    public async reset(): Promise<void> {
        try {
            if (!this.props.store.reset) throw new Error("Settings reset is unavailable.");
            await this.props.store.reset(this.props.id);
            await this.loadValue(true);
        } catch (error: unknown) {
            if (!this.isDisposed) this.props.onError?.("reset", error);
        }
    }

    private inputProps(): InputProps {
        return {
            name: this.props.name,
            type: "text",
            size: "sm",
            width: this.props.width,
            disabled: this.disabled,
            value: this.draft,
            onChange: (value) => { this.draft = value; },
            onBlur: () => { void this.commit(); },
            onKeyDown: (event) => {
                if (event.key === "Enter" && this.props.commitOnEnter !== false) {
                    this.input?.inputElement?.blur();
                }
            },
        };
    }

    private applyValue(value: number, force = false): void {
        const formattedValue = (this.props.format ?? String)(value);
        if (!force && this.props.preserveDraftOnSameValue && formattedValue === this.persistedValue) return;
        this.draft = formattedValue;
        this.persistedValue = formattedValue;
        this.input?.update(this.inputProps());
    }

    private async loadValue(force = false): Promise<void> {
        const generation = ++this.readGeneration;
        try {
            const result = this.props.store.get(this.props.id);
            if (result instanceof Promise) {
                const value = await result;
                if (!this.isDisposed && generation === this.readGeneration) this.applyValue(value, force);
            } else {
                this.applyValue(result, force);
            }
        } catch (error: unknown) {
            if (this.isDisposed || generation !== this.readGeneration) return;
            this.applyValue(this.props.fallback, force);
            this.props.onError?.("read", error);
        }
    }

    private async writeValue(value: number): Promise<void> {
        try {
            await this.props.store.set(this.props.id, value);
            if (!this.isDisposed) this.applyValue(value);
        } catch (error: unknown) {
            if (this.isDisposed) return;
            this.props.onError?.("write", error);
            await this.loadValue(true);
        }
    }

    private async commit(): Promise<void> {
        const draft = this.draft ?? "";
        if (!draft.trim()) {
            await this.loadValue(true);
            return;
        }
        const value = this.props.parseFirst && this.props.parse ? this.props.parse(draft) : Number(draft);
        if (!Number.isFinite(value)) {
            await this.loadValue(true);
            return;
        }
        const acceptedValue = this.props.parseFirst ? value : this.props.parse ? this.props.parse(draft) : value;
        if (!Number.isFinite(acceptedValue) || (this.props.accepts && !this.props.accepts(acceptedValue))) {
            await this.loadValue(true);
            return;
        }
        if (this.props.integer && !Number.isInteger(acceptedValue)) {
            await this.loadValue(true);
            return;
        }
        if (this.props.min !== undefined && acceptedValue < this.props.min) {
            await this.loadValue(true);
            return;
        }
        if (this.props.max !== undefined && acceptedValue > this.props.max) {
            await this.loadValue(true);
            return;
        }
        await this.writeValue(acceptedValue);
    }

    public setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        this.input?.update(this.inputProps());
    }
}
