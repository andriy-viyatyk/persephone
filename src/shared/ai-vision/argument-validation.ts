/**
 * Shared validation for positional AiVision call arguments.
 *
 * This module is deliberately process-neutral: both the renderer and main-process call
 * resolvers can use the same error contract without importing application code.
 */

export type ArgumentType = "string" | "number" | "boolean" | "object" | "array" | "function";

type ChoiceProvider = readonly unknown[] | (() => readonly unknown[]);

export interface ArgumentRule<T = unknown> {
    /** Type-only marker used to preserve the validated tuple's result types. */
    readonly valueType?: T;
    readonly name: string;
    readonly usage: string;
    readonly required?: boolean;
    readonly nullIsMissing?: boolean;
    readonly type?: ArgumentType;
    readonly minimum?: number;
    readonly elementType?: ArgumentType;
    readonly choices?: ChoiceProvider;
    readonly expectedType?: ArgumentType;
    readonly validValuesPath?: string;
    readonly valueLabel?: string;
}

export interface ArgumentValidationOptions {
    readonly maxArgs?: number;
}

export class ArgumentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ArgumentValidationError";
    }
}

type ValidatedArguments<Rules extends readonly ArgumentRule<unknown>[]> = {
    [Index in keyof Rules]: Rules[Index] extends ArgumentRule<infer Value> ? Value : never;
};

interface RuleOptions {
    readonly required?: boolean;
}

interface ChoiceRuleOptions extends RuleOptions {
    readonly expectedType?: ArgumentType;
    readonly validValuesPath?: string;
}

export function stringRule(
    name: string,
    usage: string,
    options: RuleOptions = {},
): ArgumentRule<string> {
    return {
        name,
        usage,
        type: "string",
        required: options.required ?? true,
        nullIsMissing: options.required ?? true,
    };
}

export function numberRule(
    name: string,
    usage: string,
    options: RuleOptions & { readonly minimum?: number } = {},
): ArgumentRule<number> {
    return {
        name,
        usage,
        type: "number",
        required: options.required ?? true,
        nullIsMissing: false,
        ...(options.minimum !== undefined ? { minimum: options.minimum } : {}),
    };
}

export function valueRule(
    name = "value",
    usage = "method(value)",
): ArgumentRule<unknown> {
    return { name, usage, required: true, nullIsMissing: false };
}

export function choiceRule<T>(
    name: string,
    choices: readonly T[] | (() => readonly T[]),
    usage: string,
    options: ChoiceRuleOptions = {},
): ArgumentRule<T> {
    return {
        name,
        usage,
        required: options.required ?? true,
        nullIsMissing: false,
        choices,
        ...(options.expectedType !== undefined ? { expectedType: options.expectedType } : {}),
        ...(options.validValuesPath !== undefined ? { validValuesPath: options.validValuesPath } : {}),
    };
}

export function arrayOfChoicesRule<T>(
    name: string,
    choices: readonly T[] | (() => readonly T[]),
    usage: string,
    options: ChoiceRuleOptions = {},
): ArgumentRule<T[]> {
    return {
        name,
        usage,
        required: options.required ?? true,
        type: "array",
        nullIsMissing: false,
        elementType: options.expectedType ?? "string",
        choices,
        ...(options.validValuesPath !== undefined ? { validValuesPath: options.validValuesPath } : {}),
    };
}

