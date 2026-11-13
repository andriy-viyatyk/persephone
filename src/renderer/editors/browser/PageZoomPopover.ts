import { PAGE_ZOOM_MIN, PAGE_ZOOM_MAX, PAGE_ZOOM_STEP, clampPageZoom } from "../../../shared/browser-zoom";
import { t } from "../../../shared/i18n/t";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { SliderView } from "../../uikit/Slider/SliderView";

export interface BrowserZoomContentProps {
    value: number;
    onChange: (value: number) => void;
}

// Page-zoom popover geometry: the presets sit beside the slider at their own values, like a scale.
const PAGE_ZOOM_SLIDER_HEIGHT = 200; // px; tall enough that the 75% and 50% presets do not overlap
const PAGE_ZOOM_THUMB_SIZE = 12; // px; matches the uikit slider thumb
const PAGE_ZOOM_PRESETS = [200, 150, 100, 75, 50];

/** Distance from the slider top to the thumb centre for a value (vertical slider, max at top). */
function pageZoomOffset(value: number): number {
    const travel = PAGE_ZOOM_SLIDER_HEIGHT - PAGE_ZOOM_THUMB_SIZE;
    return PAGE_ZOOM_THUMB_SIZE / 2 + (PAGE_ZOOM_MAX - value) / (PAGE_ZOOM_MAX - PAGE_ZOOM_MIN) * travel;
}

/** Adopts the popover shell: do not assign its data-type, className, or replace its children. */
export class BrowserZoomContentView extends VanillaView<BrowserZoomContentProps> {
    private readonly slider: SliderView;
    private readonly presets: ButtonView[];

    public constructor(props: BrowserZoomContentProps, host: HTMLElement) {
        super(props, host);
        const controls = document.createElement("div");
        controls.dataset.type = "browser-zoom-controls";
        this.slider = this.child(new SliderView(this.sliderProps(props)));
        const buttons = document.createElement("div");
        buttons.dataset.part = "presets";
        buttons.style.height = `${PAGE_ZOOM_SLIDER_HEIGHT}px`;
        this.presets = PAGE_ZOOM_PRESETS.map((value) => {
            const button = this.child(new ButtonView({ name: `zoom-preset-${value}`, size: "sm", variant: "ghost", children: `${value}%`, title: t("browser.pageZoomPreset", { percent: value }), "aria-label": t("browser.pageZoomPreset", { percent: value }), onClick: () => this.props.onChange(value) }));
            button.root.style.top = `${pageZoomOffset(value)}px`;
            buttons.append(button.root);
            return button;
        });
        controls.append(this.slider.root, buttons);
        host.append(controls);
    }

    protected onMount(): void {
        this.slider.mount();
        this.presets.forEach((button) => button.mount());
        // Wheel anywhere over the popover moves the slider one step (up = zoom in). Not passive,
        // so it can stop the page underneath from scrolling.
        this.listen(this.root, "wheel", this.handleWheel, { passive: false });
    }
    protected onUpdate(props: BrowserZoomContentProps): void { this.slider.update(this.sliderProps(props)); }
    private readonly handleWheel = (event: WheelEvent): void => {
        event.preventDefault();
        if (event.deltaY === 0) return;
        const next = clampPageZoom(this.props.value + (event.deltaY < 0 ? PAGE_ZOOM_STEP : -PAGE_ZOOM_STEP));
        if (next !== this.props.value) this.props.onChange(next);
    };
    private sliderProps(props: BrowserZoomContentProps) {
        return { name: "zoom-slider", value: props.value, onChange: props.onChange, min: PAGE_ZOOM_MIN, max: PAGE_ZOOM_MAX, step: PAGE_ZOOM_STEP, orientation: "vertical" as const, width: PAGE_ZOOM_SLIDER_HEIGHT, showProgress: true, "aria-label": t("browser.pageZoom"), "aria-valuetext": `${props.value}%` };
    }
}

