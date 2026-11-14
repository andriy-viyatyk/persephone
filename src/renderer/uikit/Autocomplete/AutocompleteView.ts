import { applyRestProps, clearRestListeners, createRestPropsState, setOrRemoveAttr, toggleAttr, splitProps, type CompleteKeys, RestPropsState } from "../shared/dom-props";

import { createComponentModelDriver, type ComponentModelDriver } from "../../core/state/model";
import { nextElementId } from "../shared/element-id";
import { fillSlot, type SlotContent } from "../shared/fill-slot";
import { VanillaView } from "../shared/vanilla-view";
import { InputView } from "../Input/InputView";
import { ListBoxView } from "../ListBox/ListBoxView";
import { PopoverView, type PopoverViewProps } from "../Popover/PopoverView";
import type { IListBoxItem, ListBoxProps } from "../ListBox/types";
import type { InputProps } from "../Input/InputView";
import {
    AutocompleteModel,
    defaultAutocompleteState,
    type AutocompleteProps,
    type AutocompleteOwnProps,
} from "./AutocompleteModel";
import "./Autocomplete.css";
// Borrowed: the header row composes a `[data-type="spacer"]` element directly rather than
// instantiating `SpacerView`, so nothing in this module's graph would pull the rule in.
import "../Spacer/Spacer.css";

export type AutocompleteViewProps = AutocompleteProps;

interface AutocompleteContentProps {
    header: SlotContent;
    headerAction: SlotContent;
    list: ListBoxProps<IListBoxItem>;
}

/**
 * The contents of the open dropdown: an optional header row above the suggestion `ListBox`.
 *
 * **This view adopts the popover's floating root as its own root** (`super(props, host)`), the shape
 * `MenuContentView` uses. It is here because `PopoverView.contentView` returns exactly *one*
 * `IOwnedView` while this dropdown has *two* children, and because both of them must stay direct
 * children of `.popover-shell` — a wrapper element would either become the popover's sole flex item
 * (moving the overflow and shrink semantics down a level) or, as `display: contents`, would stop the
 * header and the list being direct children at all.
 *
 * **Three writes this view must never make on `this.root`**, because `PopoverFloatingView`
 * reasserts them on every update and would silently win: `dataset.type` (it is `"popover"`), any
 * `className` assignment (it owns `popover-shell` and toggles `scroll-container`), and
 * `replaceChildren` (the resize handle is appended to this same root *after* the content mounts).
 * Tag children with `data-type` / `data-part` instead. Nothing here wants any of the three, which is
 * what makes the sharing safe — but the failure mode is an attribute quietly reverting one update
 * later, not an exception.
 *
 * The popover forwards no updates to a content view, so `AutocompleteView` pushes
 * `AutocompleteContentProps` here from its own single `syncChildren()`. `activeIndex` and the
 * filtered rows travel together inside `list`, so one push carries both and `ListBoxView` picks
 * `scrollToRowAfterPaint` correctly.
 */
class AutocompleteContentView extends VanillaView<AutocompleteContentProps> {
    private list: ListBoxView<IListBoxItem> | undefined;

    private headerRow: HTMLDivElement | undefined;
    private headerHost: HTMLSpanElement | undefined;
    private actionHost: HTMLSpanElement | undefined;
    private headerCleanup: (() => void) | undefined;
    private actionCleanup: (() => void) | undefined;

    public constructor(props: AutocompleteContentProps, host: HTMLElement) {
        super(props, host);
    }

    protected onMount(): void {
        this.list = this.child(new ListBoxView<IListBoxItem>(this.props.list));
        this.root.append(this.list.root);
        this.list.mount();

        // Registered once; the stored cleanup is reassigned per `fillSlot` call, and a superseded
        // cleanup is a no-op on its own.
        this.own(() => this.headerCleanup?.());
        this.own(() => this.actionCleanup?.());

        this.syncHeader(this.props.header, this.props.headerAction);
    }

    protected onUpdate(props: AutocompleteContentProps): void {
        this.sync(props);
    }

    private sync(props: AutocompleteContentProps): void {
        const list = this.list;
        if (!list) return;

        this.syncHeader(props.header, props.headerAction);
        list.update(props.list);
    }

    private syncHeader(header: SlotContent, headerAction: SlotContent): void {
        const present = header != null && header !== false;
        if (present) {
            // The row creates both slot hosts, so it must exist before they are read.
            const row = this.headerRow ?? this.createHeaderRow();
            const headerHost = this.headerHost;
            const actionHost = this.actionHost;
            if (!headerHost || !actionHost) return;

            if (!row.isConnected && this.list) this.root.insertBefore(row, this.list.root);
            this.headerCleanup = fillSlot(headerHost, header);
            this.actionCleanup = fillSlot(actionHost, headerAction);
        } else if (this.headerRow?.isConnected) {
            this.headerRow.remove();
        }
    }

