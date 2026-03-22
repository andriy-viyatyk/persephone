import { transpileIfNeeded, ensureSucraseLoaded } from "./transpile";
import { registerLibraryExtensions, clearLibraryRequireCache } from "./library-require";
import { settings } from "../api/settings";

const lexicalObjects = `
    const React = globalThis.React;

    const Array = globalThis.Array;
    const Boolean = globalThis.Boolean;
    const Date = globalThis.Date;
    const Error = globalThis.Error;
    const EvalError = globalThis.EvalError;
    const Function = globalThis.Function;
    const Infinity = globalThis.Infinity;
    const JSON = globalThis.JSON;
    const Map = globalThis.Map;
    const Math = globalThis.Math;
    const NaN = globalThis.NaN;
    const Number = globalThis.Number;
    const Object = globalThis.Object;
    const Promise = globalThis.Promise;
    const RegExp = globalThis.RegExp;
    const Set = globalThis.Set;
    const String = globalThis.String;
    const Symbol = globalThis.Symbol;
    const TypeError = globalThis.TypeError;
    const URIError = globalThis.URIError;
    const WeakMap = globalThis.WeakMap;
    const WeakSet = globalThis.WeakSet;
    const BigInt = globalThis.BigInt;
    const BigInt64Array = globalThis.BigInt64Array;
    const BigUint64Array = globalThis.BigUint64Array;
    const Int8Array = globalThis.Int8Array;
    const Uint8Array = globalThis.Uint8Array;
    const Uint8ClampedArray = globalThis.Uint8ClampedArray;
    const Int16Array = globalThis.Int16Array;
    const Uint16Array = globalThis.Uint16Array;
    const Int32Array = globalThis.Int32Array;
    const Uint32Array = globalThis.Uint32Array;
    const Float32Array = globalThis.Float32Array;
    const Float64Array = globalThis.Float64Array;
    const SharedArrayBuffer = globalThis.SharedArrayBuffer;
    const ArrayBuffer = globalThis.ArrayBuffer;
    const DataView = globalThis.DataView;
    const Atomics = globalThis.Atomics;
    const Reflect = globalThis.Reflect;
    const Proxy = globalThis.Proxy;
    const TextEncoder = globalThis.TextEncoder;
    const TextDecoder = globalThis.TextDecoder;
    const URL = globalThis.URL;
    const URLSearchParams = globalThis.URLSearchParams;
    const AggregateError = globalThis.AggregateError;
    const FinalizationRegistry = globalThis.FinalizationRegistry;
    const WeakRef = globalThis.WeakRef;
`;

/**
 * Core script execution engine. Handles TypeScript transpilation, Script Library
 * registration, expression/statement detection, implicit return wrapping,
 * and async await. No context creation, no cleanup, no output handling —
 * caller manages the lifecycle.
 */
export class ScriptRunnerBase {
    protected libraryDirty = true;

    /** Mark library cache as dirty. Called by file watcher when library files change. */
    invalidateLibraryCache = () => {
        this.libraryDirty = true;
    };

    /**
     * Prepare and execute a script string with a given context proxy.
     * Handles transpilation (TS → JS) and Script Library registration
     * before executing. Returns the script result.
     */
    protected async execute(script: string, context: Record<string, any>, language?: string): Promise<any> {
        const prepared = await this.prepare(script, language);
        return this.executeInternal(prepared, context);
    }

    /**
     * Transpile TypeScript, ensure sucrase loaded for library require(),
     * and register Script Library extensions.
     */
    private async prepare(script: string, language?: string): Promise<string> {
        script = await transpileIfNeeded(script, language);

        await ensureSucraseLoaded();

        const libraryPath = settings.get("script-library.path") as string | undefined;
        if (libraryPath) {
            registerLibraryExtensions(libraryPath);
        }

        if (this.libraryDirty && libraryPath) {
            clearLibraryRequireCache(libraryPath);
            this.libraryDirty = false;
        }

        return script;
    }

    /**
     * Execute a prepared (already transpiled) script string with a given context proxy.
     * Handles expression/statement detection, implicit return, and async await.
     */
    private async executeInternal(script: string, context: Record<string, any>): Promise<any> {
        // Check if script contains statement keywords at the start
        const trimmedScript = script.trim();
        const statementKeywords =
            /^(const|let|var|if|for|while|do|switch|function|class|try|throw|return)\s/;
        const hasStatements = statementKeywords.test(trimmedScript);

        if (!hasStatements) {
            // Try as expression first (for simple cases like "5 + 5" or "'hello'")
            const expressionScript = `
            with (this) {
                return (async function() {
                    ${lexicalObjects}
                    return (${script});
                }).call(this);
            }
            `;

            try {
                const fn = new Function(expressionScript);
                const scriptResult = fn.call(context);
                return this.isPromiseLike(scriptResult)
                    ? await scriptResult
                    : scriptResult;
            } catch (expressionError) {
                // Fall through to statement handling
            }
        }

        // Try to extract the last expression and make it return
        const statementScript = this.wrapScriptWithImplicitReturn(script);
        const fn = new Function(statementScript);
        const scriptResult = fn.call(context);
        return this.isPromiseLike(scriptResult)
            ? await scriptResult
            : scriptResult;
    }

    private wrapScriptWithImplicitReturn(script: string): string {
        const lines = script.trim().split("\n");

        // If there's already a return statement, use as-is
        if (/\breturn\b/.test(script)) {
            return `
            with (this) {
                return (async function() {
                    ${lexicalObjects}
                    ${script}
                }).call(this);
            }
        `;
        }

        // Try to make the last line/statement return its value
        const lastLine = lines[lines.length - 1].trim();

        // Check if last line looks like an expression (not a statement or block closer)
        const isStatement =
            /^(const|let|var|if|for|while|do|switch|function|class|try|throw|return)\s/.test(
                lastLine
            );
        const isBlockCloser = /^[}\]]/.test(lastLine);

        if (
            !isStatement &&
            !isBlockCloser &&
            lastLine &&
            !lastLine.endsWith(";") &&
            !lastLine.endsWith("}")
        ) {
            // Last line looks like an expression, make it return
            const beforeLast = lines.slice(0, -1).join("\n");
            return `
            with (this) {
                return (async function() {
                    ${lexicalObjects}
                    ${beforeLast}
                    return (${lastLine});
                }).call(this);
            }
        `;
        } else if (!isStatement && !isBlockCloser && lastLine && lastLine.endsWith(";")) {
            // Remove trailing semicolon and return
            const beforeLast = lines.slice(0, -1).join("\n");
            const expressionPart = lastLine.slice(0, -1); // Remove semicolon
            return `
            with (this) {
                return (async function() {
                    ${lexicalObjects}
                    ${beforeLast}
                    return (${expressionPart});
                }).call(this);
            }
        `;
        }

        // Default: execute as-is (will return undefined)
        return `
        with (this) {
            return (async function() {
                ${lexicalObjects}
                ${script}
            }).call(this);
        }
    `;
    }

    /**
     * Check if a value is a genuine Promise-like object (not just any object with a .then method).
     * StyledLogBuilder has a .then() method for chaining styled text segments — it is NOT a Promise.
     */
    private isPromiseLike(value: any): boolean {
        return value instanceof Promise
            || (value && typeof value.then === "function" && typeof value.catch === "function");
    }
}
