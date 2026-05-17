import React from "react";
import { Text, TextColor, TextVariant, TextSize } from "./Text";
import { Story } from "../../editors/storybook/storyTypes";

interface DemoProps {
    children?: string;
    variant?: TextVariant;
    color?: TextColor;
    customColor?: string;
    size?: TextSize;
    italic?: boolean;
    bold?: boolean;
    nowrap?: boolean;
    preWrap?: boolean;
    truncate?: boolean;
}

function TextDemo({ customColor, color: colorProp, ...rest }: DemoProps) {
    return <Text color={customColor || colorProp} {...rest} />;
}

export const textStory: Story = {
    id: "text",
    name: "Text",
    section: "Bootstrap",
    component: TextDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "children",    type: "string",  default: "Sample text" },
        { name: "variant",     type: "enum",    options: ["default", "uppercased", "link"], default: "default" },
        { name: "color",       type: "enum",    options: ["default", "light", "dark", "inherit", "error", "warning", "success", "primary"], default: "default", label: "Named color" },
        { name: "customColor", type: "string",  default: "", label: "Custom color (free-form; overrides named)" },
        { name: "size",        type: "enum",    options: ["xs", "sm", "md", "base", "lg", "xl", "xxl"], default: "base" },
        { name: "italic",      type: "boolean", default: false },
        { name: "bold",        type: "boolean", default: false },
        { name: "nowrap",      type: "boolean", default: false },
        { name: "preWrap",     type: "boolean", default: false },
        { name: "truncate",    type: "boolean", default: false },
    ],
};
