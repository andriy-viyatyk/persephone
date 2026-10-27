import type * as monaco from "monaco-editor";
import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { app } from "../../api/app";
import { ui } from "../../api/ui";
import { uiPreferences } from "../../api/ui-preferences";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { errMessage } from "../../../shared/utils";
import { formatBytes } from "../../core/utils/format";
import { t } from "../../../shared/i18n/t";
import { TextTranslationProvider, type TranslationDescription, type TranslationPair, type TranslationProgress, type TranslationDownloadProgress, type TranslationOperation } from "./TextTranslationProvider";
import { buildTranslationBatches, createDetectionSample, createTranslationSpans, reconstructTranslation, selectTranslationSpans } from "./translate-text-segmentation";
import { registerDialogView } from "../dialogs/dialog-view-registry";
import { showDialog } from "../dialogs/Dialogs";
import { TranslateTextDialogView, type TranslateTextDialogModel, type TranslateTextDialogState, type TranslationChoice } from "./TranslateTextDialogView";
import type { MonacoEditor } from "../../editors/monaco/MonacoEditor";

const translateDialogId = Symbol("translateTextDialog");
const TARGET_PREFERENCE = "translation.text.lastTarget.v1";
type Mode = "selection" | "page";
type StartResult = { source: string; target: string };

interface Route { legs: TranslationPair[]; installed: boolean; missingBytes: number }
interface SourceSnapshot {
    pageId: string;
    title: string;
    language: string;
    content: string;
    selectionStart: number;
    selectionEnd: number;
    selection: string;
}


function displayName(code: string): string {
    try { return new Intl.DisplayNames([getActiveLocale()], { type: "language" }).of(code) || code; }
    catch { return code; }
}

function routeFor(pairs: TranslationPair[], from: string, to: string): Route | undefined {
    if (from === to) return undefined;
    const direct = pairs.find((pair) => pair.from === from && pair.to === to);
    const legs = direct ? [direct] : (() => {
        const first = pairs.find((pair) => pair.from === from && pair.to === "en");
        const second = pairs.find((pair) => pair.from === "en" && pair.to === to);
        return first && second ? [first, second] : undefined;
    })();
    if (!legs) return undefined;
    const missingBytes = legs.filter((leg) => !leg.installed).reduce((total, leg) => total + Math.max(0, leg.sizeBytes), 0);
    return { legs, installed: missingBytes === 0, missingBytes };
}

function sourceChoices(description: TranslationDescription, candidates: string[], detected: string): TranslationChoice[] {
    const names = new Map<string, TranslationChoice>();
    const detectedChoices = [...candidates, detected].filter(Boolean).filter((code, index, values) => values.indexOf(code) === index);
    const describedChoices = [...new Set([...description.pairs.filter((pair) => pair.to === "en").map((pair) => pair.from), "en"])]
        .filter((code) => !detectedChoices.includes(code))
        .sort((left, right) => displayName(left).localeCompare(displayName(right), getActiveLocale()));
    const order = [...detectedChoices, ...describedChoices];
    for (const code of order) {
        if (!code || names.has(code)) continue;
        names.set(code, { code, label: `${displayName(code)} (${code})`, installed: true, sizeBytes: 0 });
    }
    return [...names.values()];
}

function targetChoices(description: TranslationDescription, from: string): TranslationChoice[] {
    const languages = new Set(description.pairs.flatMap((pair) => [pair.from, pair.to]));
    return [...languages].flatMap((code) => {
        const route = routeFor(description.pairs, from, code);
        const name = `${displayName(code)} (${code})`;
        return route ? [{ code, label: route.installed ? name : t("translation.targetWithSize", { language: name, size: formatBytes(route.missingBytes) }), installed: route.installed, sizeBytes: route.missingBytes }] : [];
    }).sort((left, right) => Number(right.installed) - Number(left.installed) || left.label.localeCompare(right.label, getActiveLocale()));
}

