import { settings } from "../../../api/settings";
import { applyLanguageAndReload, loadLanguageSettings } from "../../../api/languages";
import { ui } from "../../../api/ui";
import { errMessage } from "../../../../shared/utils";
import { getActiveLocale } from "../../../../shared/i18n/active-locale";
import { t } from "../../../../shared/i18n/t";
import type { LanguageSummary } from "../../../api/types/languages";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, panel, text } from "./settings-native";
import "../../../uikit/Select/Select.css";

export class LanguageSectionView extends VanillaView<Record<string, never>> {
    private select: SelectView<IListBoxItem> | undefined;
    private status: HTMLSpanElement | undefined;
    private options: (Omit<IListBoxItem, "label"> & { readonly nativeName: string; readonly englishName: string; readonly completeness: number })[] = [];
    private effectiveLanguage: ((requested: string) => { code: string; name: string }) | undefined;
    private busy = false;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        this.select = this.child(new SelectView(this.selectProps()));
        this.root.append(panel({ maxWidth: 420, paddingBottom: "sm" }, this.select.root));
        this.select.mount();
        this.status = text("", { color: "light", size: "xs" });
        this.root.append(panel({ paddingBottom: "md" }, this.status));
        this.own(settings.watch("language", () => {
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
            "aria-label": t("settings.groupTitleLanguage"),
            items,
            value: items.find((option) => option.value === selectedValue) ?? items[0] ?? null,
            onChange: (item) => { void this.handleLanguageChange(item.value); },
        };
    }

    private async refreshPacks(): Promise<void> {
        try {
            const { summaries, effective } = await loadLanguageSettings();
            if (this.isDisposed) return;
            this.effectiveLanguage = effective;
            const automatic = effective("auto");
            this.options = [
                { value: "auto", nativeName: automatic.name, englishName: "", completeness: 0 },
                ...summaries.map((summary: LanguageSummary) => ({
                    value: summary.code,
                    nativeName: summary.name,
                    englishName: summary.englishName,
                    completeness: summary.completeness,
                })),
            ];
            this.sync();
        } catch (error: unknown) {
            if (!this.isDisposed) ui.notify(errMessage(error, t("settings.languageLoadFailed")), "warning");
        }
    }

    private sync(): void {
        this.select?.update(this.selectProps());
        if (!this.status) return;
        const effective = this.effectiveLanguage?.(settings.get<string>("language"));
        this.status.textContent = !effective || effective.code === getActiveLocale() ? "" : t("settings.languageReloadStatus");
    }

    private async handleLanguageChange(value: string | number): Promise<void> {
        if (this.busy || typeof value !== "string" || value === settings.get<string>("language")) return;
        this.busy = true;
        try {
            await applyLanguageAndReload(value);
            // Reload at once: each window saves its pages first (saveWindowStateForShutdown),
            // the main process keeps running, and the pages are restored after the reload.
        } catch (error: unknown) {
            ui.notify(errMessage(error, t("settings.languageApplyFailed")), "error");
        } finally {
            this.busy = false;
        }
    }
}
