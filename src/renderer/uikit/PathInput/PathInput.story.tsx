import React, { useState } from "react";
import { PathInput } from "./PathInput";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

const PATH_SETS: Record<string, string[]> = {
    deep: [
        "work",
        "work/projects",
        "work/projects/persephone",
        "work/projects/storybook",
        "work/notes",
        "work/notes/2026",
        "personal",
        "personal/journal",
        "personal/recipes",
    ],
    flat: ["alpha", "beta", "gamma", "delta", "epsilon"],
    tags: [
        "hobby:photography",
        "hobby:music",
        "work:project1",
        "work:project2",
        "react",
        "typescript",
    ],
};

interface DemoProps {
    pathSet?: string;
    separator?: string;
    maxDepth?: number;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    size?: "sm" | "md";
    autoFocus?: boolean;
}

function PathInputDemo({
    pathSet = "deep",
    separator = "/",
    maxDepth = 0,
    placeholder = "Enter path...",
    disabled = false,
    readOnly = false,
    size = "md",
    autoFocus = false,
}: DemoProps) {
    const [value, setValue] = useState("");
    const [lastCommit, setLastCommit] = useState<string>("(none)");

    const paths = PATH_SETS[pathSet] ?? PATH_SETS.deep;

    return (
        <Panel direction="column" gap="md" width={360}>
            <PathInput
                value={value}
                onChange={setValue}
                onBlur={(v) => setLastCommit(v === undefined ? "undefined" : JSON.stringify(v))}
                paths={paths}
                separator={separator}
                maxDepth={maxDepth || undefined}
                placeholder={placeholder}
                disabled={disabled}
                readOnly={readOnly}
                size={size}
                autoFocus={autoFocus}
                aria-label="Demo path input"
            />
            <Text size="xs" color="light">
                value: {JSON.stringify(value)}
            </Text>
            <Text size="xs" color="light">
                last commit (onBlur): {lastCommit}
            </Text>
        </Panel>
    );
}

export const pathInputStory: Story = {
    id: "path-input",
    name: "PathInput",
    section: "Bootstrap",
    component: PathInputDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        {
            name: "pathSet",
            type: "enum",
            options: ["deep", "flat", "tags"],
            default: "deep",
            label: "Path set",
        },
        { name: "separator",   type: "enum",    options: ["/", ":", "."], default: "/" },
        {
            name: "maxDepth",
            type: "number",
            default: 0,
            min: 0,
            max: 5,
            step: 1,
            label: "Max depth (0 = unlimited)",
        },
        { name: "placeholder", type: "string",  default: "Enter path..." },
        { name: "disabled",    type: "boolean", default: false },
        { name: "readOnly",    type: "boolean", default: false },
        { name: "size",        type: "enum",    options: ["sm", "md"], default: "md" },
        { name: "autoFocus",   type: "boolean", default: false },
    ],
};
