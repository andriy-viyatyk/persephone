import type { ScriptContext } from "./ScriptContext";

export const SCRIPT_GLOBALS = [
    ["app", "app"],
    ["page", "page"],
    ["io", "io"],
    ["styledText", "styledText"],
    ["preventOutput", "preventOutput"],
    ["require", "customRequire", "require"],
    ["console", "console", "console"],
] as const satisfies readonly (readonly [string, keyof ScriptContext, string?])[];

/**
 * Prefix for top-level scripts executed via fn.call(context).
 * Reads context properties from `this` (the ScriptContext instance).
 * `ui` is NOT included — it's a lazy getter on globalThis (stack-based per context).
 */
export const SCRIPT_PREFIX = `var ${SCRIPT_GLOBALS.map(([name, property]) => `${name}=this.${property}`).join(",")};\n`;

/**
 * Prefix injected at the top of every library module loaded via require().
 * Reads context from globalThis.__activeScriptContext__ which is set by
 * ScriptContext.customRequire() before calling native require().
 *
 * `ui` is NOT included — it's a lazy getter on globalThis (stack-based per context).
 */
export const MODULE_CONTEXT_PREFIX = "var __ctx=globalThis.__activeScriptContext__," +
    SCRIPT_GLOBALS.map((entry) => {
        const [name, property] = entry;
        // A module's own `require` (the CommonJS wrapper parameter) still resolves relative ids against
        // the module file, so the context wraps it instead of replacing it (ScriptContext.moduleRequire).
        if (name === "require") return "require=__ctx?__ctx.moduleRequire(require):require";
        const fallback = entry.length === 3 ? entry[2] : undefined;
        return `${name}=__ctx?.${property}${fallback ? `||${fallback}` : ""}`;
    }).join(",") + ";\n";
