import { TDialogModel } from "../../core/state/model";
import type { TModel } from "../../core/state/model";
import type { PopoverPosition } from "../../uikit/Popover/PopoverModel";

export interface IViewData<M extends TModel<T>, T = unknown> {
    // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    viewId: Symbol;
    model: M;
    internalId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IDialogViewData<
    // M's default uses `any` to accept all concrete TDialogModel subclasses
    // at use sites (e.g. `showDialog({ model: ConfirmationDialogModel, ... })`).
    // TS classes are invariant in their type parameters, and defaults can't
    // forward-reference later type params, so widening to `unknown` would
    // reject those subclass assignments. The `any` is load-bearing here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    M extends TDialogModel<T> = TDialogModel<any, any>,
    T = unknown,
> extends IViewData<M, T> {}

export class TPopperModel<T = unknown, R = unknown> extends TDialogModel<T, R> {
    position: PopoverPosition = {};
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IPopperViewData<
    // M's default uses `any` to accept concrete TPopperModel subclasses at
    // use sites — same TS limitation as IDialogViewData (class invariance +
    // forward-reference forbidden in defaults).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    M extends TPopperModel<T> = TPopperModel<any, any>,
    T = unknown
> extends IDialogViewData<M, T> {}
