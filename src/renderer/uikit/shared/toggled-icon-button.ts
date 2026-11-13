import { IconButtonView, type IconButtonProps } from "../IconButton/IconButtonView";

/** Owns an icon button that appears conditionally in an existing view host. */
export class ToggledIconButton {
    private button: IconButtonView | undefined;

    public constructor(
        private readonly host: HTMLElement,
        private readonly adopt: (button: IconButtonView) => IconButtonView,
        private readonly release: (button: IconButtonView) => void,
    ) {}

    public sync(visible: boolean, props: IconButtonProps): void {
        if (!visible) {
            this.dispose();
            return;
        }

        if (!this.button) {
            const button = this.adopt(new IconButtonView(props));
            this.button = button;
            this.host.append(button.root);
            button.mount();
        } else {
            this.button.update(props);
        }
    }

    public dispose(): void {
        if (!this.button) return;
        const button = this.button;
        this.button = undefined;
        this.release(button);
    }
}
