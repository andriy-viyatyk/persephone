import React from "react";
import { VStack } from "./Flex";
import color from "../../theme/color";
import { Story } from "../../editors/storybook/storyTypes";

const box = (key: string, bg: string) =>
    React.createElement("div", {
        key,
        style: { width: 96, height: 32, borderRadius: 4, backgroundColor: bg },
    });

export const vstackStory: Story = {
    id: "v-stack",
    name: "VStack",
    section: "Layout",
    component: VStack as any,
    props: [
        { name: "gap", type: "number", default: 8, min: 0, max: 32, step: 2 },
        { name: "align", type: "enum", options: ["flex-start", "center", "flex-end", "stretch"], default: "flex-start" },
        { name: "justify", type: "enum", options: ["flex-start", "center", "flex-end", "space-between", "space-around"], default: "flex-start" },
        { name: "padding", type: "number", default: 8, min: 0, max: 32, step: 4 },
    ],
    previewChildren: () => [
        box("a", color.icon.active),
        box("b", color.icon.light),
        box("c", color.icon.dark),
    ],
};
