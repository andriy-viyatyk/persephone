import { HelpIconView } from "../../../uikit/HelpIcon/HelpIconView";
import { t } from "../../../../shared/i18n/t";
import { createPanelElement, type PanelStyleProps } from "../../../uikit/Panel/panel-style";
import { createTextElement, type TextStyleProps } from "../../../uikit/Text/text-style";
import "../settings.css";

export type EmptyProps = Record<string, never>;

export function createSectionRoot(type: string): HTMLDivElement {
    const root = document.createElement("div");
    root.dataset.type = type;
    return root;
}

export function panel(props: PanelStyleProps, ...children: Node[]): HTMLDivElement {
    return createPanelElement(props, children);
}

export function text(value: string, props: TextStyleProps = {}): HTMLSpanElement {
    return createTextElement(value, props);
}

export function settingsLabel(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "settings-label";
    element.textContent = value;
    return element;
}

export function settingsFieldLabel(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "settings-field-label";
    element.textContent = value;
    return element;
}

export function settingsPath(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "settings-path";
    element.title = value;
    element.textContent = value;
    return element;
}

export function settingsLink(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "settings-link";
    element.title = value;
    element.textContent = value;
    return element;
}

export function settingsPlaceholder(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "settings-placeholder";
    element.textContent = value;
    return element;
}

export function helpIcon(label: string, description: string, own: (cleanup: () => void) => void): HelpIconView {
    const view = new HelpIconView({ label: t("settings.moreInformation", { label }), text: description });
    view.mount();
    own(() => view.dispose());
    return view;
}

/** A field label followed by its "?" help; it never shrinks, so the control beside it gives way. */
export function helpLabel(label: string, description: string, own: (cleanup: () => void) => void): HTMLDivElement {
    return panel({ direction: "row", align: "center", shrink: false }, settingsFieldLabel(label), helpIcon(label, description, own).root);
}

/** A section title; the space below it separates the title from the section's content. */
export function sectionTitle(label: string, ...extra: Node[]): HTMLDivElement {
    return panel({ paddingBottom: "xl" }, text(label, { bold: true, size: "sm" }), ...extra);
}

export function helpHeader(label: string, description: string, own: (cleanup: () => void) => void): HTMLDivElement {
    return sectionTitle(label, helpIcon(label, description, own).root);
}
