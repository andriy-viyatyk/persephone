import "./Slider.css";
import { applyRestProps, clearRestListeners, createRestPropsState, splitProps, type CompleteKeys, NativeInputHTMLAttributes, RestPropsState } from "../shared/dom-props";

import { VanillaView } from "../shared/vanilla-view";

export interface SliderOwnProps {
    name?: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    size?: "sm" | "md";
    disabled?: boolean;
    width?: number | string;
    showProgress?: boolean;
    orientation?: "horizontal" | "vertical";
}



export interface SliderProps
    extends Omit<
        NativeInputHTMLAttributes<HTMLInputElement>,
        "value" | "onChange" | "min" | "max" | "step" | "type" | "size" |
        "style" | "className"
    > , SliderOwnProps{
}

const ACTIVE_COLOR = "var(--color-border-active, currentColor)";
const DEFAULT_COLOR = "var(--color-border-default, currentColor)";

const SLIDER_OWN_KEYS = ["name", "value", "onChange", "min", "max", "step", "size", "disabled", "width", "showProgress", "orientation"] as const satisfies readonly (keyof SliderOwnProps)[];
const checkedOwnKeys: CompleteKeys<SliderOwnProps, typeof SLIDER_OWN_KEYS> = SLIDER_OWN_KEYS;
const SLIDER_LEGACY_KEYS = ["children"] as const satisfies readonly (keyof SliderProps)[];



export class SliderView extends VanillaView<SliderProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();

    public constructor(props: SliderProps) {
        super(props, document.createElement("input"));
    }

    protected onMount(): void {
        this.applyConstructionRestProps(this.props);
        this.applyProps(this.props);
        this.listen(this.root, "input", this.handleInput);
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    protected onUpdate(props: SliderProps): void { this.applyProps(props); }

    protected onDispose(): void { clearRestListeners(this.root, this.restPropsState); }

    private applyProps(props: SliderProps): void {
        const {
            name, value, onChange: _onChange, min, max, step = 1, size = "md",
            disabled, width, showProgress, orientation = "horizontal", children: _children, ..._rest
        } = props;
        const input = this.root as HTMLInputElement;
        input.type = "range";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        if (String(value) !== input.value) input.value = String(value);
        input.disabled = Boolean(disabled);

        this.root.dataset.type = "slider";
        if (name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = name;
        this.root.dataset.size = size;
        this.root.dataset.orientation = orientation;
        input.setAttribute("aria-orientation", orientation);
        if (props["aria-valuetext"] !== undefined) input.setAttribute("aria-valuetext", String(props["aria-valuetext"]));
        else input.removeAttribute("aria-valuetext");
        if (disabled) this.root.dataset.disabled = "";
        else delete this.root.dataset.disabled;
        if (showProgress) this.root.dataset.showProgress = "";
        else delete this.root.dataset.showProgress;

        if (width === undefined) this.root.style.removeProperty("--slider-width");
        else this.root.style.setProperty("--slider-width", typeof width === "number" ? `${width}px` : width);

        if (!showProgress) {
            this.root.style.removeProperty("--slider-track-bg");
        } else {
            const range = max - min;
            const pct = range > 0 ? ((value - min) / range) * 100 : 0;
            const clamped = Math.max(0, Math.min(100, pct));
            this.root.style.setProperty(
                "--slider-track-bg",
                `linear-gradient(to ${orientation === "vertical" ? "top" : "right"}, ${ACTIVE_COLOR} ${clamped}%, ${DEFAULT_COLOR} ${clamped}%)`,
            );
        }
    }

    private applyConstructionRestProps(props: SliderProps): void {
        const rest = splitProps(props, [...checkedOwnKeys, ...SLIDER_LEGACY_KEYS] as const);
        applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);
    }

    private readonly handleInput = (event: Event): void => {
        const input = event.currentTarget as HTMLInputElement;
        this.props.onChange(parseFloat(input.value));
    };
}
