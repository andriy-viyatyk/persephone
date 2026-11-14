import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { normalizeVoiceTypingShortcut, RIGHT_CTRL_SHORTCUT, SHIFT_RIGHT_CTRL_SHORTCUT, voiceTypingShortcutFromKeyboardEvent } from "../../../../shared/voice-typing-shortcut";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Input/Input.css";

export interface ShortcutFieldProps {
    store: SettingsStore<string>;
    id: string;
    width: number | string;
    ariaLabel: string;
    resetValue: string;
    captureState: ShortcutCaptureState;
    getOtherShortcut: () => string;
    onInvalid: () => void;
}

type ShortcutSettingKey = "voice-typing.shortcut" | "voice-typing.translate-shortcut";

export interface ShortcutCaptureState {
    rightCtrlTapPending: { settingKey: ShortcutSettingKey; shift: boolean } | undefined;
}

export function createShortcutCaptureState(): ShortcutCaptureState {
    return { rightCtrlTapPending: undefined };
}

export class ShortcutField extends VanillaView<ShortcutFieldProps> {
    private readonly input: InputView;
    private value: string;
    private readGeneration = 0;

    public constructor(props: ShortcutFieldProps) {
        const input = new InputView({ type: "text", size: "sm", value: props.resetValue, onChange: () => {} });
        super(props, input.root);
        this.input = this.child(input);
        this.value = props.resetValue;
    }

    protected onMount(): void {
        this.input.update(this.inputProps());
        this.input.mount();
        this.listen(this.input.root, "keyup", this.captureRightCtrlTap);
        this.own(this.props.store.subscribe(this.props.id, (value) => this.applyValue(value)));
        this.loadValue();
    }

    private inputProps(): InputProps {
        return {
            type: "text",
            size: "sm",
            width: this.props.width,
            value: this.value,
            readOnly: true,
            "aria-label": this.props.ariaLabel,
            onKeyDown: this.captureShortcut,
        };
    }

    private applyValue(value: string): void {
        this.value = value;
        this.input.update(this.inputProps());
    }

    private loadValue(): void {
        const generation = ++this.readGeneration;
        const result = this.props.store.get(this.props.id);
        if (result instanceof Promise) {
            void result.then((value) => {
                if (!this.isDisposed && generation === this.readGeneration) this.applyValue(value);
            });
        } else {
            this.applyValue(result);
        }
    }

    private readonly captureShortcut = (event: KeyboardEvent): void => {
        event.preventDefault();
        if (event.repeat) return;
        const settingKey = this.props.id as ShortcutSettingKey;
        if (event.code === "ControlRight") {
            this.props.captureState.rightCtrlTapPending = event.altKey || event.metaKey ? undefined : { settingKey, shift: event.shiftKey };
            return;
        }
        if (event.key === "Shift" && this.props.captureState.rightCtrlTapPending?.settingKey === settingKey) {
            this.props.captureState.rightCtrlTapPending.shift = true;
            return;
        }
        if (this.props.captureState.rightCtrlTapPending?.settingKey === settingKey) this.props.captureState.rightCtrlTapPending = undefined;
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        const shortcut = voiceTypingShortcutFromKeyboardEvent(event);
        if (!shortcut) {
            this.props.onInvalid();
            return;
        }
        this.saveShortcut(settingKey, shortcut);
    };

    private readonly captureRightCtrlTap = (event: KeyboardEvent): void => {
        if (event.code !== "ControlRight" || !this.props.captureState.rightCtrlTapPending) return;
        const { settingKey, shift } = this.props.captureState.rightCtrlTapPending;
        this.props.captureState.rightCtrlTapPending = undefined;
        this.saveShortcut(settingKey, shift ? SHIFT_RIGHT_CTRL_SHORTCUT : RIGHT_CTRL_SHORTCUT);
    };

    private saveShortcut(settingKey: ShortcutSettingKey, shortcut: string): void {
        if (normalizeVoiceTypingShortcut(this.props.getOtherShortcut()) === shortcut) {
            this.props.onInvalid();
            return;
        }
        void this.props.store.set(settingKey, shortcut);
    }

    public reset(): Promise<void> {
        return Promise.resolve(this.props.store.set(this.props.id, this.props.resetValue)).then(() => {
            if (!this.isDisposed) this.applyValue(this.props.resetValue);
        });
    }
}
