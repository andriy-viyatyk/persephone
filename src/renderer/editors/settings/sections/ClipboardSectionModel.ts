import { normalizeClipboardMaxItems, settings } from "../../../api/settings";
import { TComponentModel } from "../../../core/state/model";
import { createDepsGate, type DepsGate } from "../../../uikit/shared/deps-gate";

export interface ClipboardSectionProps {
    clipboardEnabled: boolean;
    clipboardMaxItems: number;
}

const defaultClipboardSectionState = {
    maxItemsValue: "",
};

export type ClipboardSectionState = typeof defaultClipboardSectionState;

export class ClipboardSectionModel extends TComponentModel<ClipboardSectionState, ClipboardSectionProps> {
    private initialized = false;
    private readonly maxItemsGate: DepsGate = createDepsGate();

    init(): void {
        this.setMaxItemsValue(String(normalizeClipboardMaxItems(this.props.clipboardMaxItems)));
        this.maxItemsGate.prime([this.props.clipboardMaxItems]);
        this.initialized = true;
    }

    setProps = (props: ClipboardSectionProps): void => {
        if (!this.initialized) return;
        if (this.maxItemsGate.changed([props.clipboardMaxItems])) {
            this.setMaxItemsValue(String(normalizeClipboardMaxItems(props.clipboardMaxItems)));
        }
    };

    setMaxItemsValue = (maxItemsValue: string): void => {
        this.state.update((state) => {
            state.maxItemsValue = maxItemsValue;
        });
    };

    handleToggle = (): void => {
        settings.set("clipboard.enabled", !this.props.clipboardEnabled);
    };

    handleMaxItemsBlur = (): void => {
        const value = Number(this.state.get().maxItemsValue);
        if (Number.isInteger(value) && value >= 1 && value <= 1000) {
            settings.set("clipboard.max-items", value);
        } else {
            this.setMaxItemsValue(String(normalizeClipboardMaxItems(this.props.clipboardMaxItems)));
        }
    };
}

export { defaultClipboardSectionState };
