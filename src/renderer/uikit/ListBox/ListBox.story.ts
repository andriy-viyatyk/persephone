import { createPanelElement } from "../Panel/panel-style";
import { VanillaView } from "../shared/vanilla-view";
import { ListBoxView } from "./ListBoxView";
import type { IListBoxItem, ListBoxProps } from "./types";
import { ContextMenuEvent } from "../../api/events/events";
import type { MenuItem } from "../Menu";
import type { Story } from "../../editors/storybook/storyTypes";

const MAX_REGULAR_ITEMS = 10000;
const REGULAR_ITEMS: IListBoxItem[] = Array.from({ length: MAX_REGULAR_ITEMS }, (_, i) => ({
    value: i,
    label: `Suggestion ${i} — apple banana cherry`,
    icon: "globe",
}));

const SECTIONED_ITEMS: IListBoxItem[] = (() => {
    const out: IListBoxItem[] = [];
    for (let group = 0; group < 4; group++) {
        out.push({ value: `section-${group}`, label: `Group ${group + 1}`, section: true });
        for (let i = 0; i < 10; i++) {
            out.push({ value: `g${group}-i${i}`, label: `Item ${group + 1}.${i + 1} — orange grape`, icon: "globe" });
        }
    }
    return out;
})();

interface DemoProps {
    rowCount?: number;
    searchText?: string;
    keyboardNav?: boolean;
    loading?: boolean;
    tooltip?: boolean;
    contextMenu?: boolean;
    predicateSelection?: boolean;
    sections?: boolean;
    variant?: "select" | "browse";
    selectionStyle?: "check" | "accent" | "focus";
}

class ListBoxDemoView extends VanillaView<DemoProps> {
    private value: IListBoxItem | null = null;
    private active = 0;
    private items: IListBoxItem[] = [];
    private itemsKey = "";
    private list: ListBoxView<IListBoxItem> | undefined;

    public constructor(props: DemoProps) {
        super(props, createPanelElement({ direction: "column", width: 360, height: 300 }));
    }

    protected onMount(): void {
        this.syncItems(this.props);
        const list = this.child(new ListBoxView(this.listProps(this.props)));
        this.list = list;
        this.root.append(list.root);
        list.mount();
    }

    protected onUpdate(props: DemoProps): void {
        this.syncItems(props);
        this.list?.update(this.listProps(props));
    }

    private readonly onChange = (item: IListBoxItem): void => {
        this.value = item;
        this.list?.update(this.listProps(this.props));
    };

    private readonly onActiveChange = (index: number): void => {
        this.active = index;
        this.list?.update(this.listProps(this.props));
    };

    private syncItems(props: DemoProps): void {
        const key = `${props.sections ?? false}:${props.rowCount ?? 60}`;
        if (key === this.itemsKey) return;
        this.itemsKey = key;
        if (props.sections) {
            this.items = SECTIONED_ITEMS;
            return;
        }
        const count = Math.max(0, Math.min(props.rowCount ?? 60, MAX_REGULAR_ITEMS));
        this.items = REGULAR_ITEMS.slice(0, count);
    }

    private listProps(props: DemoProps): ListBoxProps<IListBoxItem> {
        return {
            items: this.items,
            value: props.predicateSelection ? null : this.value,
            onChange: this.onChange,
            isSelected: props.predicateSelection ? this.isPredicateSelected : undefined,
            activeIndex: this.active,
            onActiveChange: this.onActiveChange,
            searchText: props.searchText,
            keyboardNav: props.keyboardNav,
            loading: props.loading,
            emptyMessage: "no rows",
            getTooltip: props.tooltip ? this.getTooltip : undefined,
            getContextMenu: props.contextMenu ? this.getContextMenu : undefined,
            onContextMenu: props.contextMenu ? this.onContextMenu : undefined,
            variant: props.variant,
            selectionStyle: props.selectionStyle,
        };
    }

    private readonly isPredicateSelected = (item: IListBoxItem): boolean =>
        typeof item.value === "number" && item.value % 5 === 0;

    private readonly getTooltip = (item: IListBoxItem): string | null =>
        typeof item.label === "string" ? `Tooltip: ${item.label}` : null;

    private readonly getContextMenu = (item: IListBoxItem): MenuItem[] => [
        { label: typeof item.label === "string" ? `Copy "${item.label}"` : "Copy", icon: "copy", onClick: () => undefined },
        { label: "Remove", icon: "remove", onClick: () => undefined },
    ];

    private readonly onContextMenu = (event: MouseEvent): void => {
        const context = ContextMenuEvent.fromNativeEvent(event, "generic");
        context.items.push({ label: "List background action", onClick: () => undefined });
    };

    protected onDispose(): void {
        this.list = undefined;
    }
}

export const listBoxStory: Story<DemoProps> = {
    id: "list-box",
    name: "ListBox",
    section: "Lists",
    view: ListBoxDemoView,
    props: [
        { name: "rowCount", type: "number", default: 60, min: 0, max: 10000, step: 100 },
        { name: "searchText", type: "string", default: "apple" },
        { name: "keyboardNav", type: "boolean", default: true },
        { name: "loading", type: "boolean", default: false },
        { name: "tooltip", type: "boolean", default: false },
        { name: "contextMenu", type: "boolean", default: false },
        { name: "predicateSelection", type: "boolean", default: false },
        { name: "sections", type: "boolean", default: false },
        { name: "variant", type: "enum", options: ["select", "browse"], default: "select" },
        { name: "selectionStyle", type: "enum", options: ["check", "accent", "focus"], default: "check" },
    ],
};
