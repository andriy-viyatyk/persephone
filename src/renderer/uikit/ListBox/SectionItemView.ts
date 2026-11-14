import { applyRestProps, clearRestListeners, createRestPropsState, splitProps, type CompleteKeys, RestPropsState } from "../shared/dom-props";
import { VanillaView } from "../shared/vanilla-view";
import type { SectionItemProps, SectionItemOwnProps } from "./SectionItem";
import "./SectionItem.css";

const LISTBOX_OWN_KEYS = ["name", "id", "label"] as const satisfies readonly (keyof SectionItemOwnProps)[];
const checkedOwnKeys: CompleteKeys<SectionItemOwnProps, typeof LISTBOX_OWN_KEYS> = LISTBOX_OWN_KEYS;
const LISTBOX_LEGACY_KEYS = [] as const satisfies readonly (keyof SectionItemProps)[];



/**
 * A non-interactive section header row. Pure DOM: its label is a `string`, so there is no slot, no
 * DOM subtree and no tooltip.
 */
export class SectionItemView extends VanillaView<SectionItemProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();

    public constructor(props: SectionItemProps) {
        super(props, document.createElement("div"));
    }

    protected onMount(): void {
        this.applyProps(this.props);
        this.applyConstructionRestProps(this.props);
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    protected onUpdate(props: SectionItemProps): void {
        this.applyProps(props);
    }

    private applyProps(props: SectionItemProps): void {
        const { name, id, label, ..._rest } = props;

        const root = this.root;
        root.dataset.type = "list-section";
        if (name === undefined) root.removeAttribute("data-name");
        else root.dataset.name = name;
        if (id === undefined) root.removeAttribute("id");
        else root.id = id;
        root.setAttribute("role", "presentation");
        root.textContent = label;

    }

    private applyConstructionRestProps(props: SectionItemProps): void {
        const rest = splitProps(props, [...checkedOwnKeys, ...LISTBOX_LEGACY_KEYS] as const);
        applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);
    }

}
