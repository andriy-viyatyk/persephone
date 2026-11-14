import { isTraited, resolveTraited } from "../../core/traits/traits";
import { gap as gapTokens } from "../tokens";
import { fillSlot } from "../shared/fill-slot";
import { KeyedList } from "../shared/keyed-list";
import { createIconElement, createIconPlaceholderElement, isIconName } from "../shared/slots";
import { VanillaView } from "../shared/vanilla-view";
import type { IRadio, RadioGroupProps } from "./RadioGroup";
import { RADIO_KEY } from "./RadioGroup";
import { nextActiveIndex } from "../shared/list-navigation";

interface RadioItemState {
    item: IRadio;
    stateIcon: SVGElement;
    stateIconName: "radio-checked" | "radio-unchecked";
    labelText: Text;
    itemIconHost?: HTMLSpanElement;
    itemIconCleanup?: () => void;
    clickRelease: () => void;
    keydownRelease: () => void;
}

export class RadioGroupView extends VanillaView<RadioGroupProps> {
    private list: KeyedList<IRadio, string, HTMLButtonElement> | undefined;
    private radios: IRadio[] = [];
    private readonly itemStates = new WeakMap<HTMLButtonElement, RadioItemState>();

    public constructor(props: RadioGroupProps) {
        super(props, document.createElement("div"));
    }

    protected onMount(): void {
        this.list = new KeyedList<IRadio, string, HTMLButtonElement>(this.root, {
            keyOf: (radio) => radio.value,
            create: (radio) => this.createItem(radio),
            update: (element, radio) => this.updateItem(element, radio),
            remove: (element) => this.removeItem(element),
        });
        this.own(() => this.list?.dispose());
        this.applyRootProps(this.props);
        this.updateItems(this.resolveItems(this.props.items));
    }

    protected onUpdate(props: RadioGroupProps): void {
        this.applyRootProps(props);
        this.updateItems(this.resolveItems(props.items));
    }

    private resolveItems(items: RadioGroupProps["items"]): IRadio[] {
        return isTraited<unknown[]>(items) ? resolveTraited<IRadio>(items, RADIO_KEY) : items;
    }

    private updateItems(radios: IRadio[]): void {
        this.radios = radios;
        this.list?.update(radios);
    }

    private applyRootProps(props: RadioGroupProps): void {
        const orientation = props.orientation ?? "vertical";
        const gap = props.gap ?? "sm";
        this.root.dataset.type = "radio-group";
        if (props.name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = props.name;
        this.root.dataset.orientation = orientation;
        this.root.dataset.rovingHost = "";
        if (props.disabled) {
            this.root.dataset.disabled = "";
            this.root.setAttribute("aria-disabled", "true");
        } else {
            delete this.root.dataset.disabled;
            this.root.removeAttribute("aria-disabled");
        }
        this.root.setAttribute("role", "radiogroup");
        this.root.setAttribute("aria-orientation", orientation);
        this.setOptionalAttribute("aria-label", props["aria-label"]);
        this.setOptionalAttribute("aria-labelledby", props["aria-labelledby"]);
        this.root.style.setProperty("--radio-group-gap", `${gapTokens[gap]}px`);
        if (orientation === "horizontal" && props.wrap) this.root.style.flexWrap = "wrap";
        else this.root.style.removeProperty("flex-wrap");
    }

    private createItem(radio: IRadio): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        const stateIcon = createIconElement("radio-unchecked", { className: "radio-icon" });
        const labelText = document.createTextNode("");
        const state: RadioItemState = {
            item: radio,
            stateIcon,
            stateIconName: "radio-unchecked",
            labelText,
            clickRelease: () => undefined,
            keydownRelease: () => undefined,
        };
        this.itemStates.set(button, state);
        button.append(stateIcon, labelText);
        state.clickRelease = this.listen(button, "click", this.handleItemClick);
        state.keydownRelease = this.listen(button, "keydown", this.handleItemKeyDown);
        return button;
    }

