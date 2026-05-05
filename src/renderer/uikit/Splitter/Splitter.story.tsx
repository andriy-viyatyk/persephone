import React, { useState } from "react";
import { Splitter } from "./Splitter";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

type Bg = "default" | "light" | "dark" | "overlay";

interface DemoProps {
    orientation?: "vertical" | "horizontal";
    side?: "before" | "after";
    border?: "before" | "after" | "none";
    background?: Bg;
    hoverBackground?: Bg;
    min?: number;
    max?: number;
    disabled?: boolean;
}

function SplitterDemo({
    orientation = "vertical",
    side = "before",
    border = "after",
    background = "default",
    hoverBackground = "light",
    min = 80,
    max = 400,
    disabled = false,
}: DemoProps) {
    const [size, setSize] = useState(200);
    const isVertical = orientation === "vertical";

    const fixedPanel = (
        <Panel
            background="light"
            padding="md"
            shrink={false}
            width={isVertical ? size : undefined}
            height={isVertical ? undefined : size}
        >
            controlled panel ({size}px)
        </Panel>
    );

    const flexPanel = (
        <Panel flex padding="md" background="dark">
            other area
        </Panel>
    );

    return (
        <Panel
            direction={isVertical ? "row" : "column"}
            width="100%"
            height={400}
            background="default"
        >
            {side === "before" ? fixedPanel : flexPanel}
            <Splitter
                orientation={orientation}
                value={size}
                onChange={setSize}
                side={side}
                border={border}
                background={background}
                hoverBackground={hoverBackground}
                min={min}
                max={max}
                disabled={disabled}
            />
            {side === "before" ? flexPanel : fixedPanel}
        </Panel>
    );
}

export const splitterStory: Story = {
    id: "splitter",
    name: "Splitter",
    section: "Layout",
    component: SplitterDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "orientation", type: "enum", options: ["vertical", "horizontal"], default: "vertical" },
        { name: "side", type: "enum", options: ["before", "after"], default: "before" },
        { name: "border", type: "enum", options: ["before", "after", "none"], default: "after" },
        { name: "background", type: "enum", options: ["default", "light", "dark", "overlay"], default: "default" },
        { name: "hoverBackground", type: "enum", options: ["default", "light", "dark", "overlay"], default: "light" },
        { name: "min", type: "number", default: 80, min: 40, max: 200, step: 10 },
        { name: "max", type: "number", default: 400, min: 200, max: 800, step: 20 },
        { name: "disabled", type: "boolean", default: false },
    ],
};
