import { PageModel } from "../editors/base";
import { AppWrapper } from "./api-wrapper/AppWrapper";
import { PageWrapper } from "./api-wrapper/PageWrapper";
import React from "react";

export function createScriptContext(page?: PageModel) {
    const releaseList: Array<() => void> = [];

    const appWrapper = new AppWrapper(releaseList);
    const pageWrapper = page ? new PageWrapper(page, releaseList) : undefined;

    const customContext: Record<string, any> = {
        app: appWrapper,
        page: pageWrapper,
        React,
    };

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

    return { context, cleanup };
}
