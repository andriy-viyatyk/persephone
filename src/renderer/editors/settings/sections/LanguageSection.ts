import { api } from "../../../../ipc/renderer/api";
import { settings, flushSettingsSave } from "../../../api/settings";
import { ui } from "../../../api/ui";
import { errMessage } from "../../../../shared/utils";
import { languageCompleteness } from "../../../../shared/i18n/language-completeness";
import { getActiveLocale } from "../../../../shared/i18n/active-locale";
import { resolveLocale } from "../../../../shared/i18n/resolve-locale";
import type { LanguagePack } from "../../../../shared/i18n/pack";
import { t } from "../../../../shared/i18n/t";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, panel, text } from "./settings-native";
import "../../../uikit/Select/Select.css";

interface LanguageOption extends Omit<IListBoxItem, "label"> {
    readonly nativeName: string;
    readonly englishName: string;
    readonly completeness: number;
}

function nativeLanguageName(code: string, fallback: string): string {
    try {
        return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? fallback;
    } catch {
        return fallback;
    }
}

function buildLanguageOptions(
    builtInPacks: readonly LanguagePack[],
    userPacks: readonly LanguagePack[],
    preferredLanguages: readonly string[],
): LanguageOption[] {
    const packsByCode = new Map<string, LanguagePack[]>();
    for (const pack of [...builtInPacks, ...userPacks]) {
        const code = pack.code.toLowerCase();
        const packs = packsByCode.get(code) ?? [];
        packs.push(pack);
        packsByCode.set(code, packs);
    }

    const options: LanguageOption[] = [{
        value: "auto",
        nativeName: "",
        englishName: "",
        completeness: 0,
    }];
    options.push({
        value: "en",
        nativeName: "English",
        englishName: "English",
        completeness: 100,
    });

    for (const packs of packsByCode.values()) {
        const pack = packs[packs.length - 1];
        if (pack.code.toLowerCase() === "en") continue;
        const completeness = languageCompleteness(packs);
        options.push({
            value: pack.code,
            nativeName: pack.name,
            englishName: pack.englishName,
            completeness,
        });
    }

    if (import.meta.env.DEV) {
        options.push({
            value: "en-XA",
            nativeName: "Pseudo-English",
            englishName: "Pseudo-English",
            completeness: 100,
        });
    }

    const packs = [...builtInPacks, ...userPacks];
    const resolved = resolveLocale("auto", preferredLanguages, packs);
    const resolvedPack = [...userPacks, ...builtInPacks].find((pack) => pack.code.toLowerCase() === resolved.toLowerCase());
    const autoName = resolvedPack?.name ?? nativeLanguageName(resolved, "English");
    options[0] = {
        ...options[0],
        nativeName: autoName,
    };
    return options;
}

export class LanguageSectionView extends VanillaView<Record<string, never>> {
    private select: SelectView<IListBoxItem> | undefined;
    private status: HTMLSpanElement | undefined;
    private options: LanguageOption[] = [];
    private preferredLanguages: readonly string[] = [];
    private busy = false;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        this.root.append(
            panel({ paddingBottom: "lg" }, text(t("settings.languageTitle"), { bold: true, size: "sm" })),
            panel({ paddingBottom: "md" }, text(t("settings.languageDescription"), { color: "light", size: "xs" })),
        );
        this.select = this.child(new SelectView(this.selectProps()));
        this.root.append(panel({ maxWidth: 420, paddingBottom: "sm" }, this.select.root));
        this.select.mount();
        this.status = text("", { color: "light", size: "xs" });
        this.root.append(panel({ paddingBottom: "md" }, this.status));
        this.own(settings.onChanged.subscribe(({ key }) => {
            if (key !== "language") return;
            this.sync();
        }));
        void this.refreshPacks();
    }

    protected onDispose(): void {
        this.select = undefined;
        this.status = undefined;
    }

    private selectProps(): SelectViewProps<IListBoxItem> {
        const selectedValue = settings.get<string>("language");
        const items = this.options.map((option) => ({
            ...option,
            label: option.value === "auto"
                ? t("settings.languageAutomatic", { name: option.nativeName })
                : t("settings.languageOption", {
                    name: option.nativeName,
                    englishName: option.englishName,
                    percent: option.completeness,
                }),
        }));
        return {
            items,
            value: items.find((option) => option.value === selectedValue) ?? items[0] ?? null,
            onChange: (item) => { void this.handleLanguageChange(item.value); },
        };
    }

    private async refreshPacks(): Promise<void> {
        try {
            const { refreshLanguagePacks, getStartupPreferredLanguages } = await import("../../../i18n/startup");
            const packs = await refreshLanguagePacks();
            if (this.isDisposed) return;
            this.preferredLanguages = getStartupPreferredLanguages();
            this.options = buildLanguageOptions(packs.builtInPacks, packs.userPacks, this.preferredLanguages);
            this.sync();
        } catch (error: unknown) {
            if (!this.isDisposed) ui.notify(errMessage(error, t("settings.languageLoadFailed")), "warning");
        }
    }

    private sync(): void {
        this.select?.update(this.selectProps());
        if (!this.status) return;
        const effective = resolveLocale(settings.get<string>("language"), this.preferredLanguages, this.options.length > 0
            ? this.options.filter((option) => option.value !== "auto" && option.value !== "en-XA").map((option) => ({
                schemaVersion: 1 as const,
                code: String(option.value),
                name: option.nativeName,
                englishName: option.englishName,
                messages: {},
            }))
            : []);
        this.status.textContent = effective === getActiveLocale() ? "" : t("settings.languageReloadStatus");
    }

    private async handleLanguageChange(value: string | number): Promise<void> {
        if (this.busy || typeof value !== "string" || value === settings.get<string>("language")) return;
        this.busy = true;
        try {
            settings.set("language", value);
            await flushSettingsSave();
            // Reload at once: each window saves its pages first (saveWindowStateForShutdown),
            // the main process keeps running, and the pages are restored after the reload.
            await api.reloadAllWindows();
        } catch (error: unknown) {
            ui.notify(errMessage(error, t("settings.languageApplyFailed")), "error");
        } finally {
            this.busy = false;
        }
    }
}
