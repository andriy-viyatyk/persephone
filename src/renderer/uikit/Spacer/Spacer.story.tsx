import React from "react";
import { Spacer } from "./Spacer";
import { HStack } from "../Flex";
import color from "../../theme/color";
import { Story } from "../../editors/storybook/storyTypes";

const SpacerInPreview = (props: any) => {
    const { size, ...rest } = props;
    return React.createElement(
        HStack,
        {
            gap: 4,
            align: "center" as any,
            style: { width: 240, padding: 8, border: `1px dashed ${color.border.default}` },
        },
        React.createElement("span", null, "Left"),
        React.createElement(Spacer, { ...rest, size: size || undefined }),
        React.createElement("span", null, "Right"),
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
