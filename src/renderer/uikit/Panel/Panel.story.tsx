import React from "react";
import { Panel } from "./Panel";
import { Story } from "../../editors/storybook/storyTypes";

export const panelStory: Story = {
    id: "panel",
    name: "Panel",
    section: "Layout",
    component: Panel as any,
    props: [
        { name: "padding", type: "number", default: 8, min: 0, max: 32, step: 4 },
        { name: "gap", type: "number", default: 8, min: 0, max: 32, step: 4 },
    ],
    previewChildren: () => React.createElement(React.Fragment, null,
        React.createElement("span", null, "Panel content line 1"),
        React.createElement("span", null, "Panel content line 2"),
    ),
};
