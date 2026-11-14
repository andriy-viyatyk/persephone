import { TGlobalState } from "../../core/state/state";
import type { IDialogViewData } from "../../api/dialogs/dialog-types";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { getDialogView, type DialogViewCtor, type DialogViewProps } from "../../api/dialogs/dialog-view-registry";

interface ModelViewSlot {
    readonly root: HTMLElement;
    readonly nativeView: VanillaView<DialogViewProps>;
    readonly nativeCtor: DialogViewCtor;
}

export class ModelViewSlotHost<D extends IDialogViewData, K> extends VanillaView<undefined> {
    private readonly slots = new Map<K, ModelViewSlot>();

    public constructor(
        private readonly state: TGlobalState<D[]>,
        private readonly keyFor: (data: D) => K,
    ) {
        super(undefined, document.createElement("div"));
        this.root.style.display = "contents";
    }

    protected onMount(): void {
        this.reconcile(this.state.get());
        this.own(this.state.subscribe(() => this.reconcile(this.state.get())));
    }

    protected onDispose(): void {
        const slots = Array.from(this.slots.values());
        this.slots.clear();
        this.disposeSlots(slots);
    }

    private reconcile(dataItems: D[]): void {
        const currentKeys = new Set(dataItems.map((data) => this.keyFor(data)));
        const removed: ModelViewSlot[] = [];

        for (const [key, slot] of this.slots) {
            if (!currentKeys.has(key)) {
                this.slots.delete(key);
                removed.push(slot);
            }
        }
        this.disposeSlots(removed);

        for (const data of dataItems) {
            const key = this.keyFor(data);
            let slot = this.slots.get(key);
            const nativeCtor = getDialogView(data.viewId);

            if (slot && slot.nativeCtor !== nativeCtor) {
                this.slots.delete(key);
                this.disposeSlots([slot]);
                slot = undefined;
            }

            if (!slot) {
                slot = this.createSlot(data, nativeCtor);
                this.slots.set(key, slot);
            } else {
                this.updateSlot(slot, data);
            }
        }

        this.reorder(dataItems);
    }

    private createSlot(
        data: D,
        nativeCtor: DialogViewCtor | undefined,
    ): ModelViewSlot {
        const props: DialogViewProps = {
            model: data.model,
        };
        if (!nativeCtor) {
            throw new Error(
                `No native dialog view registered for "${data.viewId.toString()}".`,
            );
        }
        const nativeView = new nativeCtor(props);
        const root = nativeView.root;
        this.root.append(root);

        const slot: ModelViewSlot = { root, nativeView, nativeCtor };
        nativeView.mount();
        return slot;
    }

    private updateSlot(slot: ModelViewSlot, data: D): void {
        const props: DialogViewProps = {
            model: data.model,
        };
        slot.nativeView.update(props);
    }

    private disposeSlots(slots: ModelViewSlot[]): void {
        let firstError: unknown;
        let hasError = false;
        for (const slot of slots) {
            try {
                slot.nativeView.dispose();
                slot.root.remove();
            } catch (error) {
                if (!hasError) {
                    hasError = true;
                    firstError = error;
                }
            }
        }
        if (hasError) throw firstError;
    }

    private reorder(dataItems: D[]): void {
        dataItems.forEach((data, index) => {
            const slot = this.slots.get(this.keyFor(data));
            if (!slot) return;
            const current = this.root.children[index];
            if (current !== slot.root) this.root.insertBefore(slot.root, current ?? null);
        });
    }
}
