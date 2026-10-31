import * as monaco from "monaco-editor";
import { errMessage } from "../../../shared/utils";

// Per-page TypeScript error highlighting (US-1744). Global diagnostics stay off; this asks the TS worker
// for syntactic + semantic diagnostics of one model and sets Persephone-owned markers.

// ── Tuning constants ─────────────────────────────────────────────────────────
/** Debounce after a content change or extra-lib change, as Monaco's own adapter does. */
const DIAGNOSTICS_DEBOUNCE_MS = 500;
/** Marker owner; Monaco's built-in adapter uses "typescript". */
const MARKER_OWNER = "persephone-ts";

interface WorkerDiagnostic {
    start?: number;
    length?: number;
    category: number;
    code: number;
    messageText: string | DiagnosticMessageChain;
    reportsUnnecessary?: unknown;
    reportsDeprecated?: unknown;
}

interface DiagnosticMessageChain {
    messageText: string;
    next?: DiagnosticMessageChain[];
}

function flattenMessage(message: string | DiagnosticMessageChain, indent = 0): string {
    if (typeof message === "string") return message;
    let result = "";
    if (indent) result += "\n" + "  ".repeat(indent);
    result += message.messageText;
    for (const next of message.next ?? []) result += flattenMessage(next, indent + 1);
    return result;
}

function severityOf(category: number): monaco.MarkerSeverity {
    switch (category) {
        case 0: return monaco.MarkerSeverity.Warning;
        case 1: return monaco.MarkerSeverity.Error;
        case 2: return monaco.MarkerSeverity.Hint;
        default: return monaco.MarkerSeverity.Info;
    }
}

function toMarker(model: monaco.editor.ITextModel, diagnostic: WorkerDiagnostic): monaco.editor.IMarkerData | undefined {
    if (diagnostic.start === undefined) return undefined;
    const start = model.getPositionAt(diagnostic.start);
    const end = model.getPositionAt(diagnostic.start + (diagnostic.length ?? 0));
    const tags: monaco.MarkerTag[] = [];
    if (diagnostic.reportsUnnecessary) tags.push(monaco.MarkerTag.Unnecessary);
    if (diagnostic.reportsDeprecated) tags.push(monaco.MarkerTag.Deprecated);
    return {
        severity: severityOf(diagnostic.category),
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        message: flattenMessage(diagnostic.messageText),
        code: String(diagnostic.code),
        tags,
    };
}

/** Start highlighting TypeScript errors on `model`; dispose to clear the markers. */
export function attachDiagnostics(model: monaco.editor.ITextModel): monaco.IDisposable {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;

    const clearMarkers = (): void => {
        if (!model.isDisposed()) monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    };

    const run = async (): Promise<void> => {
        const requestGeneration = ++generation;
        const versionId = model.getVersionId();
        const uri = model.uri.toString();
        try {
            const worker = await (await monaco.typescript.getTypeScriptWorker())(model.uri);
            const [syntactic, semantic] = await Promise.all([
                worker.getSyntacticDiagnostics(uri),
                worker.getSemanticDiagnostics(uri),
            ]);
            if (disposed || model.isDisposed() || requestGeneration !== generation || model.getVersionId() !== versionId) return;
            const markers = [...syntactic, ...semantic]
                .map((diagnostic) => toMarker(model, diagnostic as WorkerDiagnostic))
                .filter((marker): marker is monaco.editor.IMarkerData => !!marker);
            monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
        } catch (error: unknown) {
            console.warn(`TypeScript diagnostics failed: ${errMessage(error)}`);
        }
    };

    const schedule = (delay = DIAGNOSTICS_DEBOUNCE_MS): void => {
        if (disposed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            void run();
        }, delay);
    };

    const contentSubscription = model.onDidChangeContent(() => schedule());
    const libsSubscription = monaco.typescript.typescriptDefaults.onDidExtraLibsChange(() => schedule());
    schedule(0);

    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            if (timer) clearTimeout(timer);
            contentSubscription.dispose();
            libsSubscription.dispose();
            clearMarkers();
        },
    };
}
