import React from "react";
import { Dot, DotColor } from "./Dot";
import { Panel } from "../Panel/Panel";
import { Story } from "../../editors/storybook/storyTypes";

interface DotPreviewProps {
    size?: string;
    color?: string;
    bordered?: boolean;
    selected?: boolean;
    clickable?: boolean;
}

const NAMED_SIZES = new Set(["xs", "sm", "md", "lg"]);

function parseSize(raw: string | undefined): "xs" | "sm" | "md" | "lg" | number {
    if (!raw) return "sm";
    if (NAMED_SIZES.has(raw)) return raw as "xs" | "sm" | "md" | "lg";
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : "sm";
}

const SEMANTIC_COLORS: DotColor[] = ["success", "warning", "error", "info", "neutral", "active"];
const SAMPLE_HEX_COLORS = ["#e91e63", "#9c27b0", "#3f51b5", "#ff9800"];

function DotPreview({ size, color: colorProp, bordered, selected, clickable }: DotPreviewProps) {
    const parsedSize = parseSize(size);
    const onClick = clickable ? () => console.log("dot clicked") : undefined;

    return (
        <Panel direction="column" gap="xl" padding="xl">
            <Panel direction="row" align="center" gap="md">
                <span>Configurable:</span>
                <Dot
                    size={parsedSize}
                    color={colorProp ?? "success"}
                    bordered={bordered}
                    selected={selected}
                    onClick={onClick}
                    title="Configurable dot"
                />
            </Panel>

            <Panel direction="column" gap="md">
                <span>Sizes (named — xs, sm, md, lg):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size="xs" color="success" />
                    <Dot size="sm" color="success" />
                    <Dot size="md" color="success" />
                    <Dot size="lg" color="success" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Sizes (numeric — 7, 10, 14, 20):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size={7}  color="success" />
                    <Dot size={10} color="success" />
                    <Dot size={14} color="success" />
                    <Dot size={20} color="success" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Semantic colors:</span>
                <Panel direction="row" align="center" gap="md">
                    {SEMANTIC_COLORS.map((c) => (
                        <Dot key={c} size="md" color={c} title={c} />
                    ))}
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Raw hex (palette colors, with border):</span>
                <Panel direction="row" align="center" gap="md">
                    {SAMPLE_HEX_COLORS.map((c) => (
                        <Dot key={c} size="md" color={c} bordered title={c} />
                    ))}
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Selection ring (palette swatches — middle one is selected):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size="lg" color="#e91e63" selected={false} onClick={() => {}} title="Pink" />
                    <Dot size="lg" color="#9c27b0" selected={true}  onClick={() => {}} title="Purple (selected)" />
                    <Dot size="lg" color="#3f51b5" selected={false} onClick={() => {}} title="Blue" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Hover affordance (hover over the dots):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size="md" color="#444444" onClick={() => {}} title="Clickable" />
                    <Dot size="md" color="success" onClick={() => {}} title="Clickable" />
                    <Dot size="md" color="#ff9800" bordered onClick={() => {}} title="Clickable bordered" />
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <span>Bordered vs. non-bordered (same dark color):</span>
                <Panel direction="row" align="center" gap="md">
                    <Dot size="md" color="#444444" />
                    <Dot size="md" color="#444444" bordered />
                </Panel>
            </Panel>
        </Panel>
    );
}

export const dotStory: Story = {
    id: "dot",
    name: "Dot",
    section: "Bootstrap",
    component: DotPreview as any,
    props: [
        {
            name: "size",
            type: "enum",
            options: ["xs", "sm", "md", "lg", "7", "10", "14", "20"],
            default: "sm",
        },
        {
            name: "color",
            type: "enum",
            options: [
                "success", "warning", "error", "info", "neutral", "active",
                "#e91e63", "#9c27b0", "#3f51b5", "#ff9800",
            ],
            default: "success",
        },
        { name: "bordered", type: "boolean", default: false },
        { name: "selected", type: "boolean", default: false },
        { name: "clickable", type: "boolean", default: false },
    ],
};
