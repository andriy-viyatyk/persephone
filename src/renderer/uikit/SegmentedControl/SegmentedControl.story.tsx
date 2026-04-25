import React from "react";
import { SegmentedControl, ISegment } from "./SegmentedControl";
import { Story } from "../../editors/storybook/storyTypes";

const DEMO_ITEMS: ISegment[] = [
    { value: "json", label: "JSON" },
    { value: "grid", label: "Grid" },
    { value: "log",  label: "Log View" },
];

const SegmentedControlDemo = (props: any) => {
    const { initialValue, ...rest } = props;
    const [value, setValue] = React.useState<string>(initialValue ?? "grid");

    // Reset when the storybook control changes the initial value.
    React.useEffect(() => {
        if (initialValue) setValue(initialValue);
    }, [initialValue]);

    return (
        <SegmentedControl
            {...rest}
            items={DEMO_ITEMS}
            value={value}
            onChange={setValue}
        />
    );
};

export const segmentedControlStory: Story = {
    id: "segmented-control",
    name: "SegmentedControl",
    section: "Bootstrap",
    component: SegmentedControlDemo,
    props: [
        { name: "initialValue", type: "enum", options: ["json", "grid", "log"], default: "grid", label: "Initial value" },
        { name: "size", type: "enum", options: ["sm", "md"], default: "md" },
        { name: "background", type: "enum", options: ["default", "light", "dark"], default: "default" },
        { name: "disabled", type: "boolean", default: false },
    ],
};
