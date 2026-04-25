import React from "react";
import { Spacer } from "./Spacer";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

const SpacerInPreview = (props: any) => {
    const { size, ...rest } = props;
    return React.createElement(
        Panel,
        {
            direction: "row",
            gap: "sm",
            align: "center",
            width: 240,
            padding: "md",
            border: true,
        },
        React.createElement("span", { key: "l" }, "Left"),
        React.createElement(Spacer, { ...rest, size: size || undefined }),
        React.createElement("span", { key: "r" }, "Right"),
    );
};

export const spacerStory: Story = {
    id: "spacer",
    name: "Spacer",
    section: "Layout",
    component: SpacerInPreview,
    props: [
        { name: "size", type: "number", default: 0, min: 0, max: 120, step: 8, label: "size (0 = flex grow)" },
    ],
};
