import { TextareaView } from "../../../uikit/Textarea/TextareaView";
import type { TextareaProps } from "../../../uikit/Textarea/TextareaView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Textarea/Textarea.css";

export interface TextListFieldProps {
    store: SettingsStore<string[]>;
    id: string;
    ariaLabel: string;
}

export class TextListField extends VanillaView<TextListFieldProps> {
    private readonly textarea: TextareaView;
    private draft: string;
    private readGeneration = 0;

    public constructor(props: TextListFieldProps) {
        const textarea = new TextareaView({ value: "", size: "sm", onChange: () => {} });
        super(props, textarea.root);
        this.textarea = this.child(textarea);
        this.draft = "";
    }

    protected onMount(): void {
        this.textarea.update(this.textareaProps());
        this.textarea.mount();
        this.own(this.props.store.subscribe(this.props.id, (value) => this.applyValue(value)));
        void this.loadValue();
    }

    private textareaProps(): TextareaProps {
        return {
            "aria-label": this.props.ariaLabel,
            value: this.draft,
            singleLine: true,
            maxHeight: 200,
            size: "sm",
            onChange: (value) => { this.draft = value; },
            onBlur: () => { void this.commit(); },
        };
    }

    private applyValue(value: string[]): void {
        this.draft = value.join(", ");
        this.textarea.update(this.textareaProps());
    }

    private async loadValue(): Promise<void> {
        const generation = ++this.readGeneration;
        const result = this.props.store.get(this.props.id);
        if (result instanceof Promise) {
            const value = await result;
            if (!this.isDisposed && generation === this.readGeneration) this.applyValue(value);
        } else {
            this.applyValue(result);
        }
    }

    private async commit(): Promise<void> {
        const value = this.draft.split(",").map((item) => item.trim()).filter(Boolean);
        await this.props.store.set(this.props.id, value);
    }
}
