import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { errMessage } from "../../../shared/utils";
import { formatBytes } from "../../core/utils/format";
import { ui } from "../../api/ui";
import { t } from "../../../shared/i18n/t";
import type { TextTranslationProvider, TranslationDescription, TranslationDownloadProgress, TranslationOperation, TranslationPair } from "./TextTranslationProvider";

export interface TranslationRoute { legs: TranslationPair[]; installed: boolean; missingBytes: number }
export function languageDisplayName(code: string): string {
    try { return new Intl.DisplayNames([getActiveLocale()], { type: "language" }).of(code) || code; }
    catch { return code; }
}
// Legacy or region-specific tags that map to a different model code than their primary subtag.
const LANGUAGE_ALIASES: Record<string, string> = { iw: "he", in: "id", ji: "yi", no: "nb" };
const TRADITIONAL_CHINESE_REGIONS = new Set(["tw", "hk", "mo"]);

/** Maps a BCP-47 tag such as "it-IT", "zh-TW" or "iw" to a code the provider supports, or "" when none fits. */
export function resolveModelLanguage(tag: string | undefined, supported: Iterable<string>): string {
    if (!tag) return "";
    const codes = [...supported];
    const find = (code: string): string => codes.find((item) => item.toLowerCase() === code.toLowerCase()) || "";
    const exact = find(tag);
    if (exact) return exact;
    const parts = tag.toLowerCase().split(/[-_]/);
    if (parts[0] === "zh") {
        const traditional = parts.includes("hant") || parts.slice(1).some((part) => TRADITIONAL_CHINESE_REGIONS.has(part));
        return find(traditional ? "zh-Hant" : "zh-Hans") || find("zh");
    }
    const primary = LANGUAGE_ALIASES[parts[0]] ?? parts[0];
    return find(primary) || codes.find((item) => item.split("-")[0].toLowerCase() === primary) || "";
}
export function findTranslationRoute(pairs: TranslationPair[], from: string, to: string): TranslationRoute | undefined {
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
export function resolveAppLocaleTarget(locale: string, description: TranslationDescription): string {
    const targets = new Set(description.pairs.map((pair) => pair.to));
    if (targets.has(locale)) return locale;
    const primary = locale.split("-")[0];
    return [...targets].find((target) => target.split("-")[0] === primary) || "en";
}

export async function downloadTranslationRoute(
    providerClient: TextTranslationProvider,
    provider: string,
    scope: string,
    from: string,
    to: string,
    route: TranslationRoute,
    title: string,
    onProgress: (progress: { loaded: number; total: number; text: string }) => void,
    setOperation: (operation: TranslationOperation<unknown>) => void,
    isCancelled: () => boolean,
): Promise<boolean> {
    const answer = await ui.confirm(t("translation.downloadConsent", { size: formatBytes(route.missingBytes) }), {
        title, buttons: [t("translation.download"), t("translation.cancel")],
    });
    if (answer !== t("translation.download") || isCancelled()) return false;
    const operation = providerClient.download(provider, from, to, scope, (progress: TranslationDownloadProgress) => {
        onProgress({
            loaded: progress.loadedBytes,
            total: progress.totalBytes,
            text: t("translation.downloading", {
                from: `${languageDisplayName(progress.leg.from)} (${progress.leg.from})`,
                to: `${languageDisplayName(progress.leg.to)} (${progress.leg.to})`,
                loaded: formatBytes(progress.loadedBytes), total: formatBytes(progress.totalBytes),
            }),
        });
    });
    setOperation(operation);
    try {
        await operation.promise;
        return true;
    } catch (error: unknown) {
        const code = (error as { code?: unknown }).code;
        if (code !== "cancelled") void ui.notify(t("translation.downloadFailed", { message: errMessage(error, "") }), "warning");
        return false;
    }
}
