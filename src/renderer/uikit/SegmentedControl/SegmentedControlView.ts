import { isTraited, resolveTraited, TraitKey, TraitType, type Traited } from "../../core/traits/traits";
import { KeyedList } from "../shared/keyed-list";
import { applyRestProps, createRestPropsState, type RestPropsState } from "../shared/dom-props";
import { VanillaView } from "../shared/vanilla-view";
import { ButtonView, type ButtonViewProps } from "../Button/ButtonView";
import type { SlotContent } from "../shared/fill-slot";
import type { IconRef } from "../shared/slots";
import { nextActiveIndex } from "../shared/list-navigation";

export interface ISegment {
    value: string;
    label?: SlotContent;
    icon?: IconRef;
    title?: string;
    disabled?: boolean;
}

export interface SegmentedControlProps {
    name?: string;
    items: ISegment[] | Traited<unknown[]>;
    value: string;
    onChange: (value: string) => void;
    size?: "sm" | "md";
    background?: "default" | "light" | "dark";
    disabled?: boolean;
}

export type SegmentedControlViewProps = SegmentedControlProps;

export class SegmentedControlView extends VanillaView<SegmentedControlViewProps> {
    private readonly restPropsState: RestPropsState = createRestPropsState();
    private readonly views = new WeakMap<HTMLButtonElement, ButtonView>();
    private list: KeyedList<ISegment, string, HTMLButtonElement> | undefined;
    private segments: ISegment[] = [];

    public constructor(props: SegmentedControlViewProps) {
        super(props);
    }

    protected onMount(): void {
        this.applyRootProps(this.props);
        applyRestProps(this.root, {}, this.restPropsState);
        this.list = new KeyedList<ISegment, string, HTMLButtonElement>(this.root, {
            keyOf: (segment) => segment.value,
            create: (segment) => {
                const view = this.child(new ButtonView(this.buttonProps(segment, 0)));
                view.mount();
                this.views.set(view.root as HTMLButtonElement, view);
                return view.root as HTMLButtonElement;
            },
            update: (element, segment, index) => {
                this.views.get(element)?.update(this.buttonProps(segment, index));
            },
            remove: (element) => {
                this.views.get(element)?.dispose();
                this.views.delete(element);
            },
        });
        this.own(() => this.list?.dispose());
        this.updateSegments(this.resolveSegments(this.props.items));
    }

    protected onUpdate(props: SegmentedControlViewProps): void {
        this.applyRootProps(props);
        this.updateSegments(this.resolveSegments(props.items));
    }

    private resolveSegments(items: SegmentedControlProps["items"]): ISegment[] {
        return isTraited<unknown[]>(items) ? resolveTraited<ISegment>(items, SEGMENT_KEY) : items;
    }

    private updateSegments(segments: ISegment[]): void {
        this.segments = segments;
        this.list?.update(segments);
    }

    private applyRootProps(props: SegmentedControlViewProps): void {
        this.root.dataset.type = "segmented-control";
        if (props.name === undefined) delete this.root.dataset.name;
        else this.root.dataset.name = props.name;
        this.root.dataset.rovingHost = "";
        if (props.disabled) this.root.dataset.disabled = "";
        else delete this.root.dataset.disabled;
        this.root.setAttribute("role", "radiogroup");
    }

    private buttonProps(segment: ISegment, index: number): ButtonViewProps {
        const selected = segment.value === this.props.value;
        const disabled = Boolean(this.props.disabled || segment.disabled);
        return {
            variant: selected ? "primary" : "link",
            size: this.props.size ?? "md",
            background: this.props.background ?? "default",
            icon: segment.icon,
            title: segment.title,
            disabled,
            role: "radio",
            "aria-checked": selected,
            tabIndex: index === this.fallbackIndex() ? 0 : -1,
            onClick: () => this.props.onChange(segment.value),
            onKeyDown: (event) => this.handleKey(event, index),
            children: segment.label ?? segment.value,
        };
    }

    private fallbackIndex(): number {
        const selected = this.segments.findIndex((segment) =>
            segment.value === this.props.value && !segment.disabled,
        );
        return selected >= 0 ? selected : this.segments.findIndex((segment) => !segment.disabled);
    }

    private focusButton(index: number): void {
        const segment = this.segments[index];
        if (!segment) return;
        (this.list?.get(segment.value) as HTMLButtonElement | undefined)?.focus();
    }

    private moveFocus(currentIndex: number, direction: 1 | -1): void {
        const count = this.segments.length;
        const next = nextActiveIndex(direction === 1 ? "ArrowDown" : "ArrowUp", currentIndex, count, {
            wrap: true,
            page: 1,
            pageStart: "before-first",
            pageFallback: "none",
            isEnabled: (index) => !this.segments[index].disabled,
        });
        if (next === undefined) return;
        this.focusButton(next);
        this.props.onChange(this.segments[next].value);
    }

    private handleKey(event: KeyboardEvent, index: number): void {
        switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
                event.preventDefault();
                event.stopPropagation();
                this.moveFocus(index, 1);
                break;
            case "ArrowLeft":
            case "ArrowUp":
                event.preventDefault();
                event.stopPropagation();
                this.moveFocus(index, -1);
                break;
            case "Home": {
                event.preventDefault();
                event.stopPropagation();
                const first = nextActiveIndex("Home", index, this.segments.length, {
                    wrap: true,
                    page: 1,
                    pageStart: "before-first",
                    pageFallback: "none",
                    isEnabled: (segmentIndex) => !this.segments[segmentIndex].disabled,
                });
                if (first !== undefined) {
                    this.focusButton(first);
                    this.props.onChange(this.segments[first].value);
                }
                break;
            }
            case "End": {
                event.preventDefault();
                event.stopPropagation();
                const last = nextActiveIndex("End", index, this.segments.length, {
                    wrap: true,
                    page: 1,
                    pageStart: "before-first",
                    pageFallback: "none",
                    isEnabled: (segmentIndex) => !this.segments[segmentIndex].disabled,
                });
                if (last !== undefined) {
                    this.focusButton(last);
                    this.props.onChange(this.segments[last].value);
                }
                break;
            }
        }
    }
}

/** Trait key for non-ISegment item arrays. */
export const SEGMENT_KEY = new TraitKey<TraitType<ISegment>>("segmented-control-segment");
