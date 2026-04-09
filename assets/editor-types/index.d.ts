/* eslint-disable no-var */
import type { IApp } from "./app";
import type { IPage } from "./page";
import type { IUiLog, IStyledTextBuilder } from "./ui-log";
import type { IIoNamespace } from "./io";
import type { IAiNamespace } from "./ai";

declare global {
    /** The application object. Access all app functionality through this. */
    const app: IApp;

    /** The active page. Available in scripts that run in context of a page. */
    const page: IPage | undefined;

    /**
     * Log View UI facade. Lazy-initialized on first access.
     * Provides logging methods and interactive dialogs in a Log View page.
     *
     * @example
     * ui.log("Hello!");
     * const result = await ui.dialog.confirm("Continue?");
     */
    const ui: IUiLog;

    /**
     * Content pipe building: providers, transformers, assembly, and link events.
     *
     * @example
     * const pipe = io.createPipe(new io.FileProvider("C:\\data.json"));
     * const text = await pipe.readText();
     */
    const io: IIoNamespace;

    /**
     * AI model integrations. Create Claude sessions for conversations, tool use, and automation.
     *
     * @example
     * const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });
     * session.userMessage("Hello!");
     * const reply = await session.send();
     */
    const ai: IAiNamespace;

    /**
     * Import a module. Use `require("library/...")` to load modules from the script library.
     *
     * @example
     * const { greet } = require("library/utils/helpers");
     * const config = require("library/config");
     */
    function require(id: string): any;

    /** Prevent script output from being written to the grouped page. */
    function preventOutput(): void;

    /**
     * Create a styled text builder for use in dialog labels and other components.
     *
     * @example
     * const label = styledText("Warning").color("red").bold().value;
     * await ui.dialog.confirm(label);
     *
     * @example
     * await ui.dialog.buttons([
     *     styledText("Accept").color("lime").value,
     *     styledText("Reject").color("red").value,
     * ]);
     */
    function styledText(text: string): IStyledTextBuilder;
}

export {};
