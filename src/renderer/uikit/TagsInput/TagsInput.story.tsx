import React, { useState } from "react";
import { TagsInput } from "./TagsInput";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

const TAG_SETS: Record<string, string[]> = {
    flat: ["react", "typescript", "node", "rust", "go"],
    namespaced: [
        "hobby:photography",
        "hobby:music",
        "work:project1",
        "work:project2",
        "home:cooking",
        "home:diy",
    ],
};

interface DemoProps {
    items?: string;
    separator?: string;
    maxDepth?: number;
    placeholder?: string;
    tagVariant?: "filled" | "outlined";
    size?: "sm" | "md";
    disabled?: boolean;
    readOnly?: boolean;
}

function TagsInputDemo({
    items = "namespaced",
    separator = ":",
    maxDepth = 1,
    placeholder = "Type + Enter to add",
    tagVariant = "filled",
    size = "md",
    disabled = false,
    readOnly = false,
}: DemoProps) {
    const [tags, setTags] = useState<string[]>(["work:project1", "react"]);
    const allTags = TAG_SETS[items] ?? TAG_SETS.namespaced;

    return (
        <Panel direction="column" gap="md" width={420}>
            <TagsInput
                value={tags}
                onChange={setTags}
                items={allTags}
                separator={separator}
                maxDepth={maxDepth || undefined}
                placeholder={placeholder}
                tagVariant={tagVariant}
                size={size}
                disabled={disabled}
                readOnly={readOnly}
                aria-label="Demo tags"
            />
            <Text size="xs" color="light">
                value: {JSON.stringify(tags)}
            </Text>
        </Panel>
    );
}

export const tagsInputStory: Story = {
    id: "tags-input",
    name: "TagsInput",
    section: "Bootstrap",
    component: TagsInputDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "items",       type: "enum",    options: ["flat", "namespaced"], default: "namespaced", label: "Items set" },
        { name: "separator",   type: "enum",    options: [":", "/", "."], default: ":" },
        {
            name: "maxDepth",
            type: "number",
            default: 1,
            min: 0,
            max: 5,
            step: 1,
            label: "Max depth (0 = unlimited)",
        },
        { name: "placeholder", type: "string",  default: "Type + Enter to add" },
        { name: "tagVariant",  type: "enum",    options: ["filled", "outlined"], default: "filled", label: "Tag variant" },
        { name: "size",        type: "enum",    options: ["sm", "md"], default: "md" },
        { name: "disabled",    type: "boolean", default: false },
        { name: "readOnly",    type: "boolean", default: false },
    ],
};
