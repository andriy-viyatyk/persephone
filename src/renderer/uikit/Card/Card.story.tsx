import React from "react";
import { Card } from "./Card";
import { Story } from "../../editors/storybook/storyTypes";

export const cardStory: Story = {
    id: "card",
    name: "Card",
    section: "Layout",
    component: Card as any,
    props: [
        { name: "padding", type: "number", default: 16, min: 0, max: 48, step: 4 },
        { name: "gap", type: "number", default: 8, min: 0, max: 32, step: 4 },
    ],
    previewChildren: () => React.createElement(React.Fragment, null,
        React.createElement("span", null, "Card content line 1"),
        React.createElement("span", null, "Card content line 2"),
    ),
};
