import React from "react";
import { Button } from "./Button";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";
import { Story } from "../../editors/storybook/storyTypes";

const ButtonWithIcon = (props: any) => {
    const { iconPreset, title, hideUntilParentHover, ...rest } = props;
    const button = React.createElement(Button, {
        ...rest,
        title: title || undefined,
        hideUntilParentHover,
        icon: resolveIconPreset(iconPreset),
    });
    if (!hideUntilParentHover) return button;
    return React.createElement(
        Panel,
        { direction: "row", align: "center", gap: "md", padding: "md", border: true, rounded: "md", revealChildrenOnHover: true },
        React.createElement(Text, { color: "light", key: "hint" }, "Hover this row →"),
        button,
    );
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
        { name: "hideUntilParentHover", type: "boolean", default: false, label: "Hide until parent hover (wraps in a hover-reveal Panel)" },
    ],
};
