import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { TextareaView } from "../../../uikit/Textarea/TextareaView";
import type { TextareaProps } from "../../../uikit/Textarea/TextareaView";
import { MultiSelectView } from "../../../uikit/MultiSelect/MultiSelectView";
import type { MultiSelectViewProps } from "../../../uikit/MultiSelect/MultiSelectView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import { SelectView } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import type { BoardSettingDeclaration, BoardSettingValue } from "../../../../shared/board/board-settings-declarations";
import { decodeMultiSelect, encodeMultiSelect } from "../../../api/board-settings/types";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Checkbox/Checkbox.css";
import "../../../uikit/Input/Input.css";
import "../../../uikit/MultiSelect/MultiSelect.css";
import "../../../uikit/Select/Select.css";
import "../../../uikit/Textarea/Textarea.css";

export type BoardSettingErrorOperation = "read" | "write" | "reset";

interface BoardSettingFieldProps<V extends BoardSettingValue> {
    store: SettingsStore<BoardSettingValue>;
    id: string;
    fallback: V;
    name?: string;
    onError?: (operation: BoardSettingErrorOperation, error: unknown) => void;
}

class BoardSettingController<V extends BoardSettingValue> {
    public persistedValue: string;
    private readGeneration = 0;

    public constructor(
        private readonly props: BoardSettingFieldProps<V>,
        private readonly isDisposed: () => boolean,
        private readonly applyValue: (value: V) => void,
        private readonly own: (cleanup: () => void) => void,
    ) {
        this.persistedValue = settingText(props.fallback);
    }

    public start(): void {
        this.own(this.props.store.subscribe(this.props.id, (value) => this.applyValue(value as V)));
        void this.loadValue();
    }

    public async write(value: V): Promise<void> {
        try {
            await this.props.store.set(this.props.id, value);
            this.persistedValue = settingText(value);
            if (!this.isDisposed()) this.applyValue(value);
        } catch (error: unknown) {
            if (this.isDisposed()) return;
            this.props.onError?.("write", error);
            await this.loadValue();
        }
    }

    public async reset(): Promise<void> {
        try {
            if (!this.props.store.reset) throw new Error("Board settings reset is unavailable.");
            await this.props.store.reset(this.props.id);
            await this.loadValue();
        } catch (error: unknown) {
            if (!this.isDisposed()) this.props.onError?.("reset", error);
        }
    }

    private async loadValue(): Promise<void> {
        const generation = ++this.readGeneration;
        try {
            const result = this.props.store.get(this.props.id);
            if (result instanceof Promise) {
                const value = await result;
                if (!this.isDisposed() && generation === this.readGeneration) this.applyValue(value as V);
            } else {
                this.applyValue(result as V);
            }
        } catch (error: unknown) {
            if (this.isDisposed() || generation !== this.readGeneration) return;
            this.applyValue(this.props.fallback);
            this.props.onError?.("read", error);
        }
    }
}

interface BoardCheckboxFieldProps extends BoardSettingFieldProps<boolean> {
    label: string;
}

export class BoardCheckboxField extends VanillaView<BoardCheckboxFieldProps> {
    private checkbox: CheckboxView;
    private value: boolean;
    private readonly controller: BoardSettingController<boolean>;

    public constructor(props: BoardCheckboxFieldProps) {
        const checkbox = new CheckboxView({ checked: props.fallback, onChange: () => {}, children: props.label });
        super(props, checkbox.root);
        this.checkbox = this.child(checkbox);
        this.value = props.fallback;
        this.controller = new BoardSettingController(props, () => this.isDisposed, (value) => this.applyValue(value), (cleanup) => this.own(cleanup));
    }

    protected onMount(): void {
        this.checkbox.update({ name: this.props.name, checked: this.value, onChange: (value) => { void this.controller.write(value); }, children: this.props.label });
        this.checkbox.mount();
        this.controller.start();
    }

    protected onDispose(): void {}

    private applyValue(value: boolean): void {
        this.value = value;
        this.checkbox?.update({ name: this.props.name, checked: value, onChange: (next) => { void this.controller.write(next); }, children: this.props.label });
    }

    public reset(): Promise<void> { return this.controller.reset(); }
}

interface BoardChoiceFieldProps extends BoardSettingFieldProps<string> {
    declaration: BoardSettingDeclaration;
    width: number;
}

export class BoardChoiceField extends VanillaView<BoardChoiceFieldProps> {
    private select: SelectView<IListBoxItem>;
    private value: string;
    private readonly controller: BoardSettingController<string>;

    public constructor(props: BoardChoiceFieldProps) {
        const select = new SelectView<IListBoxItem>({ items: [], value: null, onChange: () => {} });
        super(props, select.root);
        this.select = this.child(select);
        this.value = String(props.fallback);
        this.controller = new BoardSettingController(props, () => this.isDisposed, (value) => this.applyValue(value), (cleanup) => this.own(cleanup));
    }

    protected onMount(): void {
        this.select.update(this.selectProps());
        this.select.mount();
        this.controller.start();
    }

    protected onDispose(): void {}

    private applyValue(value: string): void {
        this.value = value;
        this.select.update(this.selectProps());
    }

    private selectProps() {
        const items = (this.props.declaration.options ?? [])
            .filter((option): option is string => typeof option === "string")
            .map((value) => ({ value, label: value }));
        const selectedValue = this.value ?? settingText(this.props.fallback);
        return {
            name: this.props.name,
            width: this.props.width,
            items,
            value: items.find((item) => item.value === selectedValue) ?? null,
            onChange: (item: IListBoxItem): void => { void this.controller.write(String(item.value)); },
        };
    }