export function validateCallArguments<const Rules extends readonly ArgumentRule<unknown>[]>(
    callName: string,
    args: readonly unknown[],
    rules: Rules,
    options: ArgumentValidationOptions = {},
): ValidatedArguments<Rules> {
    if (options.maxArgs !== undefined && args.length > options.maxArgs) {
        const exampleRule = rules[Math.min(options.maxArgs, rules.length) - 1];
        const example = exampleRule?.usage ?? `${callName}()`;
        throw new ArgumentValidationError(
            `Invalid call to ${callName}: received ${args.length} arguments ${formatValue(args)} `
            + `(array; types: ${args.map(runtimeType).join(", ") || "none"}). `
            + `Expected at most ${options.maxArgs} arguments. Example: ${example}`,
        );
    }

    for (let index = 0; index < rules.length; index++) {
        const rule = rules[index];
        const value = args[index];
        if (value === undefined || (rule.nullIsMissing && value === null)) {
            if (rule.required !== false) {
                throw new ArgumentValidationError(
                    `Argument "${rule.name}" for ${callName} is required; received `
                    + `${formatValue(value)} (${runtimeType(value)}). Example: ${rule.usage}`,
                );
            }
            continue;
        }

        const actualType = runtimeType(value);
        const expectedType = rule.expectedType ?? rule.type;
        if (expectedType && actualType !== expectedType) {
            throw invalidArgument(
                callName,
                rule,
                value,
                `expected ${expectedTypeDescription(rule)}${formatChoiceSuffix(rule)}`,
            );
        }

        if (rule.elementType && Array.isArray(value)) {
            for (let elementIndex = 0; elementIndex < value.length; elementIndex++) {
                const element = value[elementIndex];
                if (runtimeType(element) !== rule.elementType) {
                    throw invalidArgument(
                        callName,
                        { ...rule, name: `${rule.name}[${elementIndex}]` },
                        element,
                        `expected ${rule.elementType}${formatChoiceSuffix(rule)}`,
                    );
                }
            }
        }

        if (rule.minimum !== undefined && typeof value === "number" && value < rule.minimum) {
            throw invalidArgument(
                callName,
                rule,
                value,
                `expected a number at least ${rule.minimum}`,
            );
        }

        const choices = rule.choices ? getChoices(rule.choices) : undefined;
        const choiceValues = choices && Array.isArray(value) && rule.elementType ? value : [value];
        const invalidChoiceIndex = choices?.length
            ? choiceValues.findIndex(choiceValue => !choices.some(choice => choice === choiceValue))
            : -1;
        if (choices && invalidChoiceIndex !== -1) {
            const invalidValue = choiceValues[invalidChoiceIndex];
            const invalidRule = Array.isArray(value) && rule.elementType
                ? { ...rule, name: `${rule.name}[${invalidChoiceIndex}]` }
                : rule;
            const validValues = formatChoices(choices, rule.validValuesPath);
            throw invalidArgument(
                callName,
                invalidRule,
                invalidValue,
                `expected one of the current ${rule.valueLabel ?? rule.name} values; valid values: ${validValues}`,
            );
        }
    }

    return rules.map((_, index) => args[index]) as ValidatedArguments<Rules>;
}

/** Format a non-fatal warning for supplying arguments to a property read. */
export function noArgumentsWarning(
    propertyName: string,
    args: readonly unknown[],
    usage = propertyName,
): string {
    return `Property "${propertyName}" takes no arguments; received ${formatValue(args)} `
        + `(${runtimeType(args)}). Read it without arguments. Example: ${usage}`;
}

export function runtimeType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function invalidArgument(
    callName: string,
    rule: ArgumentRule<unknown>,
    value: unknown,
    reason: string,
): ArgumentValidationError {
    return new ArgumentValidationError(
        `Invalid argument "${rule.name}" for ${callName}: received ${formatValue(value)} `
        + `(${runtimeType(value)}); ${reason}. Example: ${rule.usage}`,
    );
}

function expectedTypeDescription(rule: ArgumentRule<unknown>): string {
    return rule.elementType && rule.type === "array"
        ? `array of ${rule.elementType}s`
        : rule.expectedType ?? rule.type ?? "the expected type";
}

function formatChoiceSuffix(rule: ArgumentRule<unknown>): string {
    if (!rule.choices) return "";
    return `; valid values: ${formatChoices(getChoices(rule.choices), rule.validValuesPath)}`;
}

function getChoices(provider: ChoiceProvider): readonly unknown[] {
    return typeof provider === "function" ? provider() : provider;
}

function formatChoices(choices: readonly unknown[], validValuesPath: string | undefined): string {
    if (choices.length === 0) return "(none)";
    if (choices.length > 12 && validValuesPath) return `read ${validValuesPath}`;
    return choices.map(formatValue).join(", ");
}

function formatValue(value: unknown): string {
    if (value === undefined) return "undefined";
    if (typeof value === "string") return JSON.stringify(value);
    try {
        const serialized = JSON.stringify(value);
        if (serialized !== undefined) return serialized;
    } catch {
        // Fall through to String for circular or otherwise non-serializable values.
    }
    try {
        return String(value);
    } catch {
        return "<unformattable value>";
    }
}
