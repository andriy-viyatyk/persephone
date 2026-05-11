import React, { useMemo } from "react";
import { Panel } from "../../uikit/Panel/Panel";
import { ListBox, IListBoxItem } from "../../uikit/ListBox/ListBox";
import { storiesBySection } from "./storyRegistry";
import { StorybookEditorModel } from "./StorybookEditorModel";

export function ComponentBrowser({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, leftPanelWidth } = model.state.use();

    const items = useMemo<IListBoxItem[]>(() => {
        const out: IListBoxItem[] = [];
        for (const [section, stories] of storiesBySection()) {
            out.push({
                value: `__section__:${section}`,
                label: section,
                section: true,
            });
            for (const story of stories) {
                out.push({ value: story.id, label: story.name });
            }
        }
        return out;
    }, []);

    const value = useMemo(
        () => items.find((it) => it.value === selectedStoryId) ?? null,
        [items, selectedStoryId],
    );

    return (
        <Panel
            data-type="component-browser"
            direction="column"
            width={leftPanelWidth}
            shrink={false}
            overflow="hidden"
        >
            <ListBox
                items={items}
                value={value}
                onChange={(item) => model.selectStory(String(item.value))}
                variant="browse"
                selectionStyle="accent"
                rowHeight={26}
            />
        </Panel>
    );
}
