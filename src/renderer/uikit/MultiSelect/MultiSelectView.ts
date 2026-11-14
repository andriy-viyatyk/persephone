import { applyRestProps, clearRestListeners, createRestPropsState, cssLength, setOrRemoveAttr, toggleAttr, splitProps, type CompleteKeys, RestPropsState } from "../shared/dom-props";

import { createComponentModelDriver, type ComponentModelDriver } from "../../core/state/model";
import { nextElementId } from "../shared/element-id";
import { VanillaView } from "../shared/vanilla-view";
import { IconButtonView } from "../IconButton/IconButtonView";
import { InputView } from "../Input/InputView";
import { MultiListBoxView } from "../MultiListBox/MultiListBoxView";
import { PopoverView, type PopoverViewProps } from "../Popover/PopoverView";
import type { IListBoxItem } from "../ListBox/types";
import type { MultiListBoxProps } from "../MultiListBox/MultiListBoxView";
import type { IconButtonProps } from "../IconButton/IconButtonView";
import type { InputProps } from "../Input/InputView";
import { defaultMultiSelectState, MultiSelectModel, type MultiSelectProps, type MultiSelectOwnProps } from "./MultiSelectModel";
import "./MultiSelect.css";

export type MultiSelectViewProps<T = IListBoxItem> = MultiSelectProps<T>;

const MULTISELECT_OWN_KEYS = ["name", "items", "value", "onChange", "placeholder", "disabled", "readOnly", "size", "filterMode", "rowHeight", "maxVisibleItems", "selectAll", "selectAllLabel", "emptyMessage", "resizable", "matchAnchorWidth", "formatSelection", "width", "minWidth", "maxWidth"] as const satisfies readonly (keyof MultiSelectOwnProps)[];
const checkedOwnKeys: CompleteKeys<MultiSelectOwnProps, typeof MULTISELECT_OWN_KEYS> = MULTISELECT_OWN_KEYS;
const MULTISELECT_LEGACY_KEYS = [] as const satisfies readonly (keyof MultiSelectViewProps)[];



/**
 * The multi-select dropdown: a read-only `Input` with a chevron button, and a `Popover` hosting a
 * `MultiListBox`.
 *
 * This uses `SelectView`'s content view and native-event handling with a different list and no
 * in-trigger search. Its prop and accessibility behavior is:
 *
 * - **The trigger is `readOnly` unconditionally**, and it takes no `onChange`. There is no typing in
 *   a `MultiSelect` trigger; the search box lives inside the `MultiListBox`. `props.readOnly`
 *   therefore reaches only the root's `data-readonly` and the list.
 * - **`disabled` and `readOnly` are not equivalent here.** `MultiSelectModel.tryOpen` checks
 *   `disabled` only, so a read-only `MultiSelect` still opens (rows are inspectable, not
 *   toggleable), and the chevron is disabled on `disabled` alone. `Select` refuses both.
 * - **`matchAnchorWidth` is a real prop**, defaulted in the view. `Select` hardcodes it.
 * - **The list carries `id = model.popoverId`.** This makes the trigger's `aria-controls` reference
 *   resolve to the popover list.
 *
 * `applyRoot` stays off the state path: it runs `applyRestProps`, which removes and re-adds every
 * `on*` listener per call, and rest props cannot have changed on a state write. `data-state` is the
 * one state-derived root attribute and therefore lives in `syncChildren()`.
 */
export class MultiSelectView<T = IListBoxItem> extends VanillaView<MultiSelectViewProps<T>> {
    private readonly driver: ComponentModelDriver<
        typeof defaultMultiSelectState,
        MultiSelectProps<T>,
        MultiSelectModel<T>
    >;

    private readonly restPropsState: RestPropsState = createRestPropsState();

    private input: InputView | undefined;
    private chevron: IconButtonView | undefined;
    private popover: PopoverView | undefined;

    /**
     * The list inside the open dropdown, or undefined while closed. Owned by the floating branch —
     * created by the `contentView` factory on open and disposed with the branch on close.
     */
    private listView: MultiListBoxView<T> | undefined;


    public constructor(props: MultiSelectViewProps<T>) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "multiselect";

        this.driver = createComponentModelDriver(
            this.modelProps(props),
            MultiSelectModel as unknown as MultiSelectModel<T>,
            defaultMultiSelectState,
        );
        this.model.setElementId(nextElementId("multiselect"));

