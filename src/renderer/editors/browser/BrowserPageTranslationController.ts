import type { TranslationActivationMessage, TranslationDetectionSampleMessage, TranslationFrameScope, TranslationResultMessage, TranslationUnit, TranslationUnitsMessage } from "../../../ipc/browser-translation-messages";
import { errMessage } from "../../../shared/utils";
import { getTextTranslationProvider, type TranslationPriority } from "../../ui/translation/TextTranslationProvider";

// Page scheduling bounds: keep this tab below the provider's shared four-channel window.
const MAX_BATCH_ITEMS = 32;
const MAX_BATCH_CODE_POINTS = 64_000;
const MAX_IN_FLIGHT_BATCHES = 4;
const PRIORITY_ORDER: TranslationPriority[] = ["visible", "near", "background"];

type FrameKey = string;
interface FrameState { frameId: [number, number]; scope: TranslationFrameScope; tuple: string }
interface QueuedUnit { frameKey: FrameKey; frame: FrameState; unit: TranslationUnit }

export interface BrowserPageTranslationState { active: boolean; from: string; to: string; pendingCount: number; doneCount: number; failedCount: number; lastError?: string }

export class BrowserPageTranslationController {
    private readonly provider = getTextTranslationProvider();
    private readonly tabId: string;
    private readonly getWebview: () => Electron.WebviewTag | undefined;
    private readonly frames = new Map<FrameKey, FrameState>();
    private readonly currentFrameByTuple = new Map<string, FrameKey>();
    private readonly queue = new Map<string, QueuedUnit>();
    private readonly latestRevisions = new Map<string, number>();
    private readonly detectionSamples = new Map<string, TranslationDetectionSampleMessage>();
    private providerId: string | undefined;
    private scope = "";
    private active = false;
    private from = "";
    private to = "";
    private requestId = 0;
    private lifecycleVersion = 0;
    private inFlight = 0;
    private doneCount = 0;
    private failedCount = 0;
    private lastError: string | undefined;
    private readonly stateListeners = new Set<() => void>();

    constructor(tabId: string, getWebview: () => Electron.WebviewTag | undefined) { this.tabId = tabId; this.getWebview = getWebview; }

    get state(): BrowserPageTranslationState {
        return { active: this.active, from: this.from, to: this.to, pendingCount: this.queue.size + this.inFlight, doneCount: this.doneCount, failedCount: this.failedCount, lastError: this.lastError };
    }

    subscribe(listener: () => void): () => void {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }

    private notifyStateChanged(): void {
        for (const listener of this.stateListeners) listener();
    }

    /** Latest sample is retained per frame; US-1737 consumes the top frame's value. */
    get latestDetectionSample(): TranslationDetectionSampleMessage | undefined {
        return this.detectionSamples.values().next().value as TranslationDetectionSampleMessage | undefined;
    }

    async start(from: string, to: string): Promise<void> {
        await this.stop();
        const lifecycleVersion = this.lifecycleVersion;
        const providers = await this.provider.list();
        if (lifecycleVersion !== this.lifecycleVersion) return;
        this.providerId = providers[0]?.provider;
        if (!this.providerId) throw new Error("No trusted text translation provider is available.");
        this.scope = `browser-translation:${this.tabId}:${Date.now()}:${++this.requestId}`;
        this.from = from; this.to = to; this.active = true; this.doneCount = 0; this.failedCount = 0; this.lastError = undefined;
        for (const [key, frame] of this.frames) this.sendActivation(key, frame, true);
        this.pump();
        this.notifyStateChanged();
    }

    async stop(clearFrames = false): Promise<void> {
        this.lifecycleVersion++;
        this.active = false;
        if (this.scope) this.provider.cancelScope(this.scope);
        this.queue.clear(); this.latestRevisions.clear(); this.inFlight = 0;
        for (const [key, frame] of this.frames) this.sendActivation(key, frame, false);
        this.scope = "";
        if (clearFrames) { this.frames.clear(); this.currentFrameByTuple.clear(); this.detectionSamples.clear(); }
        this.notifyStateChanged();
    }

    dispose(): void { void this.stop(true); }

    handleFrame(frameId: [number, number], kind: "translation-ready" | "translation-units" | "translation-detection-sample", payload: unknown): void {
        if (kind === "translation-detection-sample") {
            const sample = payload as TranslationDetectionSampleMessage;
            if (!sample?.scope?.document || typeof sample.text !== "string") return;
            const key = this.registerFrame(frameId, sample.scope);
            this.detectionSamples.set(key, sample);
            this.notifyStateChanged();
            return;
        }
        const message = payload as TranslationUnitsMessage;
        if (!message?.scope?.document || (kind === "translation-units" && !Array.isArray(message.items))) return;
        const key = this.registerFrame(frameId, message.scope);
        const frame = this.frames.get(key)!;
        if (kind === "translation-ready") { if (this.active) this.sendActivation(key, frame, true); return; }
        if (!this.active || !this.providerId) return;
        for (const unit of message.items) {
            if (!unit || typeof unit.key !== "string" || !Number.isInteger(unit.revision) || typeof unit.text !== "string") continue;
            const keyForUnit = `${key}\u0000${unit.key}`;
            const current = this.latestRevisions.get(keyForUnit) ?? -1;
            if (unit.revision < current) continue;
            this.latestRevisions.set(keyForUnit, unit.revision);
            this.queue.set(keyForUnit, { frameKey: key, frame, unit });
        }
        this.pump();
        this.notifyStateChanged();
    }

