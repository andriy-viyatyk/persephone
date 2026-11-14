import type { AgentTipCollector } from "./ai-vision/agent-tip-collector";
import type { EditorModelInstance as EditorModel } from "../editors/base";
import { pages } from "../api/pages";
import type { ConsoleLogEntry, ScriptOutputFlags } from "./ScriptContext";
import { settings } from "../api/settings";
import { convertToText } from "./script-utils";
import { scriptEngine } from "./script-engine";
import { scriptLibrary } from "./ScriptLibrary";
import { t } from "../../shared/i18n/t";
import { ui } from "../api/ui";

const SCRIPT_REJECTION_GRACE_MS = 1000;

export interface McpScriptResult {
    text: string;
    language: string;
    consoleLogs: ConsoleLogEntry[];
    isError: boolean;
}

/**
 * Script execution orchestrator. Provides multiple entry points for different
 * execution modes (simple, MCP capture, UI result). Each creates a ScriptContext,
 * executes the script, handles the result, and disposes the context.
 */
class ScriptRunner {
    private activeRunCount = 0;

    /** True while a run is in progress and for `SCRIPT_REJECTION_GRACE_MS` after each run ends. */
    get inRejectionWindow(): boolean {
        return this.activeRunCount > 0;
    }

    /**
     * MCP mode — creates context, captures console, cleans up, returns structured result.
     */
    runWithCapture = async (script: string, page?: EditorModel, language?: string, tipCollector?: AgentTipCollector): Promise<McpScriptResult> => {
        const consoleLogs: ConsoleLogEntry[] = [];
        const result = await this.executeWithContext(script, "agent", page, consoleLogs, language, tipCollector);
        const isError = result instanceof Error;
        const textAndLang = convertToText(result);
        return {
            text: textAndLang.text,
            language: textAndLang.language,
            consoleLogs,
            isError,
        };
    };

    /**
     * UI mode — creates context, writes output to grouped page, cleans up.
     */
    runWithResult = async (
        script: string,
        page: EditorModel,
        language?: string,
    ): Promise<string> => {
        const { result, outputFlags } = await this.executeWithContextAndFlags(script, "user", page, undefined, language);
        const isError = result instanceof Error;
        const outputSuppressed = outputFlags.outputPrevented || outputFlags.groupedContentWritten;
        const textAndLang = convertToText(result);

        if (outputSuppressed && isError) {
            void ui.textDialog({
                title: t("api.scriptErrorTitle"),
                text: textAndLang.text,
            });
        } else if (!outputSuppressed && page.id) {
            const groupedModel = pages.layout.requireGroupedText(page.id, textAndLang.language);
            groupedModel.contentHost?.changeContent(textAndLang.text);
        }

        return textAndLang.text;
    };

    // -------------------------------------------------------------------------
    // Internal: context lifecycle management
    // -------------------------------------------------------------------------

    /**
     * Execute script with auto-created context. Disposes context on completion.
     * Returns the raw result.
     */
    private async executeWithContext(
        script: string,
        origin: "user" | "agent",
        page?: EditorModel,
        consoleLogs?: ConsoleLogEntry[],
        language?: string,
        tipCollector?: AgentTipCollector,
    ): Promise<unknown> {
        const { result } = await this.executeWithContextAndFlags(script, origin, page, consoleLogs, language, tipCollector);
        return result;
    }

    /**
     * Execute script with auto-created context. Disposes context on completion.
     * Returns result + outputFlags (needed by runWithResult).
     */
    private async executeWithContextAndFlags(
        script: string,
        origin: "user" | "agent",
        page?: EditorModel,
        consoleLogs?: ConsoleLogEntry[],
        language?: string,
        tipCollector?: AgentTipCollector,
    ): Promise<{ result: unknown; outputFlags: ScriptOutputFlags }> {
        this.activeRunCount += 1;
        let scriptContext: import("./ScriptContext").ScriptContext | undefined;
        try {
            // Keep this dynamic: ScriptContext -> AppWrapper -> ai-vision/root -> ScriptRunner.
            const contextModule = await import("./ScriptContext");
            const libraryPath = settings.get("script-library.path") as string | undefined;
            scriptContext = new contextModule.ScriptContext({ page, origin, consoleLogs, libraryPath, tipCollector });

            const prepared = await scriptLibrary.transpileIfNeeded(script, language);
            await scriptLibrary.prepare();
            const result = await scriptEngine.execute(scriptEngine.compile(prepared), scriptContext);
            return { result, outputFlags: scriptContext.outputFlags };
        } catch (error) {
            return {
                result: error instanceof Error ? error : new Error(String(error)),
                outputFlags: scriptContext?.outputFlags ?? { outputPrevented: false, groupedContentWritten: false },
            };
        } finally {
            scriptContext?.dispose();
            setTimeout(() => {
                this.activeRunCount -= 1;
            }, SCRIPT_REJECTION_GRACE_MS);
        }
    }
}

export const scriptRunner = new ScriptRunner();
