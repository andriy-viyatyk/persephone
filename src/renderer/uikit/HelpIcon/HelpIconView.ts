import { attachTooltip, type TooltipAttachment } from "../Tooltip/attach-tooltip";
import { createIconElement } from "../shared/slots";
import { VanillaView } from "../shared/vanilla-view";
import "./HelpIcon.css";

export interface HelpIconProps { text: string; label: string; name?: string; }

// Deliberate help targets should respond quickly and appear above the nearby label.
const HELP_PLACEMENT = "top" as const;
const HELP_DELAY = 200;

let nextDescriptionId = 0;

export class HelpIconView extends VanillaView<HelpIconProps> {
    private readonly description = document.createElement("span");
    private tooltip: TooltipAttachment | undefined;
    public constructor(props: HelpIconProps) { super(props, document.createElement("button")); }
    protected onMount(): void {
        const button = this.root as HTMLButtonElement;
        button.type = "button";
        button.dataset.type = "help-icon";
        this.description.id = `help-icon-description-${++nextDescriptionId}`;
        this.description.dataset.part = "description";
        button.setAttribute("aria-describedby", this.description.id);
        button.append(createIconElement("question", { width: 12, height: 12 }), this.description);
        this.applyProps(this.props);
        this.tooltip = attachTooltip(button, { content: this.props.text, placement: HELP_PLACEMENT, delayShow: HELP_DELAY });
        this.own(() => this.tooltip?.dispose());
    }
    protected onUpdate(props: HelpIconProps): void {
        this.applyProps(props);
        this.tooltip?.update({ content: props.text, placement: HELP_PLACEMENT, delayShow: HELP_DELAY });
    }
    private applyProps(props: HelpIconProps): void {
        this.root.setAttribute("aria-label", props.label);
        this.root.setAttribute("aria-description", props.text);
        this.description.textContent = props.text;
        if (props.name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = props.name;
    }
}
