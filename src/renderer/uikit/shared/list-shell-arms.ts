import { fillSlot } from "./fill-slot";
import type { SlotContent } from "./fill-slot";
import { SpinnerView } from "../Spinner/SpinnerView";
import { uikitText } from "./uikit-text";
import type { IOwnedView } from "./vanilla-view";

export type ListShellArm = "loading" | "empty" | "real";

export interface ListShellArmsOptions {
    root: HTMLElement;
    messageHost: HTMLElement;
    enterRealArm(): void;
    leaveRealArm(): void;
}

/**
 * The three arms are three DOM states of one stable root. The grid is created on entry to the real
 * arm and disposed on exit, so a dataset replaced while loading cannot reuse a stale scroll offset.
 */
export class ListShellArms {
    private arm: ListShellArm | undefined;
    private spinner: SpinnerView | undefined;
    private emptyMessage: SlotContent | undefined;
    private slotCleanup: (() => void) | undefined;

    public constructor(_owner: IOwnedView, private readonly options: ListShellArmsOptions) {}

    public apply(input: {
        loading: boolean;
        empty: boolean;
        emptyMessage?: SlotContent;
    }): ListShellArm {
        const arm: ListShellArm = input.loading ? "loading" : input.empty ? "empty" : "real";
        const changed = arm !== this.arm;
        const priorArm = this.arm;
        this.arm = arm;

        if (arm === "real") {
            if (changed) {
                this.options.messageHost.remove();
                this.options.enterRealArm();
            }
            return arm;
        }

        if (changed) {
            if (priorArm === "real") this.options.leaveRealArm();
            this.options.root.append(this.options.messageHost);
        }
        // Refill only when the arm or empty content changes; repeating fillSlot moves native nodes.
        if (changed || (arm === "empty" && input.emptyMessage !== this.emptyMessage)) {
            this.emptyMessage = input.emptyMessage;
            this.fillMessage(arm, input.emptyMessage);
        }
        return arm;
    }

    public dispose(): void {
        this.slotCleanup?.();
        this.slotCleanup = undefined;
        this.spinner?.dispose();
        this.spinner = undefined;
    }

    private fillMessage(arm: Exclude<ListShellArm, "real">, emptyMessage?: SlotContent): void {
        if (arm === "loading") {
            if (!this.spinner) {
                this.spinner = new SpinnerView({ size: 16 });
                this.spinner.mount();
            }
            const fragment = document.createDocumentFragment();
            fragment.append(this.spinner.root, document.createTextNode(uikitText("loading")));
            this.slotCleanup = fillSlot(this.options.messageHost, fragment);
            return;
        }
        this.slotCleanup = fillSlot(this.options.messageHost, emptyMessage ?? uikitText("noRows"));
    }
}
