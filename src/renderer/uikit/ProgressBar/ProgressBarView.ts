import {
    applyRestProps,
    clearRestListeners,
    createRestPropsState,
    type NativeHTMLAttributes,
    type RestPropsState,
    cssLength,
    splitProps,
    type CompleteKeys,
} from "../shared/dom-props";
import { VanillaView } from "../shared/vanilla-view";
import { uikitText } from "../shared/uikit-text";
import "./ProgressBar.css";

type Variant = "default" | "success" | "warning" | "danger";

export interface ProgressBarOwnProps {
    name?: string;
    value?: number;
    max?: number;
    completed?: boolean;
    width?: number | string;
    height?: number;
    variant?: Variant;
    "aria-label"?: string;
}



export interface ProgressBarProps
    extends Omit<NativeHTMLAttributes<HTMLDivElement>, "style" | "className"> , ProgressBarOwnProps{
}

type ProgressState = "completed" | "determinate" | "indeterminate";

function clampPercent(value: number, max: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    const pct = (value / max) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
}

const PROGRESSBAR_OWN_KEYS = ["name", "value", "max", "completed", "width", "height", "variant", "aria-label"] as const satisfies readonly (keyof ProgressBarOwnProps)[];
const checkedOwnKeys: CompleteKeys<ProgressBarOwnProps, typeof PROGRESSBAR_OWN_KEYS> = PROGRESSBAR_OWN_KEYS;
const PROGRESSBAR_LEGACY_KEYS = ["children"] as const satisfies readonly (keyof ProgressBarProps)[];



export class ProgressBarView extends VanillaView<ProgressBarProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();
    private fill: HTMLDivElement | undefined;

    public constructor(props: ProgressBarProps) {
        super(props, document.createElement("div"));
    }

    protected onMount(): void {
        this.fill = document.createElement("div");
        this.fill.dataset.part = "fill";
        this.root.append(this.fill);
        this.applyProps(this.props);
        this.applyConstructionRestProps(this.props);
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    protected onUpdate(props: ProgressBarProps): void {
        this.applyProps(props);
    }

    protected onDispose(): void {
        clearRestListeners(this.root, this.restPropsState);
    }

    private applyProps(props: ProgressBarProps): void {
        const {
            name,
            value,
            max = 100,
            completed,
            width,
            height = 6,
            variant = "default",
            "aria-label": ariaLabel = uikitText("progress"),
            children: _children,
            ..._rest
        } = props;
        const state: ProgressState = completed ? "completed" : value != null ? "determinate" : "indeterminate";
        const percent = state === "completed" ? 100 : state === "determinate" ? clampPercent(value ?? 0, max) : 0;

        this.root.dataset.type = "progress-bar";
        if (name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = name;
        this.root.dataset.state = state;
        this.root.dataset.variant = variant;
        this.root.setAttribute("role", "progressbar");
        this.root.setAttribute("aria-label", ariaLabel);
        if (state === "indeterminate") {
            this.root.setAttribute("aria-busy", "true");
            this.root.setAttribute("aria-valuemin", "0");
            this.root.setAttribute("aria-valuemax", String(max));
            this.root.removeAttribute("aria-valuenow");
        } else {
            this.root.removeAttribute("aria-busy");
            this.root.setAttribute("aria-valuemin", "0");
            this.root.setAttribute("aria-valuemax", String(max));
            this.root.setAttribute("aria-valuenow", String(state === "completed" ? max : value));
        }
        this.root.style.setProperty("--progress-bar-width", width === undefined ? "100%" : cssLength(width));
        this.root.style.setProperty("--progress-bar-height", `${height}px`);
        if (!this.fill) return;
        if (state === "indeterminate") this.fill.style.removeProperty("--progress-bar-fill-width");
        else this.fill.style.setProperty("--progress-bar-fill-width", `${percent}%`);
    }

    private applyConstructionRestProps(props: ProgressBarProps): void {
        const rest = splitProps(props, [...checkedOwnKeys, ...PROGRESSBAR_LEGACY_KEYS] as const);
        // `ariaProps` precede residual props, so callers can override these attributes.
        applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);
    }
}