    /**
     * The two slot hosts are `display: contents`, as
     * `fillSlot`'s slot host is, so the header content and the action stay flex items of
     * the row as direct children.
     */
    private createHeaderRow(): HTMLDivElement {
        const row = document.createElement("div");
        row.dataset.type = "autocomplete-header";

        this.headerHost = document.createElement("span");
        this.headerHost.style.display = "contents";

        const spacer = document.createElement("span");
        spacer.dataset.type = "spacer";

        this.actionHost = document.createElement("span");
        this.actionHost.style.display = "contents";

        row.append(this.headerHost, spacer, this.actionHost);
        this.headerRow = row;
        return row;
    }
}

const AUTOCOMPLETE_OWN_KEYS = ["name", "value", "onChange", "items", "filterMode", "filter", "openOnFocus", "onSubmit", "onEscape", "header", "headerAction", "emptyMessage", "placeholder", "disabled", "readOnly", "size", "autoFocus", "startSlot", "endSlot", "width", "minWidth", "maxWidth", "maxVisibleItems", "rowHeight"] as const satisfies readonly (keyof AutocompleteOwnProps)[];
const checkedOwnKeys: CompleteKeys<AutocompleteOwnProps, typeof AUTOCOMPLETE_OWN_KEYS> = AUTOCOMPLETE_OWN_KEYS;
const AUTOCOMPLETE_LEGACY_KEYS = [] as const satisfies readonly (keyof AutocompleteProps)[];



/**
 * The typeahead input: an `Input` whose `Popover` hosts a filtered `ListBox`.
 *
 * Three things here differ from `SelectView`, which is otherwise the reference implementation for
 * everything structural in this file:
 *
 * - **`data-state` and "the popover exists" are different facts.** The popover opens on
 *   `model.popoverOpen`, which is false for an open component whose filter matched nothing and that
 *   has no `emptyMessage`. `data-state` still reports `state.open`. Do not collapse them.
 * - **The width props go to the inner `Input`, not to the root.** Width/minWidth/maxWidth go to `Input` and no inline style is written on the root. Select does the opposite.
 * - **The `contentView` factory does not append anything**, because `AutocompleteContentView` adopts
 *   the host as its root. `SelectView`'s factory must append, because a `ListBoxView` builds its own
 *   detached root. Do not "fix" one to look like the other.
 *
 * `applyRoot` stays off the state path: `applyRestProps` removes and re-adds every `on*` listener per
 * call, and rest props cannot have changed on a state write.
 */
export class AutocompleteView extends VanillaView<AutocompleteViewProps> {
    private readonly driver: ComponentModelDriver<
        typeof defaultAutocompleteState,
        AutocompleteProps,
        AutocompleteModel
    >;

    private readonly restPropsState: RestPropsState = createRestPropsState();

    private input: InputView | undefined;
    private popover: PopoverView | undefined;

    /**
     * The dropdown contents, or undefined while closed. Owned by the floating branch — created by
     * the `contentView` factory and disposed with the branch, so this reference is bare.
     */
    private contentView: AutocompleteContentView | undefined;


    public constructor(props: AutocompleteViewProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "autocomplete";

        this.driver = createComponentModelDriver(
            this.modelProps(props),
            AutocompleteModel,
            defaultAutocompleteState,
        );
        this.model.setElementId(nextElementId("autocomplete"));

        this.own(() => this.driver.dispose());
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    /** The live model, for the story and for tests. */
    public get model(): AutocompleteModel {
        return this.driver.model;
    }

    protected onMount(): void {
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
            (state) => ({ open: state.open, activeIndex: state.activeIndex }),
            () => this.syncChildren(),
        );
    }

    protected onUpdate(props: AutocompleteViewProps): void {
        this.driver.update(this.modelProps(props));
        this.applyRoot(props);
        this.syncChildren();
    }

    // -----------------------------------------------------------------------
    // Root
    // -----------------------------------------------------------------------

    private applyRoot(props: AutocompleteViewProps): void {
        const root = this.root;
        setOrRemoveAttr(root, "data-name", props.name);
        root.setAttribute("data-id", this.model.autocompleteId);
        toggleAttr(root, "data-disabled", !!props.disabled);
        toggleAttr(root, "data-readonly", !!props.readOnly);

        // No inline size: the width trio is forwarded to the inner Input. `Autocomplete.css`'s `width: 100%` owns the root.
    }

