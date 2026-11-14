import type { VirtualElement } from "@floating-ui/dom";
import { MenuView } from "../../../uikit/Menu/MenuView";
import type { MenuProps } from "../../../uikit/Menu/MenuModel";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { overlayRegistry } from "../../../uikit/shared/overlayRegistry";
import type { DialogViewProps } from "../../../api/dialogs/dialog-view-registry";
import type { AppPopupMenuModel, AppPopupMenuState } from "../../../api/dialogs/showPopupMenu";

type AppPopupMenuPositionState = Pick<AppPopupMenuState, "items" | "x" | "y">;
const defaultOffset = [8, 0] as [number, number];

export class AppPopupMenuView extends VanillaView<DialogViewProps> {
    private readonly model: AppPopupMenuModel;
    private readonly menuView: MenuView;
    private readonly elementRef: VirtualElement;
    private registeredRef: HTMLDivElement | null = null;

    public constructor(props: DialogViewProps) {
        const model = props.model as AppPopupMenuModel;
        super(props, document.createElement("div"));
        this.root.style.display = "contents";
        this.model = model;
        this.elementRef = {
            getBoundingClientRect: () => {
                const { x, y } = model.state.get();
                return {
                    x,
                    y,
                    top: y,
                    left: x,
                    bottom: y,
                    right: x,
                    width: 0,
                    height: 0,
                };
            },
        };
        this.menuView = this.child(new MenuView(this.menuProps(model.state.get())));
    }

    protected onMount(): void {
        this.menuView.mount();
        this.bind(
            this.model.state,
            (state) => ({ items: state.items, x: state.x, y: state.y }),
            (state) => this.menuView.update(this.menuProps(state)),
        );
    }

    private menuProps(state: AppPopupMenuPositionState): MenuProps & {
        ref: (element: HTMLDivElement | null) => void;
    } {
        return {
            name: "app-popup-menu",
            open: true,
            items: state.items,
            elementRef: this.elementRef,
            offset: defaultOffset,
            onClose: () => { void this.model.close(); },
            ref: this.setMenuRef,
        };
    }

    // Callback ref: register the Popover's floated root with overlayRegistry so
    // page-level Tooltips are suppressed while the menu is open. Tooltips inside
    // this subtree (e.g. on menu items themselves) remain allowed via
    // overlayRegistry.isSuppressed's `contains()` check.
    private readonly setMenuRef = (el: HTMLDivElement | null): void => {
        if (this.registeredRef) {
            overlayRegistry.unregister(this.registeredRef);
        }
        this.registeredRef = el;
        if (el) overlayRegistry.register(el);
    };
}
