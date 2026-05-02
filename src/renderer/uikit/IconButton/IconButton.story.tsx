import React from "react";
import { IconButton } from "./IconButton";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";
import { SettingsIcon } from "../../theme/icons";
import { Story } from "../../editors/storybook/storyTypes";

const IconButtonWithPreset = (props: any) => {
    const { iconPreset, title, ...rest } = props;
    const icon = resolveIconPreset(iconPreset) ?? React.createElement(SettingsIcon);
    return React.createElement(IconButton, { ...rest, title: title || undefined, icon });
};

export const iconButtonStory: Story = {
    id: "icon-button",
    name: "IconButton",
    section: "Bootstrap",
    component: IconButtonWithPreset,
    props: [
        { name: "iconPreset", type: "icon", default: "folder", label: "Icon" },
        { name: "size", type: "enum", options: ["sm", "md"], default: "md" },
        { name: "title", type: "string", default: "" },
        { name: "disabled", type: "boolean", default: false },
    ],
};
