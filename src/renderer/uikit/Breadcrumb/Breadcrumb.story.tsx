import React, { useState } from "react";
import { Breadcrumb } from "./Breadcrumb";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

interface DemoProps {
    rootLabel?: string;
    initialValue?: string;
    separators?: string;
    trailingParentSeparator?: boolean;
    separatorContent?: string;
    size?: "sm" | "md";
}

function BreadcrumbDemo({
    rootLabel = "Categories",
    initialValue = "project/settings/dev",
    separators = "/\\",
    trailingParentSeparator = false,
    separatorContent = ">",
    size = "md",
}: DemoProps) {
    const [value, setValue] = useState(initialValue);

    return (
        <Panel direction="column" gap="xl" padding="xl" width={520}>
            <Panel direction="column" gap="sm">
                <Text size="xs" color="light">
                    Configurable (click segments to navigate):
                </Text>
                <Breadcrumb
                    rootLabel={rootLabel}
                    value={value}
                    onChange={setValue}
                    separators={separators}
                    trailingParentSeparator={trailingParentSeparator}
                    separatorContent={separatorContent}
                    size={size}
                />
                <Text size="xs" color="light">
                    value: "{value}"
                </Text>
            </Panel>

            <Panel direction="column" gap="md">
                <Text size="xs" color="light">
                    Static examples:
                </Text>
                <Breadcrumb rootLabel="Categories" value="" onChange={() => {}} />
                <Breadcrumb rootLabel="Categories" value="release" onChange={() => {}} />
                <Breadcrumb
                    rootLabel="Categories"
                    value="release/1.0.1"
                    onChange={() => {}}
                />
                <Breadcrumb
                    rootLabel="Tags"
                    value="release:1.0.1"
                    onChange={() => {}}
                    separators=":"
                    trailingParentSeparator
                />
                <Breadcrumb
                    rootLabel="Path"
                    value="src/renderer/uikit/Breadcrumb"
                    onChange={() => {}}
                    separatorContent="/"
                />
                <Breadcrumb
                    rootLabel="Path"
                    value="src/renderer/uikit"
                    onChange={() => {}}
                    size="sm"
                />
            </Panel>
        </Panel>
    );
}

export const breadcrumbStory: Story = {
    id: "breadcrumb",
    name: "Breadcrumb",
    section: "Bootstrap",
    component: BreadcrumbDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "rootLabel",               type: "string",  default: "Categories" },
        { name: "initialValue",            type: "string",  default: "project/settings/dev" },
        { name: "separators",              type: "string",  default: "/\\" },
        { name: "trailingParentSeparator", type: "boolean", default: false },
        { name: "separatorContent",        type: "string",  default: ">" },
        { name: "size",                    type: "enum",    options: ["sm", "md"], default: "md" },
    ],
};