    private registerFrame(frameId: [number, number], scope: TranslationFrameScope): FrameKey {
        const tuple = `${frameId[0]}:${frameId[1]}`;
        const previousKey = this.currentFrameByTuple.get(tuple);
        const key = `${tuple}:${scope.document}`;
        if (previousKey && previousKey !== key) this.dropFrame(previousKey);
        this.currentFrameByTuple.set(tuple, key);
        this.frames.set(key, { frameId, scope, tuple });
        return key;
    }

    private pump(): void {
        while (this.active && this.providerId && this.inFlight < MAX_IN_FLIGHT_BATCHES && this.queue.size) {
            const ordered = [...this.queue.entries()].sort((left, right) => PRIORITY_ORDER.indexOf(left[1].unit.priority) - PRIORITY_ORDER.indexOf(right[1].unit.priority));
            const batch: Array<[string, QueuedUnit]> = [];
            let codePoints = 0;
            for (const entry of ordered) {
                const length = Array.from(entry[1].unit.text).length;
                if (length > MAX_BATCH_CODE_POINTS) { this.queue.delete(entry[0]); continue; }
                if (batch.length >= MAX_BATCH_ITEMS || codePoints + length > MAX_BATCH_CODE_POINTS) continue;
                batch.push(entry); codePoints += length;
            }
            if (!batch.length) break;
            for (const [key] of batch) this.queue.delete(key);
            this.sendBatch(batch);
        }
    }

    private sendBatch(batch: Array<[string, QueuedUnit]>): void {
        const provider = this.providerId;
        const scope = this.scope;
        if (!provider || !scope) return;
        this.inFlight++;
        const priority = batch.reduce<TranslationPriority>((best, [, entry]) => PRIORITY_ORDER.indexOf(entry.unit.priority) < PRIORITY_ORDER.indexOf(best) ? entry.unit.priority : best, "background");
        const operation = this.provider.translate(provider, {
            id: `${++this.requestId}`, from: this.from, to: this.to, priority,
            // Unit keys are unique only within a frame, so the request uses the frame-qualified queue key.
            items: batch.map(([queueKey, entry]) => ({ key: queueKey, text: entry.unit.text, format: entry.unit.format })),
        }, scope);
        void operation.promise.then(async (result) => {
            if (!this.active || this.scope !== scope) return;
            const entries = new Map(batch);
            const byFrame = new Map<FrameKey, TranslationResultMessage["results"]>();
            for (const item of result.items) {
                const entry = entries.get(item.key);
                if (!entry || this.latestRevisions.get(item.key) !== entry.unit.revision) continue;
                if (item.ok === true) this.doneCount++;
                else { this.failedCount++; this.lastError = item.error.message; }
                const resultItem = { key: entry.unit.key, revision: entry.unit.revision, ...(item.ok ? { text: item.text } : {}) };
                byFrame.set(entry.frameKey, [...(byFrame.get(entry.frameKey) || []), resultItem]);
            }
            for (const [frameKey, frameResults] of byFrame) {
                const frame = this.frames.get(frameKey);
                if (!frame) continue;
                try { await this.getWebview()?.sendToFrame(frame.frameId, "browser:translation-result", { scope: frame.scope, results: frameResults } satisfies TranslationResultMessage); }
                catch { this.dropFrame(frameKey); }
            }
            this.notifyStateChanged();
        }).catch((error: unknown): void => {
            if (this.scope !== scope) return;
            this.failedCount += batch.length;
            this.lastError = errMessage(error);
            this.notifyStateChanged();
        }).finally(() => {
            this.inFlight = Math.max(0, this.inFlight - 1);
            this.pump();
            this.notifyStateChanged();
        });
    }

    private dropFrame(key: FrameKey): void {
        const frame = this.frames.get(key);
        this.frames.delete(key); this.detectionSamples.delete(key);
        for (const [unitKey, queued] of this.queue) if (queued.frameKey === key) this.queue.delete(unitKey);
        for (const unitKey of this.latestRevisions.keys()) if (unitKey.startsWith(`${key}\u0000`)) this.latestRevisions.delete(unitKey);
        if (frame && this.currentFrameByTuple.get(frame.tuple) === key) this.currentFrameByTuple.delete(frame.tuple);
    }

    private sendActivation(key: FrameKey, frame: FrameState, active: boolean): void {
        const message: TranslationActivationMessage = { active, from: this.from, to: this.to };
        this.getWebview()?.sendToFrame(frame.frameId, "browser:translation-activate", message).catch((): void => { this.dropFrame(key); });
    }
}
