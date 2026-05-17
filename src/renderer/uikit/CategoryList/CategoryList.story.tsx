import React from "react";
import { CategoryList } from "./CategoryList";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

interface CategoryListDemoProps {
    separator?: string;
    rootLabel?: string;
    showCounts?: boolean;
}

const SAMPLE_TAGS = [
    "dev",
    "draft",
    "release:1.0.0",
    "release:1.0.1",
    "release:1.1.0",
    "stage:design",
    "stage:review",
    "stage:done",
];

const SAMPLE_HOSTNAMES = [
    "github.com",
    "google.com",
    "anthropic.com",
    "example.org",
];

function CategoryListDemo({
    separator = ":",
    rootLabel = "All",
    showCounts = true,
}: CategoryListDemoProps) {
    const [tagValue, setTagValue] = React.useState("");
    const [hostValue, setHostValue] = React.useState("");

    const tagCounts: Record<string, number> = {
        "": 12,
        "dev": 3,
        "draft": 2,
        "release:": 4,
        "release:1.0.0": 1,
        "release:1.0.1": 2,
        "release:1.1.0": 1,
        "stage:": 3,
        "stage:design": 1,
        "stage:review": 1,
        "stage:done": 1,
    };
    const hostCounts: Record<string, number> = {
        "": 4, "github.com": 2, "google.com": 1, "anthropic.com": 0, "example.org": 1,
    };

    return (
        <Panel direction="column" gap="xl" padding="xl">
            <Panel direction="column" gap="md">
                <Text size="sm" color="light">
                    Tags-style — separator drills into a subcategory (try clicking the
                    chevron next to <code>release</code> or <code>stage</code>).
                </Text>
                <Panel direction="row" gap="md" align="start">
                    <Panel width={220} height={280} border rounded="md" overflow="hidden">
                        <CategoryList
                            items={SAMPLE_TAGS}
                            value={tagValue}
                            onChange={setTagValue}
                            separator={separator}
                            rootLabel={rootLabel}
                            getCount={showCounts ? (v) => tagCounts[v] : undefined}
                        />
                    </Panel>
                    <Text size="sm">selected: <code>{JSON.stringify(tagValue)}</code></Text>
                </Panel>
            </Panel>

            <Panel direction="column" gap="md">
                <Text size="sm" color="light">
                    Flat — drill-in disabled with <code>separator={"\"\\0\""}</code>.
                </Text>
                <Panel direction="row" gap="md" align="start">
                    <Panel width={220} height={200} border rounded="md" overflow="hidden">
                        <CategoryList
                            items={SAMPLE_HOSTNAMES}
                            value={hostValue}
                            onChange={setHostValue}
                            separator={"\0"}
                            rootLabel="All hostnames"
                            getCount={showCounts ? (v) => hostCounts[v] : undefined}
                        />
                    </Panel>
                    <Text size="sm">selected: <code>{JSON.stringify(hostValue)}</code></Text>
                </Panel>
            </Panel>
        </Panel>
    );
}

export const categoryListStory: Story = {
    id: "category-list",
    name: "CategoryList",
    section: "Lists",
    component: CategoryListDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "separator", type: "string", default: ":" },
        { name: "rootLabel", type: "string", default: "All" },
        { name: "showCounts", type: "boolean", default: true },
    ],
};
