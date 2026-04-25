import React from "react";
import { Divider } from "./Divider";
import { HStack } from "../Flex";
import { VStack } from "../Flex";
import { Story } from "../../editors/storybook/storyTypes";

const DividerInPreview = ({ orientation }: { orientation?: "horizontal" | "vertical" }) => {
    if (orientation === "vertical") {
        return React.createElement(
            HStack,
            { gap: 12, align: "center" as any, style: { height: 80, padding: 16 } },
            React.createElement("span", null, "Left"),
            React.createElement(Divider, { orientation: "vertical" }),
            React.createElement("span", null, "Right"),
        );
    }
    return React.createElement(
        VStack,
        { gap: 8, style: { width: 200, padding: 16 } },
        React.createElement("span", null, "Above"),
        React.createElement(Divider, { orientation: "horizontal" }),
        React.createElement("span", null, "Below"),
    );
};

export const dividerStory: Story = {
    id: "divider",
    name: "Divider",
    section: "Bootstrap",
    component: DividerInPreview as any,
    props: [
        { name: "orientation", type: "enum", options: ["horizontal", "vertical"], default: "horizontal" },
    ],
};
