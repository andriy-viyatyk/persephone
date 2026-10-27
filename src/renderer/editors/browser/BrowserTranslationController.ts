import { errMessage } from "../../../shared/utils";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { t } from "../../../shared/i18n/t";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { TOneState } from "../../core/state/state";
import { getTextTranslationProvider, type TranslationDetection, type TranslationOperation } from "../../ui/translation/TextTranslationProvider";
import { downloadTranslationRoute, findTranslationRoute, languageDisplayName, resolveAppLocaleTarget, resolveModelLanguage } from "../../ui/translation/TranslationWorkflow";

// Browser detection bounds: the provider caps a detection sample at 4,096 code points.
// Detection runs on whatever rendered text the page has, up to the provider limit; short samples report low confidence.
const MIN_DETECTION_SAMPLE_CODE_POINTS = 20;
const MAX_DETECTION_SAMPLE_CODE_POINTS = 4096;

export interface BrowserTranslationTabState {
    available: boolean;
    active: boolean;
    from: string;
    to: string;
    candidates: string[];
    error?: string;
    progress?: string;
}

const INITIAL_TAB_STATE: BrowserTranslationTabState = { available: false, active: false, from: "", to: "", candidates: [] };

/** Owns toolbar translation workflow; page writes and restoration remain in US-1736. */
export class BrowserTranslationController {
    readonly state = new TOneState<Record<string, BrowserTranslationTabState>>({});
    private readonly provider = getTextTranslationProvider();
    private readonly editor: import("./BrowserEditor").BrowserEditor;
    private providerId: string | undefined;
    private refreshVersion = 0;
    private readonly generations = new Map<string, number>();
    private readonly operations = new Map<string, TranslationOperation<unknown>>();
    private readonly scopes = new Map<string, string>();

    public constructor(editor: import("./BrowserEditor").BrowserEditor) {
        this.editor = editor;
        void this.refreshAvailability();
    }

    public getTabState(tabId: string): BrowserTranslationTabState {
        return this.state.get()[tabId] ?? { ...INITIAL_TAB_STATE, available: !!this.providerId };
    }

    public refreshAvailability = async (): Promise<void> => {
        const version = ++this.refreshVersion;
        try {
            const providers = await this.provider.list();
            if (version !== this.refreshVersion) return;
            this.providerId = providers[0]?.provider;
            if (!this.providerId) {
                await this.stopAll();
                for (const tabId of Object.keys(this.state.get())) this.updateTab(tabId, { available: false, active: false });
            } else {
                for (const tabId of Object.keys(this.state.get())) this.updateTab(tabId, { available: true });
            }
            this.updateTab(this.editor.state.get().activeTabId, { available: !!this.providerId, ...(!this.providerId ? { active: false } : {}) });
        } catch (error: unknown) {
            if (version !== this.refreshVersion) return;
            this.providerId = undefined;
            await this.stopAll();
            this.updateTab(this.editor.state.get().activeTabId, { available: false, active: false, error: errMessage(error) });
        }
    };

    public toggle = async (tabId = this.editor.state.get().activeTabId): Promise<void> => {
        const tabState = this.getTabState(tabId);
        if (tabState.active) { await this.stop(tabId); return; }
        await this.activate(tabId);
    };

    public correctSource = async (tabId: string, from: string): Promise<void> => {
        if (this.getTabState(tabId).active) await this.editor.webview.stopPageTranslation(tabId);
        this.updateTab(tabId, { from, error: undefined });
        await this.activate(tabId, from);
    };

    /** A cross-document navigation invalidates operations and leaves the new document untranslated. */
    public onPageNavigation = (tabId: string): void => {
        this.invalidate(tabId);
        this.updateTab(tabId, { ...INITIAL_TAB_STATE, available: !!this.providerId });
    };

    public dispose(): void {
        for (const tabId of this.scopes.keys()) this.invalidate(tabId);
    }

