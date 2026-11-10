import { settings } from "../../../api/settings";
import { TextareaView } from "../../../uikit/Textarea/TextareaView";
import { t } from "../../../../shared/i18n/t";
import type { TextareaProps } from "../../../uikit/Textarea/TextareaView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, helpIcon, panel, sectionTitle, settingsFieldLabel } from "./settings-native";
import "../../../uikit/Textarea/Textarea.css";

export class FileSearchSectionView extends VanillaView<Record<string, never>> {
    private extensionsTextarea: TextareaView | undefined;
    private excludeTextarea: TextareaView | undefined;
    private extensionsValue = "";
    private excludeValue = "";

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const searchExtensions = settings.get("search-extensions");
        const searchExclude = settings.get("search-exclude");
        this.extensionsValue = searchExtensions.join(", ");
        this.excludeValue = searchExclude.join(", ");

        this.root.append(
            sectionTitle(t("settings.fileSearchTitle")),
            panel({ paddingBottom: "md" }, settingsFieldLabel(t("settings.fileSearchExtensionsLabel")), helpIcon(t("settings.fileSearchExtensionsLabel"), t("settings.fileSearchExtensionsDescription"), (cleanup) => this.own(cleanup)).root),
        );

        this.extensionsTextarea = this.child(new TextareaView(this.textareaProps(
            t("settings.fileSearchExtensionsLabel"), this.extensionsValue,
            (value) => { this.extensionsValue = value; },
            () => this.saveExtensions(),
        )));
        this.root.append(this.extensionsTextarea.root);
        this.extensionsTextarea.mount();

        this.root.append(panel({ paddingTop: "lg", paddingBottom: "md" }, settingsFieldLabel(t("settings.fileSearchExclusionsLabel")), helpIcon(t("settings.fileSearchExclusionsLabel"), t("settings.fileSearchExclusionsDescription"), (cleanup) => this.own(cleanup)).root));

        this.excludeTextarea = this.child(new TextareaView(this.textareaProps(
            t("settings.fileSearchExclusionsLabel"), this.excludeValue,
            (value) => { this.excludeValue = value; },
            () => this.saveExclude(),
        )));
        this.root.append(this.excludeTextarea.root);
        this.excludeTextarea.mount();

        const subscription = settings.onChanged.subscribe(({ key }) => {
            if (key === "search-extensions") this.syncExtensions();
            if (key === "search-exclude") this.syncExclude();
        });
        this.own(subscription);
    }

    protected onDispose(): void {
        this.extensionsTextarea = undefined;
        this.excludeTextarea = undefined;
    }

    private textareaProps(label: string, value: string, onChange: (value: string) => void, onBlur: () => void): TextareaProps {
        return {
            "aria-label": label,
            value,
            onChange,
            onBlur,
            singleLine: true,
            maxHeight: 200,
            size: "sm",
        };
    }

    private syncExtensions(): void {
        this.extensionsValue = settings.get("search-extensions").join(", ");
        this.extensionsTextarea?.update(this.textareaProps(
            t("settings.fileSearchExtensionsLabel"), this.extensionsValue,
            (value) => { this.extensionsValue = value; },
            () => this.saveExtensions(),
        ));
    }

    private syncExclude(): void {
        this.excludeValue = settings.get("search-exclude").join(", ");
        this.excludeTextarea?.update(this.textareaProps(
            t("settings.fileSearchExclusionsLabel"), this.excludeValue,
            (value) => { this.excludeValue = value; },
            () => this.saveExclude(),
        ));
    }

    private saveExtensions(): void {
        settings.set("search-extensions", this.extensionsValue.split(",").map((item) => item.trim()).filter(Boolean));
    }

    private saveExclude(): void {
        settings.set("search-exclude", this.excludeValue.split(",").map((item) => item.trim()).filter(Boolean));
    }
}
