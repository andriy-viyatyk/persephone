import type { TModel } from "../../core/state/model";
import type { IDialogViewData } from "./dialog-types";
import type { VanillaViewCtor } from "../../uikit/shared/vanilla-view";

export interface ViewProps<M extends TModel<T>, T = unknown> {
    model: M;
}

/** Props shared by native dialog and popper constructors. */
export type DialogViewProps = ViewProps<TModel<unknown>>;
export type DialogViewCtor = VanillaViewCtor<DialogViewProps>;
type DialogViewId = IDialogViewData["viewId"];

const nativeViews = new Map<DialogViewId, DialogViewCtor>();

/** Register a native view for a dialogs-local view ID. */
export function registerDialogView(viewId: DialogViewId, ctor: DialogViewCtor): void {
    nativeViews.set(viewId, ctor);
}

/** Return the native constructor registered for a dialogs-local view ID. */
export function getDialogView(viewId: DialogViewId): DialogViewCtor | undefined {
    return nativeViews.get(viewId);
}
