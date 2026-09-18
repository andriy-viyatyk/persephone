import { VanillaView } from "../shared/vanilla-view";
import "./Switch.css";

export interface SwitchProps {
    /** Optional debug label emitted as `data-name` on the control. */
    name?: string;
    /** Accessible name for the switch. */
    label: string;
    /** Checked state (controlled). */
    checked: boolean;
    /** Change handler — receives the new checked value. */
    onChange: (checked: boolean) => void;
    /** Disables interaction. */
    disabled?: boolean;
    /** Control size. */
    size?: "sm" | "md";
}

export class SwitchView extends VanillaView<SwitchProps> {
    private readonly thumb = document.createElement("span");

    public constructor(props: SwitchProps) {
        super(props, document.createElement("button"));
        this.thumb.dataset.part = "thumb";
    }

    protected onMount(): void {
        this.root.append(this.thumb);
        this.applyProps(this.props);
        this.listen(this.root, "click", this.handleClick);
    }

    protected onUpdate(props: SwitchProps): void {
        this.applyProps(props);
    }

    private applyProps(props: SwitchProps): void {
        const button = this.root as HTMLButtonElement;
        button.type = "button";
        button.disabled = Boolean(props.disabled);
        button.setAttribute("role", "switch");
        button.setAttribute("aria-label", props.label);
        button.setAttribute("aria-checked", String(props.checked));
        this.root.dataset.type = "switch";
        if (props.name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = props.name;
        this.root.dataset.checked = String(props.checked);
        this.root.dataset.size = props.size ?? "md";
        if (props.disabled) this.root.dataset.disabled = "";
        else delete this.root.dataset.disabled;
    }

    private readonly handleClick = (): void => {
        if (!this.props.disabled) this.props.onChange(!this.props.checked);
    };
}