        // Registration order is load-bearing: disposal runs children first, then these FIFO, so both
        // composed views are already inert when the driver reports its unmount.
        this.own(() => this.driver.dispose());
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    /** The live model, for the story and for tests. */
    public get model(): MultiSelectModel<T> {
        return this.driver.model;
    }

    protected onMount(): void {
        // Built before the input, because its root is the input's `endSlot`.
        this.chevron = this.child(new IconButtonView(this.chevronProps()));
        this.chevron.mount();
        this.listen(this.chevron.root, "mousedown", this.handleChevronMouseDown);

        this.input = this.child(new InputView(this.inputProps()));
        this.root.append(this.input.root);
        this.input.mount();
        this.model.setInputRef(this.input.inputElement);
        this.listen(this.input.inputElement, "keydown", this.handleInputKeyDown);

        // `PopoverView`'s own root is `display: contents`; the floating branch lives in the overlay
        // layer, so this append contributes no box.
        this.popover = this.child(new PopoverView(this.popoverProps()));
        this.root.append(this.popover.root);
        this.popover.mount();

        this.applyRoot(this.props);
        applyRestProps(this.root, this.restProps(this.props), this.restPropsState);
        this.driver.mount();

        // Applies once immediately, which seeds the first sync; then fires on every state write.
        this.bind(
            this.model.state,
            (state) => ({ open: state.open, popoverResized: state.popoverResized }),
            () => this.syncChildren(),
        );
    }

    protected onUpdate(props: MultiSelectViewProps<T>): void {
        this.driver.update(this.modelProps(props));
        this.applyRoot(props);
        this.syncChildren();
    }

    // -----------------------------------------------------------------------
    // Root
    // -----------------------------------------------------------------------

    private applyRoot(props: MultiSelectViewProps<T>): void {
        const root = this.root;
        setOrRemoveAttr(root, "data-name", props.name);
        root.setAttribute("data-id", this.model.multiSelectId);
        toggleAttr(root, "data-disabled", !!props.disabled);
        toggleAttr(root, "data-readonly", !!props.readOnly);

        // When all three width values are undefined, leave the inline width empty, leaving `MultiSelect.css`'s
        // `width: 100%` in charge; an empty string reproduces that exactly.
        root.style.width = props.width === undefined ? "" : cssLength(props.width);
        root.style.minWidth = props.minWidth === undefined ? "" : cssLength(props.minWidth);
        root.style.maxWidth = props.maxWidth === undefined ? "" : cssLength(props.maxWidth);

    }

    // -----------------------------------------------------------------------
    // Children
    // -----------------------------------------------------------------------

    /** The single consequence of both the prop pump and a state write. */
    private syncChildren(): void {
        const input = this.input;
        const chevron = this.chevron;
        const popover = this.popover;
        if (!input || !chevron || !popover) return;

        const open = this.model.state.get().open;
        this.root.dataset.state = open ? "open" : "closed";

        chevron.update(this.chevronProps());
        input.update(this.inputProps());
        this.syncPopover(popover);

        if (open) {
            this.syncList();
        } else {
            // Hygiene rather than correctness: the branch has just been torn down by the popover
            // update above. The reference must not survive into a re-open, and the factory
            // reassigns it there.
            this.listView = undefined;
        }
    }

    private syncPopover(popover: PopoverView): void {
        const props = this.props;
        popover.setOpen(this.model.state.get().open);
        popover.setAnchor(this.root);
        popover.setPlacement("bottom-start");
        popover.setOffset([0, 2]);
        popover.setSizing({
            matchAnchorWidth: props.matchAnchorWidth ?? true,
            resizable: props.resizable,
            scroll: false,
        });
    }

    private syncList(): void {
        const list = this.listView;
        if (!list) return;

        const props = this.props;
        const { popoverResized } = this.model.state.get();
        list.setItems(props.items);
        list.setValue(props.value);
        list.setOnChange(props.onChange);
        list.setDisabled(props.disabled);
        list.setReadOnly(props.readOnly);
        list.setSearchSettings(true, props.filterMode, undefined);
        list.setSelectAll(props.selectAll, props.selectAllLabel);
        list.setEmptyMessage(props.emptyMessage);
        list.setLayout({
            rowHeight: props.rowHeight,
            maxVisibleItems: popoverResized ? 999 : props.maxVisibleItems,
            height: popoverResized ? "100%" : undefined,
        });
    }

