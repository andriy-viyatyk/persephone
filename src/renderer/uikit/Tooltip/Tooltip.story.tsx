import React from "react";
import { Tooltip } from "./Tooltip";
import { Button } from "../Button/Button";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

const PLACEMENTS = [
    "top", "top-start", "top-end",
    "bottom", "bottom-start", "bottom-end",
    "left", "left-start", "left-end",
    "right", "right-start", "right-end",
];

interface DemoProps {
    placement?: string;
    delayShow?: number;
    delayHide?: number;
    offsetX?: number;
    offsetY?: number;
    richContent?: boolean;
    disabled?: boolean;
}

const TooltipDemo = ({
    placement = "top",
    delayShow = 600,
    delayHide = 100,
    offsetX = 0,
    offsetY = 8,
    richContent = false,
    disabled = false,
}: DemoProps) => {
    const content = richContent ? (
        <Panel direction="column" gap="sm">
            <Text bold>Rich content</Text>
            <Text size="sm" color="light">
                Multi-line tooltip body with secondary text.
            </Text>
            <Text size="sm">
                Hover the tooltip itself — it stays open while the cursor is on it.
            </Text>
        </Panel>
    ) : (
        "Hello from Tooltip"
    );

    return (
        <Panel direction="column" gap="lg" padding="xl" align="start">
            <Text size="sm" color="light">
                Hover the button. Default delays: 600 ms show, 100 ms hide.
            </Text>
            <Tooltip
                content={content}
                placement={placement as any}
                offset={[offsetX, offsetY]}
                delayShow={delayShow}
                delayHide={delayHide}
                disabled={disabled}
            >
                <Button>Hover me</Button>
            </Tooltip>
        </Panel>
    );
};

export const tooltipStory: Story = {
    id: "tooltip",
    name: "Tooltip",
    section: "Overlay",
    component: TooltipDemo as any,
    props: [
        { name: "placement",   type: "enum",    options: PLACEMENTS, default: "top" },
        { name: "delayShow",   type: "number",  default: 600 },
        { name: "delayHide",   type: "number",  default: 100 },
        { name: "offsetX",     type: "number",  default: 0 },
        { name: "offsetY",     type: "number",  default: 8 },
        { name: "richContent", type: "boolean", default: false },
        { name: "disabled",    type: "boolean", default: false },
    ],
};
