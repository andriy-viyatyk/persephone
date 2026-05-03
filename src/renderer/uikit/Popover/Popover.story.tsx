import React, { useRef, useState } from "react";
import { Popover } from "./Popover";
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
    offsetX?: number;
    offsetY?: number;
    maxHeight?: string;
    longContent?: boolean;
    useIgnoreSelector?: boolean;
    matchAnchorWidth?: boolean;
    resizable?: boolean;
}

const PopoverDemo = ({
    placement = "bottom-start",
    offsetX = 0,
    offsetY = 4,
    maxHeight = "",
    longContent = false,
    useIgnoreSelector = false,
    matchAnchorWidth = false,
    resizable = false,
}: DemoProps) => {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);

    return (
        <Panel direction="column" gap="md" padding="lg" align="start">
            <Panel direction="row" gap="md" align="center">
                <Button ref={anchorRef} onClick={() => setOpen((v) => !v)}>
                    {open ? "Close popover" : "Open popover"}
                </Button>
                {useIgnoreSelector && (
                    <span
                        data-test-ignore="true"
                        style={{ padding: 6, border: "1px dashed #888" }}
                    >
                        Ignored sibling — clicking here should NOT close popover
                    </span>
                )}
            </Panel>

            <Popover
                open={open}
                elementRef={anchorRef.current}
                placement={placement as any}
                offset={[offsetX, offsetY]}
                maxHeight={maxHeight || undefined}
                outsideClickIgnoreSelector={
                    useIgnoreSelector ? '[data-test-ignore="true"]' : undefined
                }
                matchAnchorWidth={matchAnchorWidth}
                resizable={resizable}
                onClose={() => setOpen(false)}
            >
                <Panel direction="column" padding="md" gap="sm" minWidth="200px">
                    <Text>Hello from Popover</Text>
                    <Text size="sm" color="light">Placement: {placement}</Text>
                    {resizable && (
                        <Text size="sm">
                            Long line that overflows when the popover is narrow — drag the bottom-right corner to enlarge.
                        </Text>
                    )}
                    {longContent &&
                        Array.from({ length: 30 }).map((_, i) => (
                            <Text key={i} size="sm">Item {i + 1}</Text>
                        ))}
                </Panel>
            </Popover>
        </Panel>
    );
};

export const popoverStory: Story = {
    id: "popover",
    name: "Popover",
    section: "Overlay",
    component: PopoverDemo as any,
    props: [
        { name: "placement",         type: "enum",    options: PLACEMENTS, default: "bottom-start" },
        { name: "offsetX",           type: "number",  default: 0 },
        { name: "offsetY",           type: "number",  default: 4 },
        { name: "maxHeight",         type: "string",  default: "" },
        { name: "longContent",       type: "boolean", default: false },
        { name: "useIgnoreSelector", type: "boolean", default: false },
        { name: "matchAnchorWidth",  type: "boolean", default: false },
        { name: "resizable",         type: "boolean", default: false },
    ],
};
