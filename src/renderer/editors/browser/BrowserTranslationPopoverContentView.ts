import { t } from "../../../shared/i18n/t";
import { SelectView } from "../../uikit/Select/SelectView";
import type { SelectViewProps } from "../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../uikit/ListBox/types";
import { languageDisplayName } from "../../ui/translation/TranslationWorkflow";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { BrowserTranslationTabState } from "./BrowserTranslationController";

interface BrowserTranslationPopoverProps {
    tabId: string;
    state: BrowserTranslationTabState;
    pageError?: string;
    onChange: (tabId: string, from: string) => Promise<void>;
}

export class BrowserTranslationPopoverContentView extends VanillaView<BrowserTranslationPopoverProps> {
    private readonly label = document.createElement("div");
    private readonly error = document.createElement("div");
    private readonly select: SelectView<IListBoxItem>;

    public constructor(props: BrowserTranslationPopoverProps, host: HTMLElement) {
        super(props, host);
        this.label.dataset.translationLabel = "";
        this.error.dataset.translationError = "";
        this.select = this.child(new SelectView(this.selectProps()));
        this.root.append(this.label, this.select.root, this.error);
        this.root.dataset.translationPopoverContent = "";
    }

    protected onMount(): void { this.select.mount(); this.sync(); }
    protected onUpdate(props: BrowserTranslationPopoverProps): void { this.props = props; this.sync(); }

    private selectProps(): SelectViewProps<IListBoxItem> {
        const options = this.props.state.candidates.map((code) => ({ value: code, label: `${languageDisplayName(code)} (${code})` }));
        const selected = options.find((option) => option.value === this.props.state.from) ?? null;
        return {
            name: "translation-source-language",
            size: "sm",
            items: options,
            value: selected,
            placeholder: t("translation.chooseSource"),
            emptyMessage: t("translation.chooseSource"),
            onChange: (item) => { void this.props.onChange(this.props.tabId, String(item.value)); },
        };
    }

    private sync(): void {
        const language = this.props.state.from;
        const languageLabel = `${languageDisplayName(language)} (${language})`;
        this.label.textContent = !language ? t("translation.chooseSource")
            : this.props.state.active ? t("translation.translatedFrom", { language: languageLabel })
            : t("translation.pageLanguage", { language: languageLabel });
        this.select.update(this.selectProps());
        this.error.textContent = this.props.pageError || this.props.state.error || this.props.state.progress || "";
        this.error.hidden = !this.error.textContent;
    }
}
