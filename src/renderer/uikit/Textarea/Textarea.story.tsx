import React from "react";
import { Textarea } from "./Textarea";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

interface DemoProps {
    initialValue?: string;
    placeholder?: string;
    singleLine?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    minHeight?: number;
    maxHeight?: number;
    size?: "sm" | "md";
    autoFocus?: boolean;
}

function TextareaDemo({
    initialValue = "",
    placeholder = "Type something...",
    singleLine = false,
    disabled = false,
    readOnly = false,
    minHeight = 0,
    maxHeight = 0,
    size = "md",
    autoFocus = false,
}: DemoProps) {
    const [value, setValue] = React.useState<string>(initialValue);

    React.useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    return (
        <Panel direction="column" gap="md">
            <Textarea
                value={value}
                onChange={setValue}
                placeholder={placeholder}
                singleLine={singleLine}
                disabled={disabled}
                readOnly={readOnly}
                minHeight={minHeight || undefined}
                maxHeight={maxHeight || undefined}
                size={size}
                autoFocus={autoFocus}
                aria-label="Demo textarea"
            />
            <Text>Value: {JSON.stringify(value)}</Text>
        </Panel>
    );
}

export const textareaStory: Story = {
    id: "textarea",
    name: "Textarea",
    section: "Bootstrap",
    component: TextareaDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "initialValue", type: "string", default: "",                       label: "Initial value" },
        { name: "placeholder",  type: "string", default: "Type something..." },
        { name: "singleLine",   type: "boolean", default: false },
        { name: "disabled",     type: "boolean", default: false },
        { name: "readOnly",     type: "boolean", default: false },
        { name: "minHeight",    type: "number", default: 0, min: 0, max: 200, step: 10, label: "Min height (0 = unset)" },
        { name: "maxHeight",    type: "number", default: 0, min: 0, max: 500, step: 50, label: "Max height (0 = unset)" },
        { name: "size",         type: "enum",   options: ["sm", "md"], default: "md" },
        { name: "autoFocus",    type: "boolean", default: false, label: "Auto-focus on mount" },
    ],
};
