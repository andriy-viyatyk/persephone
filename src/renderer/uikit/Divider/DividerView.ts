import {
    applyRestProps,
    clearRestListeners,
    createRestPropsState,
    type NativeHTMLAttributes,
    type RestPropsState,
    splitProps,
    type CompleteKeys,
} from "../shared/dom-props";
import { VanillaView } from "../shared/vanilla-view";
import "./Divider.css";

export interface DividerOwnProps {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances in DOM inspector output. Never used for styling. */
    name?: string;
    /** Line direction. Default: "horizontal". */
    orientation?: "horizontal" | "vertical";
}



export interface DividerProps extends NativeHTMLAttributes<HTMLDivElement> , DividerOwnProps{
}

const DIVIDER_OWN_KEYS = ["name", "orientation"] as const satisfies readonly (keyof DividerOwnProps)[];
const checkedOwnKeys: CompleteKeys<DividerOwnProps, typeof DIVIDER_OWN_KEYS> = DIVIDER_OWN_KEYS;
const DIVIDER_LEGACY_KEYS = [] as const satisfies readonly (keyof DividerProps)[];



export class DividerView extends VanillaView<DividerProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();

    public constructor(props: DividerProps) {
        super(props, document.createElement("div"));
    }

    protected onMount(): void {
        this.applyProps(this.props);
        this.applyConstructionRestProps(this.props);
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    protected onUpdate(props: DividerProps): void {
        this.applyProps(props);
    }

    protected onDispose(): void {
        clearRestListeners(this.root, this.restPropsState);
    }

    private applyProps(props: DividerProps): void {
        const { name, orientation = "horizontal", ..._rest } = props;
        this.root.dataset.type = "divider";
        if (name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = name;
        this.root.dataset.orientation = orientation;
        this.root.setAttribute("role", "separator");
        this.root.setAttribute("aria-orientation", orientation);
    }

    private applyConstructionRestProps(props: DividerProps): void {
        const rest = splitProps(props, [...checkedOwnKeys, ...DIVIDER_LEGACY_KEYS] as const);
        applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);
    }
}
