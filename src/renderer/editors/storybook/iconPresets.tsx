import React from "react";
import { FolderOpenIcon, PlusIcon, SaveIcon, SettingsIcon } from "../../theme/icons";
import { IconPresetId } from "./storyTypes";

export const ICON_PRESETS: { id: IconPresetId; label: string; render: () => React.ReactNode }[] = [
    { id: "none",     label: "None",     render: () => null },
    { id: "folder",   label: "Folder",   render: () => React.createElement(FolderOpenIcon) },
    { id: "plus",     label: "Plus",     render: () => React.createElement(PlusIcon) },
    { id: "save",     label: "Save",     render: () => React.createElement(SaveIcon) },
    { id: "settings", label: "Settings", render: () => React.createElement(SettingsIcon) },
];

export function resolveIconPreset(id: IconPresetId | undefined): React.ReactNode {
    if (!id || id === "none") return null;
    return ICON_PRESETS.find((p) => p.id === id)?.render() ?? null;
}
