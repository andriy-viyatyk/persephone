import { PageModel } from "../editors/base";
import { AppWrapper } from "./api-wrapper/AppWrapper";
import { PageWrapper } from "./api-wrapper/PageWrapper";
import { createLibraryRequire, createUnlinkedLibraryRequire } from "./library-require";
import React from "react";

export interface ConsoleLogEntry {
    level: "log" | "error" | "warn" | "info";
    args: string[];
    timestamp: number;
}

function serializeArg(arg: any): string {
    if (arg === undefined) return "undefined";
    if (arg === null) return "null";
    if (typeof arg === "string") return arg;
    if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") return String(arg);
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
        return JSON.stringify(arg);
    } catch {
        return String(arg);
    }
}

export interface ScriptOutputFlags {
    outputPrevented: boolean;
    groupedContentWritten: boolean;
}

export function createScriptContext(page?: PageModel, consoleLogs?: ConsoleLogEntry[], libraryPath?: string) {
    const releaseList: Array<() => void> = [];
    const outputFlags: ScriptOutputFlags = {
        outputPrevented: false,
        groupedContentWritten: false,
    };

    const appWrapper = new AppWrapper(releaseList);
    const pageWrapper = page ? new PageWrapper(page, releaseList, outputFlags) : undefined;

    const customContext: Record<string, any> = {
        app: appWrapper,
        page: pageWrapper,
        React,
        preventOutput: () => { outputFlags.outputPrevented = true; },
        require: libraryPath
            ? createLibraryRequire(libraryPath)
            : createUnlinkedLibraryRequire(),
    };

    if (consoleLogs) {
        customContext.console = {
            log: (...args: any[]) => { consoleLogs.push({ level: "log", args: args.map(serializeArg), timestamp: Date.now() }); },
            error: (...args: any[]) => { consoleLogs.push({ level: "error", args: args.map(serializeArg), timestamp: Date.now() }); },
            warn: (...args: any[]) => { consoleLogs.push({ level: "warn", args: args.map(serializeArg), timestamp: Date.now() }); },
            info: (...args: any[]) => { consoleLogs.push({ level: "info", args: args.map(serializeArg), timestamp: Date.now() }); },
        };
    }

    function cleanup() {
        for (const release of releaseList) {
            try { release(); } catch { /* don't block other releases */ }
        }
        releaseList.length = 0;
    }

    // Create a read-only proxy for window/globalThis
    const readOnlyGlobalThis = new Proxy(globalThis, {
        get(target, prop) {
            if (Object.hasOwn(customContext, prop)) {
                return customContext[prop as string];
            }
            const value = (globalThis as any)[prop];

            // If it's a function, bind it to globalThis
            if (typeof value === "function") {
                if (value.prototype) {
                    // Do NOT bind constructors or classes
                    return value;
                }

                return value.bind(globalThis);
            }

            return value;
        },
        set(target, prop, value) {
            customContext[prop as string] = value;
            return true;
        },
        deleteProperty() {
            // Prevent deletions
            return false;
        },
        defineProperty() {
            // Prevent defining new properties
            return false;
        },
    });

    const context = new Proxy(customContext, {
        get(target, prop) {
            // First check custom context
            if (prop in target) {
                return target[prop as string];
            }

            // Special handling for 'window' and 'globalThis'
            if (prop === "window" || prop === "globalThis") {
                return readOnlyGlobalThis;
            }

            // Then check globalThis
            if (prop in globalThis) {
                const value = (globalThis as any)[prop];

                // If it's a function, bind it to globalThis
                if (typeof value === "function") {
                    return value.bind(globalThis);
                }

                return value;
            }

            return undefined;
        },

        has(target, prop) {
            return prop in target || prop in globalThis;
        },

        set(target, prop, value) {
            target[prop as string] = value;
            return true;
        },

        deleteProperty(target, prop) {
            // Only allow deleting custom context properties
            if (prop in target) {
                delete target[prop as string];
                return true;
            }
            // Prevent deleting global properties
            return false;
        },
    });

    return { context, cleanup, outputFlags };
}
