import type { ScriptContext } from "./ScriptContext";
import { SCRIPT_PREFIX } from "./script-globals";

interface CompiledScript {
    script: string;
    hasStatements: boolean;
}

/**
 * Compile top-level scripts for execution with a ScriptContext.
 * Context globals are injected via SCRIPT_PREFIX reading from `this` (context).
 *
 * Two injection mechanisms:
 * - Top-level scripts (here): fn.call(context) with SCRIPT_PREFIX reading from `this`
 * - Library modules (`library-require.ts`): the extension handler reads
 *   globalThis.__activeScriptContext__ (set by ScriptContext.customRequire before native require)
 */
class ScriptEngine {
    compile(script: string): CompiledScript {
        // Check if script contains statement keywords at the start
        const trimmedScript = script.trim();
        const statementKeywords =
            /^(const|let|var|if|for|while|do|switch|function|class|try|throw|return)\s/;
        const hasStatements = statementKeywords.test(trimmedScript);
        return { script, hasStatements };
    }

    /**
     * Execute a prepared (already transpiled) script string with a given context.
     * Context globals are injected via SCRIPT_PREFIX reading from `this` (context).
     * Handles expression/statement detection, implicit return, and async await.
     */
    async execute(compiled: CompiledScript, context: ScriptContext): Promise<unknown> {
        const { script, hasStatements } = compiled;
        if (!hasStatements) {
            // Try as expression first (for simple cases like "5 + 5" or "'hello'")
            const expressionScript = `return (async function() {\n${SCRIPT_PREFIX}return (${script});\n}).call(this);`;

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

        // If there's a top-level return statement, use as-is
        if (this.hasTopLevelReturn(script)) {
            return `return (async function() {\n${SCRIPT_PREFIX}${script}\n}).call(this);`;
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
            return `return (async function() {\n${SCRIPT_PREFIX}${beforeLast}\nreturn (${lastLine});\n}).call(this);`;
        } else if (!isStatement && !isBlockCloser && lastLine && lastLine.endsWith(";")) {
            // Remove trailing semicolon and return
            const beforeLast = lines.slice(0, -1).join("\n");
            const expressionPart = lastLine.slice(0, -1);
            return `return (async function() {\n${SCRIPT_PREFIX}${beforeLast}\nreturn (${expressionPart});\n}).call(this);`;
        }

        // If the last line is a statement/block but has a trailing expression after the
        // last '}', extract it as the return value.
        // e.g., "function foo() { return 1; } foo();" → return foo()
        if ((isStatement || isBlockCloser) && /\}\s*\S/.test(lastLine)) {
            const lastBraceIdx = lastLine.lastIndexOf("}");
            const trailing = lastLine.substring(lastBraceIdx + 1).trim().replace(/;$/, "").trim();
            if (trailing &&
                !/^[}\]]/.test(trailing) &&
                !/^(const|let|var|if|for|while|do|switch|function|class|try|throw|return)\s/.test(trailing)
            ) {
                const declPart = lines.slice(0, -1).join("\n") +
                    (lines.length > 1 ? "\n" : "") +
                    lastLine.substring(0, lastBraceIdx + 1);
                return `return (async function() {\n${SCRIPT_PREFIX}${declPart}\nreturn (${trailing});\n}).call(this);`;
            }
        }

        // Default: execute as-is (will return undefined)
        return `return (async function() {\n${SCRIPT_PREFIX}${script}\n}).call(this);`;
    }

    /**
     * Check if a value is a genuine Promise-like object (not just any object with a .then method).
     * StyledLogBuilder has a .then() method for chaining styled text segments — it is NOT a Promise.
     */
    private isPromiseLike(value: unknown): boolean {
        if (value instanceof Promise) return true;
        if (!value || typeof value !== "object") return false;
        const v = value as { then?: unknown; catch?: unknown };
        return typeof v.then === "function" && typeof v.catch === "function";
    }

    /** Check if script has a top-level `return` (not inside a function/arrow body). */
    private hasTopLevelReturn(script: string): boolean {
        if (!/\breturn\b/.test(script)) return false;

        let funcDepth = 0;
        const tokens = script.match(
            /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b(?:return|function)\b|=>|\{|\}/g
        ) || [];

        let expectFuncBody = false;
        for (const token of tokens) {
            if (token.startsWith("//") || token.startsWith("/*") ||
                token.startsWith("'") || token.startsWith('"') || token.startsWith("`")) {
                continue;
            }
            if (token === "function") { expectFuncBody = true; continue; }
            if (token === "=>") { expectFuncBody = true; continue; }
            if (token === "{") {
                if (expectFuncBody) funcDepth++;
                expectFuncBody = false;
            } else if (token === "}") {
                if (funcDepth > 0) funcDepth--;
                expectFuncBody = false;
            } else if (token === "return" && funcDepth === 0) {
                return true;
            } else {
                expectFuncBody = false;
            }
        }
        return false;
    }
}

export const scriptEngine = new ScriptEngine();