class TranslateDialogModel extends TDialogModel<TranslateTextDialogState, "done" | undefined> implements TranslateTextDialogModel {
    private startedResolve: ((value: StartResult) => void) | undefined;
    readonly started = new Promise<StartResult>((resolve) => { this.startedResolve = resolve; });
    private readonly onSourceChange: (value: string) => TranslationChoice[];

    constructor(state: TranslateTextDialogState, onSourceChange: (value: string) => TranslationChoice[]) {
        super(new TComponentState(state));
        this.onSourceChange = onSourceChange;
    }

    setSource = (value: string): void => {
        const targets = this.onSourceChange(value);
        this.state.update((state) => {
            state.source = value;
            state.targetChoices = targets;
            if (!targets.some((item) => item.code === state.target)) state.target = "";
        });
    };
    setTarget = (value: string): void => this.state.update((state) => { state.target = value; });
    startTranslation = (): void => {
        const { source, target } = this.state.get();
        if (!source || !target || this.state.get().busy) return;
        this.state.update((state) => { state.busy = true; state.sourceEnabled = false; state.targetEnabled = false; });
        this.startedResolve?.({ source, target });
        this.startedResolve = undefined;
    };
    cancelTranslation = (): void => { void this.close(undefined); };
    setProgress = (patch: Partial<TranslateTextDialogState>): void => this.state.update((state) => Object.assign(state, patch));
}

registerDialogView(translateDialogId, TranslateTextDialogView);

export class TranslateTextPageController {
    private readonly provider = new TextTranslationProvider();
    private readonly getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
    private readonly sourceModel: () => MonacoEditor;
    private readonly onAvailability: (available: boolean) => void;
    private activeDialog: TranslateDialogModel | undefined;
    private selectedProvider: string | undefined;
    private disposed = false;

    public constructor(getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined, sourceModel: () => MonacoEditor, onAvailability: (available: boolean) => void) {
        this.getEditor = getEditor;
        this.sourceModel = sourceModel;
        this.onAvailability = onAvailability;
    }

    public get available(): boolean { return !!this.selectedProvider; }

    public async refreshProviders(): Promise<void> {
        try {
            const providers = await this.provider.list();
            this.selectedProvider = providers[0]?.provider;
        } catch {
            this.selectedProvider = undefined;
        }
        if (!this.disposed) this.onAvailability(this.available);
    }