    public reset(): Promise<void> { return this.controller.reset(); }
}

interface BoardStringFieldProps extends BoardSettingFieldProps<string> {
    width: number;
}

export class BoardStringField extends VanillaView<BoardStringFieldProps> {
    private input: InputView;
    private draft: string;
    private readonly controller: BoardSettingController<string>;

    public constructor(props: BoardStringFieldProps) {
        const input = new InputView({ type: "text", size: "sm", value: props.fallback, onChange: () => {} });
        super(props, input.root);
        this.input = this.child(input);
        this.draft = props.fallback;
        this.controller = new BoardSettingController(props, () => this.isDisposed, (value) => this.applyValue(value), (cleanup) => this.own(cleanup));
    }

    protected onMount(): void {
        this.input.update(this.inputProps());
        this.input.mount();
        this.controller.start();
    }

    protected onDispose(): void {}

    private applyValue(value: string): void {
        this.draft = value;
        this.input.update(this.inputProps());
    }

    private inputProps(): InputProps {
        return {
            name: this.props.name,
            type: "text",
            size: "sm",
            width: this.props.width,
            value: this.draft,
            onChange: (value) => { this.draft = value; void this.controller.write(value); },
        };
    }

    public reset(): Promise<void> { return this.controller.reset(); }
}

interface BoardMultiselectFieldProps extends BoardSettingFieldProps<string> {
    declaration: BoardSettingDeclaration;
    width: number;
}

export class BoardMultiselectField extends VanillaView<BoardMultiselectFieldProps> {
    private select: MultiSelectView<IListBoxItem>;
    private valueText: string;
    private readonly controller: BoardSettingController<string>;

    public constructor(props: BoardMultiselectFieldProps) {
        const select = new MultiSelectView<IListBoxItem>({ items: [], value: [], onChange: () => {} });
        super(props, select.root);
        this.select = this.child(select);
        this.valueText = props.fallback;
        this.controller = new BoardSettingController(props, () => this.isDisposed, (value) => this.applyValue(value), (cleanup) => this.own(cleanup));
    }

    protected onMount(): void {
        this.select.update(this.selectProps());
        this.select.mount();
        this.controller.start();
    }

    protected onDispose(): void {}

    private applyValue(value: string): void {
        this.valueText = value;
        this.select.update(this.selectProps());
    }

    private selectProps(): MultiSelectViewProps<IListBoxItem> {
        const options = (this.props.declaration.options ?? []).map((option) => typeof option === "string"
            ? { value: option, label: option }
            : { value: option.value, label: option.label ?? option.value });
        const knownValues = new Set(options.map((option) => option.value));
        const storedTokens = decodeMultiSelect(this.valueText);
        const unknownTokens = storedTokens.filter((token, index) =>
            !knownValues.has(token) && storedTokens.indexOf(token) === index);
        const items = [...options, ...unknownTokens.map((value) => ({ value, label: value }))];
        const selected = new Set(storedTokens);
        const value = items.filter((item) => selected.has(item.value));
        return {
            name: this.props.name,
            width: this.props.width,
            items,
            value,
            formatSelection: (selection) => selection.map((item) => item.value).join(", "),
            onChange: (selection) => {
                const selectedValues = new Set(selection.map((item) => item.value));
                const nextValues = [
                    ...options.filter((option) => selectedValues.has(option.value)).map((option) => option.value),
                    ...unknownTokens.filter((token) => selectedValues.has(token)),
                ];
                void this.controller.write(encodeMultiSelect(nextValues));
            },
        };
    }

    public reset(): Promise<void> { return this.controller.reset(); }
}

interface BoardMultilineFieldProps extends BoardSettingFieldProps<string> {}

export class BoardMultilineField extends VanillaView<BoardMultilineFieldProps> {
    private textarea: TextareaView;
    private draft: string;
    private readonly controller: BoardSettingController<string>;

    public constructor(props: BoardMultilineFieldProps) {
        const textarea = new TextareaView({ value: props.fallback, size: "sm", onChange: () => {} });
        super(props, textarea.root);
        this.textarea = this.child(textarea);
        this.draft = props.fallback;
        this.controller = new BoardSettingController(props, () => this.isDisposed, (value) => this.applyValue(value), (cleanup) => this.own(cleanup));
    }

    protected onMount(): void {
        this.textarea.update(this.textareaProps());
        this.textarea.mount();
        this.controller.start();
    }

    protected onDispose(): void {
        if (this.draft !== this.controller.persistedValue) { void this.controller.write(this.draft ?? ""); }
    }

    private applyValue(value: string): void {
        const nextValue = value;
        if (document.activeElement === this.textarea.root && this.draft !== nextValue) {
            this.controller.persistedValue = nextValue;
            return;
        }
        this.draft = nextValue;
        this.controller.persistedValue = nextValue;
        this.textarea.update(this.textareaProps());
    }

    private textareaProps(): TextareaProps {
        return {
            name: this.props.name,
            value: this.draft,
            size: "sm",
            onChange: (value: string) => { this.draft = value; },
            onBlur: () => {
                if (this.draft !== this.controller.persistedValue) void this.controller.write(this.draft ?? "");
            },
        };
    }

    public reset(): Promise<void> { return this.controller.reset(); }
}

function settingText(value: BoardSettingValue): string {
    return typeof value === "string" ? value : String(value);
}
