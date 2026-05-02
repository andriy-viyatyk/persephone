import React from "react";
import { Button } from "./Button";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";
import { Story } from "../../editors/storybook/storyTypes";

const ButtonWithIcon = (props: any) => {
    const { iconPreset, title, ...rest } = props;
    return React.createElement(Button, {
        ...rest,
        title: title || undefined,
        icon: resolveIconPreset(iconPreset),
    });
};

export const buttonStory: Story = {
    id: "button",
    name: "Button",
    section: "Bootstrap",
    component: ButtonWithIcon,
    props: [
        { name: "children", type: "string", default: "Click me" },
        { name: "variant", type: "enum", options: ["default", "primary", "ghost", "danger", "link"], default: "default" },
        { name: "size", type: "enum", options: ["sm", "md"], default: "md" },
        { name: "background", type: "enum", options: ["default", "light", "dark"], default: "default" },
        { name: "iconPreset", type: "icon", default: "none", label: "Icon" },
        { name: "title", type: "string", default: "" },
        { name: "disabled", type: "boolean", default: false },
    ],
};