    // -----------------------------------------------------------------------
    // Children
    // -----------------------------------------------------------------------

    /** The single consequence of both the prop pump and a state write. */
    private syncChildren(): void {
        const input = this.input;
        const popover = this.popover;
        if (!input || !popover) return;

        // `state.open`, not `popoverOpen` — see the class comment.
        this.root.dataset.state = this.model.state.get().open ? "open" : "closed";

        input.update(this.inputProps());
        this.syncPopover(popover);

        if (this.model.popoverOpen) {
            this.syncContent();
        } else {
            // The branch has just been torn down by the popover update above. The reference must not
            // survive into a re-open, and the factory reassigns it there.
            this.contentView = undefined;
        }
    }

    private syncPopover(popover: PopoverView): void {
        popover.setOpen(this.model.popoverOpen);
        popover.setAnchor(this.root);
        popover.setPlacement("bottom-start");
        popover.setOffset([0, 2]);
        popover.setSizing({ matchAnchorWidth: true, resizable: false, scroll: false });
    }

    private syncContent(): void {
        const content = this.contentView;
        if (!content) return;

        // The final ListBox operation carries the filtered rows and active index together for the
        // correct after-paint scroll path.
        content.update(this.contentProps());
    }

    private inputProps(): InputProps {
        const props = this.props;
        return {
            size: props.size ?? "md",
            value: props.value,
            onChange: this.model.onInputChange,
            placeholder: props.placeholder,
            disabled: props.disabled,
            readOnly: props.readOnly,
            autoFocus: props.autoFocus,
            onFocus: this.model.onInputFocus,
            onClick: this.model.onInputClick,
            startSlot: props.startSlot,
            endSlot: props.endSlot,
            width: props.width,
            minWidth: props.minWidth,
            maxWidth: props.maxWidth,
            "aria-haspopup": "listbox",
            "aria-expanded": this.model.state.get().open,
            "aria-autocomplete": "list",
            "aria-controls": this.model.listboxId,
            "aria-label": props["aria-label"],
            "aria-labelledby": props["aria-labelledby"],
        };
    }

    private popoverProps(): PopoverViewProps {
        return {
            open: this.model.popoverOpen,
            onClose: this.model.onPopoverClose,
            elementRef: this.root,
            placement: "bottom-start",
            offset: [0, 2],
            matchAnchorWidth: true,
            scroll: false,
            outsideClickIgnoreSelector:
                `[data-type="autocomplete"][data-id="${this.model.autocompleteId}"]`,
            contentView: (host) => {
                // No `host.append` here: the content view adopts the host as its root, which is how
                // its two children stay direct children of the popover.
                const content = new AutocompleteContentView(this.contentProps(), host);
                this.contentView = content;
                return content;
            },
        };
    }

    private contentProps(): AutocompleteContentProps {
        const props = this.props;
        return {
            header: props.header,
            headerAction: props.headerAction,
            list: this.listProps(),
        };
    }

    /**
     * `searchText` is deliberately absent: `Autocomplete` has never highlighted the matched
     * substring in a suggestion label, and adding it here would be a visual change.
     */
    private listProps(): ListBoxProps<IListBoxItem> {
        const props = this.props;
        const { filteredItems } = this.model.filtered;
        return {
            id: this.model.listboxId,
            items: filteredItems,
            activeIndex: this.model.state.get().activeIndex,
            onActiveChange: this.model.onActiveIndexChange,
            onChange: this.model.onListChange,
            rowHeight: this.model.rowHeight,
            growToHeight: this.model.maxVisibleItems * this.model.rowHeight,
            emptyMessage: props.emptyMessage,
            keyboardNav: false,
        };
    }

    // -----------------------------------------------------------------------
    // Owned input access
    // -----------------------------------------------------------------------

    public get inputElement(): HTMLInputElement | null {
        return this.input?.inputElement ?? null;
    }

    // -----------------------------------------------------------------------

    /** Native listener attached to the child Input's field after it mounts. */
    private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
        this.model.onInputKeyDown(event);
    };

    private modelProps(props: AutocompleteViewProps): AutocompleteProps {
        return props;
    }

    private restProps(props: AutocompleteViewProps): Record<string, unknown> {
        const rest = splitProps(props, [...checkedOwnKeys, ...AUTOCOMPLETE_LEGACY_KEYS] as const);
        return rest as Record<string, unknown>;
    }
}
