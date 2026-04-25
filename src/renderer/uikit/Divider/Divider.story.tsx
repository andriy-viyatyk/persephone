import React from "react";
import { Divider } from "./Divider";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

const DividerInPreview = ({ orientation }: { orientation?: "horizontal" | "vertical" }) => {
    if (orientation === "vertical") {
        return React.createElement(
            Panel,
            { direction: "row", gap: "xl", align: "center", height: 80, padding: "xl" },
            React.createElement("span", { key: "l" }, "Left"),
            React.createElement(Divider, { orientation: "vertical" }),
            React.createElement("span", { key: "r" }, "Right"),
        );
    }
    return React.createElement(
        Panel,
        { direction: "column", gap: "lg", width: 200, padding: "xl" },
        React.createElement("span", { key: "a" }, "Above"),
        React.createElement(Divider, { orientation: "horizontal" }),
        React.createElement("span", { key: "b" }, "Below"),
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
