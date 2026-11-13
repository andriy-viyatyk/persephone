import type { AgentTipCollector } from "./ai-vision/agent-tip-collector";
import type { EditorModelInstance as EditorModel } from "../editors/base";
import { pages } from "../api/pages";
import type { ConsoleLogEntry, ScriptOutputFlags } from "./ScriptContext";
import { settings } from "../api/settings";
import { convertToText } from "./script-utils";
import { ScriptRunnerBase } from "./ScriptRunnerBase";
import { t } from "../../shared/i18n/t";

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
class ScriptRunner extends ScriptRunnerBase {
    handlePromiseException = 0;

    /**
     * MCP mode — creates context, captures console, cleans up, returns structured result.
     */
    runWithCapture = async (script: string, page?: EditorModel, language?: string, tipCollector?: AgentTipCollector): Promise<McpScriptResult> => {
        const consoleLogs: ConsoleLogEntry[] = [];
        const result = await this.executeWithContext(script, page, consoleLogs, language, tipCollector);
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
        pageId: string,
        script: string,
        page?: EditorModel,
        language?: string,
    ): Promise<string> => {
        const { result, outputFlags } = await this.executeWithContextAndFlags(script, page, undefined, language);
        const isError = result instanceof Error;
        const outputSuppressed = outputFlags.outputPrevented || outputFlags.groupedContentWritten;
        const textAndLang = convertToText(result);

        if (outputSuppressed && isError) {
            import("../ui/dialogs/TextDialog").then(({ showTextDialog }) => {
                showTextDialog({
                    title: t("api.scriptErrorTitle"),
                    text: textAndLang.text,
                });
            });
        } else if (!outputSuppressed && pageId) {
            const groupedModel = pages.layout.requireGroupedText(pageId, textAndLang.language);
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
        page?: EditorModel,
        consoleLogs?: ConsoleLogEntry[],
        language?: string,
        tipCollector?: AgentTipCollector,
    ): Promise<unknown> {
        const { result } = await this.executeWithContextAndFlags(script, page, consoleLogs, language, tipCollector);
        return result;
    }

    /**
     * Execute script with auto-created context. Disposes context on completion.
     * Returns result + outputFlags (needed by runWithResult).
     */
    private async executeWithContextAndFlags(
        script: string,
        page?: EditorModel,
        consoleLogs?: ConsoleLogEntry[],
        language?: string,
        tipCollector?: AgentTipCollector,
    ): Promise<{ result: unknown; outputFlags: ScriptOutputFlags }> {
        this.handlePromiseException += 1;
        let scriptContext: import("./ScriptContext").ScriptContext | undefined;
        try {
            const contextModule = await import("./ScriptContext");
            const libraryPath = settings.get("script-library.path") as string | undefined;
            scriptContext = new contextModule.ScriptContext(page, consoleLogs, libraryPath, { tipCollector });

            const result = await this.execute(script, scriptContext, language);
            return { result, outputFlags: scriptContext.outputFlags };
        } catch (error) {
            return {
                result: error instanceof Error ? error : new Error(String(error)),
                outputFlags: scriptContext?.outputFlags ?? { outputPrevented: false, groupedContentWritten: false },
            };
        } finally {
            scriptContext?.dispose();
            setTimeout(() => {
                this.handlePromiseException -= 1;
            }, 1000);
        }
    }
}

export const scriptRunner = new ScriptRunner();