    private inputProps(): InputProps {
        const props = this.props;
        return {
            size: props.size ?? "md",
            value: this.model.displayText,
            placeholder: props.placeholder,
            disabled: props.disabled,
            // Always read-only: the trigger displays a formatted selection and is never typed into.
            readOnly: true,
            onFocus: this.model.onInputFocus,
            onClick: this.model.onInputClick,
            "aria-haspopup": "listbox",
            "aria-expanded": this.model.state.get().open,
            "aria-controls": this.model.popoverId,
            "aria-label": props["aria-label"],
            "aria-labelledby": props["aria-labelledby"],
            endSlot: this.chevron.root,
        };
    }

    /**
     * The icon is an `IconName` string, which takes `IconButtonView.updateIcon`'s DOM branch —
     * `createIconElement`.
     */
    private chevronProps(): IconButtonProps {
        const props = this.props;
        return {
            icon: this.model.state.get().open ? "chevron-up" : "chevron-down",
            size: "sm",
            tabIndex: -1,
            // `disabled` only — see the class comment.
            disabled: props.disabled,
            onClick: this.model.onChevronClick,
        };
    }

    /**
     * Exactly the props `PopoverView` names — never this component's rest props, which would land on
     * the floating root and be reinstalled on every update.
     */
    private popoverProps(): PopoverViewProps {
        const props = this.props;
        return {
            name: "multiselect-popover",
            open: this.model.state.get().open,
            onClose: this.model.onPopoverClose,
            elementRef: this.root,
            placement: "bottom-start",
            offset: [0, 2],
            matchAnchorWidth: props.matchAnchorWidth ?? true,
            resizable: props.resizable,
            onResize: this.model.onPopoverResize,
            scroll: false,
            outsideClickIgnoreSelector:
                `[data-type="multiselect"][data-id="${this.model.multiSelectId}"]`,
            contentView: (host) => {
                // `PopoverFloatingView.onMount` never appends what the factory returns — it only
                // claims and mounts it. Omit this append and the dropdown renders empty.
                const list = new MultiListBoxView<T>(this.listProps());
                host.append(list.root);
                this.listView = list;
                return list;
            },
        };
    }

    private listProps(): MultiListBoxProps<T> {
        const props = this.props;
        const { popoverResized } = this.model.state.get();
        return {
            // The element `aria-controls` points at. See the class comment and.
            id: this.model.popoverId,
            items: props.items,
            value: props.value,
            onChange: props.onChange,
            disabled: props.disabled,
            readOnly: props.readOnly,
            filterMode: props.filterMode,
            rowHeight: props.rowHeight,
            // Once the user has resized the dropdown, the row cap stops governing its height.
            maxVisibleItems: popoverResized ? 999 : props.maxVisibleItems,
            selectAll: props.selectAll,
            selectAllLabel: props.selectAllLabel,
            emptyMessage: props.emptyMessage,
            height: popoverResized ? "100%" : undefined,
        };
    }

    // -----------------------------------------------------------------------
    // Owned input access
    // -----------------------------------------------------------------------

    /**
     * One identity for this view's whole life, so `InputView` binds it exactly once. A per-update
     * merged closure — the literal translation of the previous stable callback — would make
     * `InputView.updateRef`'s identity gate fire on every update, and its `clearRef` calls
     * `ref(null)`, so `model.inputRef` would go transiently null each time.
     */
    /**
     * The caller's ref needs the opposite cadence: re-bound whenever its identity moves, so the
     * previous ref is released before the next one receives the element.
     */
    public get inputElement(): HTMLInputElement | null {
        return this.input?.inputElement ?? null;
    }

    // -----------------------------------------------------------------------
    // Native event unwrapping
    // -----------------------------------------------------------------------

    /** Native listeners attached to the child Input and chevron roots after they mount. */

    private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
        this.model.onInputKeyDown(event);
    };

    private readonly handleChevronMouseDown = (event: MouseEvent): void => {
        this.model.onChevronMouseDown(event);
    };

    // -----------------------------------------------------------------------

    private modelProps(props: MultiSelectViewProps<T>): MultiSelectProps<T> {
        return props;
    }

    private restProps(props: MultiSelectViewProps<T>): Record<string, unknown> {
        const rest = splitProps(props, [...checkedOwnKeys, ...MULTISELECT_LEGACY_KEYS] as const);
        return rest as Record<string, unknown>;
    }
}