    public async start(mode: Mode): Promise<void> {
        this.activeDialog = undefined;
        const snapshot = this.snapshot(mode);
        if (!snapshot) {
            if (mode === "selection") void ui.notify(t("translation.emptySelection"), "warning");
            return;
        }
        if (!this.selectedProvider) { void ui.notify(t("translation.noProvider"), "warning"); return; }
        const provider = this.selectedProvider;
        const scope = `translate-text:${snapshot.pageId}`;
        try {
            const description = await this.provider.describe(provider, scope).promise;
            const allSpans = createTranslationSpans(snapshot.content, snapshot.language);
            const spans = mode === "selection"
                ? selectTranslationSpans(allSpans, snapshot.selectionStart, snapshot.selectionEnd)
                : allSpans;
            const detectionSpans = mode === "selection"
                ? selectTranslationSpans(allSpans, snapshot.selectionStart, snapshot.selectionEnd)
                : allSpans;
            const sample = createDetectionSample(detectionSpans);
            let detected = "";
            let candidates: string[] = [];
            let detectionText = "";
            try {
                if (sample.trim()) {
                    const detection = await this.provider.detect(provider, sample, undefined, scope).promise;
                    detected = detection.language;
                    candidates = detection.candidates.map((item) => item.language);
                    detectionText = t("translation.detected", { language: `${displayName(detected)} (${detected})`, confidence: detection.confidence === "high" ? t("translation.high") : t("translation.low") });
                }
            } catch {
                detectionText = t("translation.detectionFailed");
                void ui.notify(t("translation.detectionFailed"), "warning");
            }
            const sources = sourceChoices(description, candidates, detected);
            const initialSource = detected || sources[0]?.code || "";
            const initialTargets = targetChoices(description, initialSource);
            const remembered = uiPreferences.readString(TARGET_PREFERENCE);
            const uiLanguage = getActiveLocale();
            const defaultTarget = remembered && initialTargets.some((item) => item.code === remembered)
                ? remembered
                : uiLanguage !== initialSource && initialTargets.some((item) => item.code === uiLanguage)
                    ? uiLanguage
                    : initialSource !== "en" && initialTargets.some((item) => item.code === "en") ? "en" : "";
            const model = new TranslateDialogModel({
                title: t("translation.dialogTitle"), sourceChoices: sources, targetChoices: initialTargets,
                source: initialSource, target: defaultTarget, detectionText, sourceEnabled: true, targetEnabled: true,
                progressVisible: false, progress: 0, progressMax: 0, progressText: "", busy: false,
            }, (from) => targetChoices(description, from));
            this.activeDialog = model;
            const dialogResult = showDialog<"done" | undefined>({ viewId: translateDialogId, model });
            let currentOperation: TranslationOperation<unknown> | undefined;
            let cancelled = false;
            void dialogResult.then((result) => {
                if (result === "done") return;
                cancelled = true;
                currentOperation?.cancel();
                this.provider.cancelScope(scope);
            });
            const chosen: { value: StartResult | undefined } = await Promise.race([
                model.started.then((value) => ({ value })),
                dialogResult.then((): { value: StartResult | undefined } => ({ value: undefined })),
            ]);
            if (!chosen.value || cancelled) return;
            uiPreferences.write(TARGET_PREFERENCE, chosen.value.target);
            let route = routeFor(description.pairs, chosen.value.source, chosen.value.target);
            if (!route) { model.cancelTranslation(); void ui.notify(t("translation.noRoute"), "warning"); return; }
            if (!route.installed) {
                const downloaded = await this.downloadRoute(model, provider, scope, chosen.value.source, chosen.value.target, route, (operation) => { currentOperation = operation; }, () => cancelled);
                if (!downloaded || cancelled) { if (!cancelled) model.cancelTranslation(); return; }
                route = routeFor(description.pairs, chosen.value.source, chosen.value.target) ?? route;
            }
            const translated = new Map<string, string>();
            let failed = 0;
            let done = 0;
            const batches = buildTranslationBatches(spans);
            const total = spans.length;
            model.setProgress({ progressVisible: true, progress: 0, progressMax: total, progressText: t("translation.translating", { done: 0, total }) });
            let retryNotReady = false;
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                if (cancelled) return;
                const operation = this.provider.translate(provider, {
                    id: `${snapshot.pageId}-${batchIndex}`, from: chosen.value.source, to: chosen.value.target,
                    priority: "visible", items: batch.map((item) => ({ ...item, format: "text" as const })),
                }, scope, (progress: TranslationProgress) => {
                    const completed = done + progress.done;
                    model.setProgress({ progress: completed, progressMax: total, progressText: t("translation.translating", { done: completed, total }) });
                });
                currentOperation = operation;
                try {
                    const result = await Promise.race([operation.promise, dialogResult.then(() => { throw Object.assign(new Error("cancelled"), { code: "cancelled" }); })]);
                    for (const item of result.items) {
                        if (item.ok) translated.set(item.key, item.text);
                        else failed++;
                    }
                    done += batch.length;
                    model.setProgress({ progress: done, progressMax: total, progressText: t("translation.translating", { done, total }) });
                } catch (error: unknown) {
                    const code = (error as { code?: unknown }).code;
                    if (code === "cancelled" || cancelled) return;
                    if (code === "not-ready" && !retryNotReady) {
                        retryNotReady = true;
                        const freshRoute = routeFor(description.pairs, chosen.value.source, chosen.value.target);
                        if (freshRoute && await this.downloadRoute(model, provider, scope, chosen.value.source, chosen.value.target, freshRoute, (op) => { currentOperation = op; }, () => cancelled)) {
                            batchIndex--;
                            continue;
                        }
                        if (!cancelled) model.cancelTranslation();
                        return;
                    }
                    throw error;
                }
            }
            if (cancelled) return;
            const selectedSource = mode === "selection" ? snapshot.selection : snapshot.content;
            const relativeSpans = mode === "selection"
                ? spans.map((span) => ({ ...span, start: span.start - snapshot.selectionStart, end: span.end - snapshot.selectionStart }))
                : spans;
            const content = reconstructTranslation(selectedSource, relativeSpans, translated);
            const languageName = displayName(chosen.value.target);
            app.pages.addEditorPage("monaco", snapshot.language, `${snapshot.title} (${languageName})`, content);
            if (failed) void ui.notify(t("translation.partialFailure", { count: failed }), "warning");
            model.close("done");
            this.activeDialog = undefined;
        } catch (error: unknown) {
            this.provider.cancelScope(scope);
            this.activeDialog?.cancelTranslation();
            void ui.notify(t("translation.translationFailed", { message: errMessage(error, t("translation.unknownError")) }), "warning");
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.provider.dispose();
        this.activeDialog?.cancelTranslation();
    }

