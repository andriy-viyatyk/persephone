import { createIconElement, type IconRef } from "../../uikit/shared/slots";
import { IconPresetId } from "./storyTypes";
import { t } from "../../../shared/i18n/t";

export const ICON_PRESETS: { id: IconPresetId; label: () => string; render: () => IconRef | null }[] = [
    { id: "none",     label: () => t("tools.iconNone"), render: () => null },
    { id: "folder",   label: () => t("tools.iconFolder"), render: () => createIconElement("folder-open") },
    { id: "plus",     label: () => t("tools.iconPlus"), render: () => createIconElement("plus") },
    { id: "save",     label: () => t("tools.iconSave"), render: () => createIconElement("save") },
    { id: "settings", label: () => t("tools.iconSettings"), render: () => createIconElement("settings") },
];

export function resolveIconPreset(id: IconPresetId | undefined): IconRef | null {
    if (!id || id === "none") return null;
    return ICON_PRESETS.find((p) => p.id === id)?.render() ?? null;
}
