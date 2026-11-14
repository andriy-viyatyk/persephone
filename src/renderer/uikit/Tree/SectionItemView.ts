import { applyRestProps, clearRestListeners, createRestPropsState, splitProps, type CompleteKeys, RestPropsState } from "../shared/dom-props";
import { fillSlot } from "../shared/fill-slot";
import { VanillaView } from "../shared/vanilla-view";
import { TreeIndents } from "./tree-indents";
import type { SectionItemProps, SectionItemOwnProps } from "./SectionItem";
import "./SectionItem.css";

const defaultIndentSize = 16;
const TREE_OWN_KEYS = ["name", "id", "level", "label", "indentSize"] as const satisfies readonly (keyof SectionItemOwnProps)[];
const checkedOwnKeys: CompleteKeys<SectionItemOwnProps, typeof TREE_OWN_KEYS> = TREE_OWN_KEYS;
const TREE_LEGACY_KEYS = [] as const satisfies readonly (keyof SectionItemProps)[];



/**
 * A non-interactive section header row in a tree.
 *
 * Deliberately **not** shared with `ListBox`'s `SectionItemView`, which writes `root.textContent`:
 * Tree's section `label` is slot content, so a rich label has to go through a slot, and the
 * ListBox implementation would silently stringify or drop it. It also renders level guides, which
 * the flat list has no concept of.
 *
 * The label host is `display: contents`, so it is not a layout box and the label's content remains a
 * direct flex item of the row. It exists because `fillSlot` needs
 * a host it owns outright.
 *
 * The guides carry no `.tree-indent` class here — section rows are never selected, so the
 * selected-state border override has nothing to target. That matches the earlier `SectionItem`, which
 * omitted the class too.
 */
export class SectionItemView extends VanillaView<SectionItemProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();

    private labelHost: HTMLSpanElement | undefined;
    private labelCleanup: (() => void) | undefined;
    private indents: TreeIndents | undefined;


    public constructor(props: SectionItemProps) {
        super(props, document.createElement("div"));
    }

    protected onMount(): void {
        this.labelHost = document.createElement("span");
        this.labelHost.dataset.part = "label";
        this.labelHost.style.display = "contents";
        this.root.append(this.labelHost);

        this.indents = new TreeIndents(this.root, this.labelHost);

        this.applyProps(this.props);
        this.applyConstructionRestProps(this.props);

        this.own(() => this.labelCleanup?.());
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    protected onUpdate(props: SectionItemProps): void {
        this.applyProps(props);
    }

    private applyProps(props: SectionItemProps): void {
        const {
            name,
            id,
            level,
            label,
            indentSize = defaultIndentSize,
        } = props;

        const labelHost = this.labelHost;
        const indents = this.indents;
        if (!labelHost || !indents) return;

        const root = this.root;
        root.dataset.type = "tree-section";
        if (name === undefined) root.removeAttribute("data-name");
        else root.dataset.name = name;
        if (id === undefined) root.removeAttribute("id");
        else root.id = id;
        root.setAttribute("role", "presentation");

        indents.sync(level, indentSize);
        this.labelCleanup = fillSlot(labelHost, label);

    }

    private applyConstructionRestProps(props: SectionItemProps): void {
        const rest = splitProps(props, [...checkedOwnKeys, ...TREE_LEGACY_KEYS] as const);
        applyRestProps(this.root, rest as Record<string, unknown>, this.restPropsState);
    }

}
