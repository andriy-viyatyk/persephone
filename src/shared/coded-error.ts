import { errMessage } from "./utils";

export type CodedError<C extends string = string> = Error & { readonly code: C };

/** Same shape as Object.assign(new Error(message), { code }): plain Error, own enumerable `code`. */
export function codedError<C extends string>(code: C, message: string = code): CodedError<C> {
    return Object.assign(new Error(message), { code });
}

export function isCoded(value: unknown): value is { code: string; message?: unknown } {
    return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string";
}

export interface ToCodedErrorOptions<C extends string> {
    readonly accepts?: (code: unknown) => code is C;
    readonly fallbackMessage?: string;
}

/** Preserves an accepted code and string message, otherwise uses the supplied fallbacks. */
export function toCodedError<C extends string>(
    value: unknown,
    fallbackCode: C,
    options: ToCodedErrorOptions<C> = {},
): CodedError<C> {
    const accepted = isCoded(value) && (options.accepts ? options.accepts(value.code) : true);
    const code = accepted ? (value as { code: C }).code : fallbackCode;
    const message = isCoded(value) && typeof value.message === "string"
        ? value.message
        : errMessage(value, options.fallbackMessage);
    return codedError(code, message);
}