    private snapshot(mode: Mode): SourceSnapshot | undefined {
        const editor = this.getEditor();
        const model = editor?.getModel();
        const sourceModel = this.sourceModel();
        const owner = sourceModel.page;
        if (!editor || !model || !owner || !sourceModel.host) return undefined;
        const content = model.getValue();
        const selection = editor.getSelection();
        const selectedText = selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
        if (mode === "selection" && !selectedText) return undefined;
        const language = model.getLanguageId();
        if (language !== "plaintext" && language !== "markdown") return undefined;
        const start = selection && !selection.isEmpty() ? model.getOffsetAt(selection.getStartPosition()) : 0;
        const end = selection && !selection.isEmpty() ? model.getOffsetAt(selection.getEndPosition()) : content.length;
        const title = sourceModel.title;
        return { pageId: owner.id, title, language, content, selectionStart: start, selectionEnd: end, selection: selectedText };
    }

    private async downloadRoute(
        model: TranslateDialogModel,
        provider: string,
        scope: string,
        from: string,
        to: string,
        route: Route,
        setOperation: (operation: TranslationOperation<unknown>) => void,
        isCancelled: () => boolean,
    ): Promise<boolean> {
        const answer = await ui.confirm(t("translation.downloadConsent", { size: formatBytes(route.missingBytes) }), {
            title: t("translation.dialogTitle"), buttons: [t("translation.download"), t("translation.cancel")],
        });
        if (answer !== t("translation.download") || isCancelled()) return false;
        let loaded = 0;
        let total = route.missingBytes;
        const operation = this.provider.download(provider, from, to, scope, (progress: TranslationDownloadProgress) => {
            loaded = progress.loadedBytes;
            total = progress.totalBytes;
            model.setProgress({ progressVisible: true, progress: loaded, progressMax: total, progressText: t("translation.downloading", { from: `${displayName(progress.leg.from)} (${progress.leg.from})`, to: `${displayName(progress.leg.to)} (${progress.leg.to})`, loaded: formatBytes(loaded), total: formatBytes(total) }) });
        });
        setOperation(operation);
        try {
            await operation.promise;
            model.setProgress({ progressVisible: false, progress: 0, progressMax: 0, progressText: "" });
            return true;
        } catch (error: unknown) {
            const code = (error as { code?: unknown }).code;
            if (code !== "cancelled") void ui.notify(t("translation.downloadFailed", { message: errMessage(error, "") }), "warning");
            return false;
        }
    }
}
