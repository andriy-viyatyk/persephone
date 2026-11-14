import { applyRestProps, clearRestListeners, createRestPropsState, splitProps, type CompleteKeys, NativeHTMLAttributes, RestPropsState } from "../shared/dom-props";

import { createIconElement } from "../shared/slots";
import { VanillaView } from "../shared/vanilla-view";
import { uikitText } from "../shared/uikit-text";

export interface SpinnerOwnProps {
    name?: string;
    size?: number;
    color?: string;
}



export interface SpinnerProps
    extends Omit<NativeHTMLAttributes<HTMLSpanElement>, "style" | "className" | "color"> , SpinnerOwnProps{
}

const SPINNER_OWN_KEYS = ["name", "size", "color"] as const satisfies readonly (keyof SpinnerOwnProps)[];
const checkedOwnKeys: CompleteKeys<SpinnerOwnProps, typeof SPINNER_OWN_KEYS> = SPINNER_OWN_KEYS;
const SPINNER_LEGACY_KEYS = ["children"] as const satisfies readonly (keyof SpinnerProps)[];



export class SpinnerView extends VanillaView<SpinnerProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();

    public constructor(props: SpinnerProps) {
        super(props, document.createElement("span"));
    }

    protected onMount(): void {
        this.root.append(createIconElement("progress"));
        this.applyConstructionRestProps(this.props);
        this.applyProps(this.props);
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    protected onUpdate(props: SpinnerProps): void {
        this.applyProps(props);
    }

    protected onDispose(): void {
        clearRestListeners(this.root, this.restPropsState);
    }

    private applyProps(props: SpinnerProps): void {
        const { name, size = 32, color, children: _children, ..._rest } = props;
        this.root.dataset.type = "spinner";
        if (name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = name;
        this.root.setAttribute("role", "status");
        this.root.setAttribute("aria-live", "polite");
        this.root.setAttribute("aria-label", uikitText("loading"));
        this.root.style.setProperty("--spinner-size", `${size}px`);
        if (color) this.root.style.setProperty("--spinner-color", color);
        else this.root.style.removeProperty("--spinner-color");
    }

    private applyConstructionRestProps(props: SpinnerProps): void {
        const rest = splitProps(props, [...checkedOwnKeys, ...SPINNER_LEGACY_KEYS] as const);
        // Spinner historically forwards residual props first, then owned data/ARIA/style fields.
        applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);
    }
}