    private updateItem(button: HTMLButtonElement, radio: IRadio): void {
        const state = this.itemStates.get(button);
        if (!state) return;
        state.item = radio;
        const selected = radio.value === this.props.value;
        const itemDisabled = Boolean(this.props.disabled || radio.disabled);
        const nextIconName = selected ? "radio-checked" : "radio-unchecked";
        if (state.stateIconName !== nextIconName) {
            const nextIcon = createIconElement(nextIconName, { className: "radio-icon" });
            button.replaceChild(nextIcon, state.stateIcon);
            state.stateIcon = nextIcon;
            state.stateIconName = nextIconName;
        }
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(selected));
        if (itemDisabled) button.setAttribute("aria-disabled", "true");
        else button.removeAttribute("aria-disabled");
        button.dataset.type = "radio";
        button.dataset.checked = String(selected);
        if (itemDisabled) button.dataset.disabled = "";
        else delete button.dataset.disabled;
        button.disabled = itemDisabled;
        button.tabIndex = this.fallbackIndex() === this.radios.indexOf(radio) ? 0 : -1;
        state.labelText.nodeValue = radio.label ?? radio.value;
        this.updateItemIcon(button, state, radio.icon);
    }

    private updateItemIcon(button: HTMLButtonElement, state: RadioItemState, icon: IRadio["icon"]): void {
        if (icon == null) {
            state.itemIconCleanup?.();
            state.itemIconCleanup = undefined;
            state.itemIconHost?.remove();
            state.itemIconHost = undefined;
            return;
        }
        if (!state.itemIconHost) {
            state.itemIconHost = document.createElement("span");
            state.itemIconHost.className = "item-icon";
            button.insertBefore(state.itemIconHost, state.labelText);
        }
        const content = typeof icon === "string"
            ? (isIconName(icon) ? createIconElement(icon) : createIconPlaceholderElement())
            : icon;
        state.itemIconCleanup = fillSlot(state.itemIconHost, content);
    }

    private removeItem(button: HTMLButtonElement): void {
        const state = this.itemStates.get(button);
        if (!state) return;
        state.itemIconCleanup?.();
        state.itemIconHost?.remove();
        state.clickRelease();
        state.keydownRelease();
        this.itemStates.delete(button);
    }

    private fallbackIndex(): number {
        const selected = this.radios.findIndex((radio) =>
            radio.value === this.props.value && !radio.disabled,
        );
        return selected >= 0 ? selected : this.radios.findIndex((radio) => !radio.disabled);
    }

    private focusItem(index: number): void {
        const radio = this.radios[index];
        if (radio) this.list?.get(radio.value)?.focus();
    }

    private moveFocus(currentIndex: number, direction: 1 | -1): void {
        const count = this.radios.length;
        const next = nextActiveIndex(direction === 1 ? "ArrowDown" : "ArrowUp", currentIndex, count, {
            wrap: true,
            page: 1,
            pageStart: "before-first",
            pageFallback: "none",
            isEnabled: (index) => !this.radios[index].disabled,
        });
        if (next === undefined) return;
        this.focusItem(next);
        this.props.onChange(this.radios[next].value);
    }

    private readonly handleItemClick = (event: Event): void => {
        const button = event.currentTarget as HTMLButtonElement;
        const state = this.itemStates.get(button);
        if (!state || this.props.disabled || state.item.disabled) return;
        this.props.onChange(state.item.value);
    };

    private readonly handleItemKeyDown = (event: KeyboardEvent): void => {
        const button = event.currentTarget as HTMLButtonElement;
        const state = this.itemStates.get(button);
        if (!state || this.props.disabled || state.item.disabled) return;
        const index = this.radios.findIndex((radio) => radio.value === state.item.value);
        if (index < 0) return;
        switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
                event.preventDefault(); event.stopPropagation(); this.moveFocus(index, 1); break;
            case "ArrowLeft":
            case "ArrowUp":
                event.preventDefault(); event.stopPropagation(); this.moveFocus(index, -1); break;
            case "Home": {
                event.preventDefault(); event.stopPropagation();
                const first = nextActiveIndex("Home", index, this.radios.length, {
                    wrap: true,
                    page: 1,
                    pageStart: "before-first",
                    pageFallback: "none",
                    isEnabled: (radioIndex) => !this.radios[radioIndex].disabled,
                });
                if (first !== undefined) { this.focusItem(first); this.props.onChange(this.radios[first].value); }
                break;
            }
            case "End": {
                event.preventDefault(); event.stopPropagation();
                const last = nextActiveIndex("End", index, this.radios.length, {
                    wrap: true,
                    page: 1,
                    pageStart: "before-first",
                    pageFallback: "none",
                    isEnabled: (radioIndex) => !this.radios[radioIndex].disabled,
                });
                if (last !== undefined) { this.focusItem(last); this.props.onChange(this.radios[last].value); }
                break;
            }
            case " ":
            case "Enter":
                event.preventDefault(); event.stopPropagation(); this.props.onChange(state.item.value); break;
        }
    };

    private setOptionalAttribute(name: string, value: string | undefined): void {
        if (value === undefined) this.root.removeAttribute(name);
        else this.root.setAttribute(name, value);
    }
}