    private async activate(tabId: string, correctedFrom?: string): Promise<void> {
        this.invalidate(tabId);
        const generation = (this.generations.get(tabId) ?? 0) + 1;
        this.generations.set(tabId, generation);
        const scope = `browser-translate-ui:${tabId}:${generation}`;
        this.scopes.set(tabId, scope);
        this.updateTab(tabId, { active: false, error: undefined });
        try {
            const providers = await this.provider.list();
            if (!this.isCurrent(tabId, generation)) return;
            const providerId = providers[0]?.provider;
            this.providerId = providerId;
            this.updateTab(tabId, { available: !!providerId });
            if (!providerId) { void ui.notify(t("translation.noProvider"), "warning"); return; }

            const descriptionOperation = this.provider.describe(providerId, scope);
            this.operations.set(tabId, descriptionOperation as TranslationOperation<unknown>);
            const description = await descriptionOperation.promise;
            if (!this.isCurrent(tabId, generation)) return;

            // Read before the page agent starts, so the sample is the original text.
            const sample = await this.readDetectionSample(tabId);
            const htmlLang = this.usableLanguage(sample.lang) ? sample.lang : "";
            let detection: TranslationDetection | undefined;
            if (Array.from(sample.text).length >= MIN_DETECTION_SAMPLE_CODE_POINTS) {
                const detectionOperation = this.provider.detect(providerId, Array.from(sample.text).slice(0, MAX_DETECTION_SAMPLE_CODE_POINTS).join(""), htmlLang || undefined, scope);
                this.operations.set(tabId, detectionOperation as TranslationOperation<unknown>);
                try { detection = await detectionOperation.promise; }
                catch { /* html lang and the source picker remain available when detection fails */ }
            }
            if (!this.isCurrent(tabId, generation)) return;

            const supported = [...new Set(description.pairs.map((pair) => pair.from))];
            const from = correctedFrom || this.chooseSource(resolveModelLanguage(htmlLang, supported), resolveModelLanguage(detection?.language, supported), detection?.confidence);
            const candidates = [...new Set([...(detection?.candidates.map((candidate) => candidate.language) ?? []), ...supported])];
            if (!from) {
                this.updateTab(tabId, { from: "", candidates, available: true });
                return;
            }

            const targetSetting = settings.get<string>("browser-translate-target");
            const to = targetSetting === "app" ? resolveAppLocaleTarget(getActiveLocale(), description) : targetSetting;
            if (from === to) {
                this.updateTab(tabId, { from, to, candidates, active: false });
                void ui.notify(t("translation.alreadyInLanguage", { language: languageDisplayName(to) }), "info");
                return;
            }
            const route = findTranslationRoute(description.pairs, from, to);
            if (!route) {
                this.updateTab(tabId, { from, to, candidates, active: false });
                void ui.notify(t("translation.noRoute"), "warning");
                return;
            }
            if (!route.installed) {
                const downloaded = await downloadTranslationRoute(
                    this.provider, providerId, scope, from, to, route, t("translation.pageDialogTitle"),
                    (progress) => this.updateTab(tabId, { progress: progress.text }),
                    (operation) => this.operations.set(tabId, operation),
                    () => !this.isCurrent(tabId, generation),
                );
                if (!downloaded || !this.isCurrent(tabId, generation)) {
                    if (this.isCurrent(tabId, generation)) this.updateTab(tabId, { progress: undefined });
                    return;
                }
            }

            await this.editor.webview.startPageTranslation(from, to, tabId);
            if (!this.isCurrent(tabId, generation)) { await this.editor.webview.stopPageTranslation(tabId); return; }
            this.updateTab(tabId, { active: true, from, to, candidates, available: true, error: undefined, progress: undefined });
        } catch (error: unknown) {
            if (!this.isCurrent(tabId, generation)) return;
            const message = errMessage(error);
            this.updateTab(tabId, { active: false, error: message, progress: undefined });
            void ui.notify(t("translation.operationFailed", { message }), "error");
            await this.editor.webview.stopPageTranslation(tabId);
            await this.refreshAvailability();
        } finally {
            this.operations.delete(tabId);
        }
    }

    private async stop(tabId: string): Promise<void> {
        this.invalidate(tabId);
        await this.editor.webview.stopPageTranslation(tabId);
        this.updateTab(tabId, { active: false, error: undefined });
    }

    private invalidate(tabId: string): void {
        this.generations.set(tabId, (this.generations.get(tabId) ?? 0) + 1);
        this.operations.get(tabId)?.cancel();
        this.operations.delete(tabId);
        const scope = this.scopes.get(tabId);
        if (scope) this.provider.cancelScope(scope);
        this.scopes.delete(tabId);
    }

    private async stopAll(): Promise<void> {
        for (const tabId of this.scopes.keys()) await this.stop(tabId);
    }

    private isCurrent(tabId: string, generation: number): boolean { return this.generations.get(tabId) === generation; }

    private updateTab(tabId: string, patch: Partial<BrowserTranslationTabState>): void {
        this.state.update((states) => { states[tabId] = { ...(states[tabId] ?? INITIAL_TAB_STATE), ...patch }; });
    }

    /** Both inputs are already resolved to provider source codes ("" when unsupported). */
    private chooseSource(htmlLang: string, detected: string, confidence: TranslationDetection["confidence"] | undefined): string {
        if (confidence === "high" && detected && detected !== htmlLang) return detected;
        return htmlLang || detected;
    }

    private usableLanguage(language: string | undefined): language is string {
        return !!language && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language);
    }

    private async readDetectionSample(tabId: string): Promise<{ lang: string; text: string }> {
        const webview = this.editor.webview.webviewRefs.get(tabId);
        if (!webview) return { lang: "", text: "" };
        try {
            const value = await webview.executeJavaScript(`({ lang: document.documentElement?.getAttribute("lang") || "", text: (document.body?.innerText || "").slice(0, ${MAX_DETECTION_SAMPLE_CODE_POINTS * 2}) })`) as { lang?: unknown; text?: unknown };
            return { lang: typeof value?.lang === "string" ? value.lang : "", text: typeof value?.text === "string" ? value.text.replace(/\s+/g, " ").trim() : "" };
        } catch { return { lang: "", text: "" }; }
    }
}
