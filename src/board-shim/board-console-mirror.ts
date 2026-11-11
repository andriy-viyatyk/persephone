import { errMessage } from "../shared/utils";
import type { BoardToHostEvents } from "../ipc/board-bridge/frame-protocol";

/** Install diagnostics that the board frame reports to its host renderer. */
export function installBoardDiagnostics(emit: <E extends "error" | "log">(name: E, payload: BoardToHostEvents[E]) => void): void {
    const postHostError = (message: string): void => {
        try {
            emit("error", { message });
        } catch {
            // parent gone — nothing to report to
        }
    };

    document.addEventListener("securitypolicyviolation", (event) => {
        postHostError(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "(inline)"}`);
    });
    window.addEventListener("error", (event) => {
        postHostError(`script error: ${event.message}${event.filename ? ` (${event.filename}:${event.lineno})` : ""}`);
    });
    window.addEventListener("unhandledrejection", (event) => {
        postHostError(`unhandled rejection: ${errMessage((event as PromiseRejectionEvent).reason)}`);
    });

    const formatConsoleArg = (arg: unknown): string => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try { return JSON.stringify(arg); } catch { return String(arg); }
    };
    const mirrorConsole = (level: "warn" | "error"): void => {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            try {
                const message = args.map(formatConsoleArg).join(" ").slice(0, 4000);
                emit("log", { level, message: `console.${level}: ${message}` });
            } catch { /* parent gone */ }
        };
    };
    mirrorConsole("warn");
    mirrorConsole("error");
}
