import React from "react";
import { Panel } from "../../uikit/Panel/Panel";
import { Button } from "../../uikit/Button/Button";
import { Label } from "../../uikit/Label/Label";
import { storiesBySection } from "./storyRegistry";
import { StorybookEditorModel } from "./StorybookEditorModel";

export function ComponentBrowser({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, leftPanelWidth } = model.state.use();
    const sections = storiesBySection();

    return (
        <Panel
            data-type="component-browser"
            direction="column"
            width={leftPanelWidth}
            shrink={false}
            overflowY="auto"
            padding="sm"
            gap="xs"
        >
            {Array.from(sections.entries()).map(([section, stories]) => (
                <React.Fragment key={section}>
                    <Panel paddingTop="sm" paddingBottom="xs" paddingLeft="xs">
                        <Label variant="uppercased" bold size="xs" color="light">{section}</Label>
                    </Panel>
                    {stories.map((story) => (
                        <Button
                            key={story.id}
                            block
                            variant={selectedStoryId === story.id ? "primary" : "ghost"}
                            size="sm"
                            onClick={() => model.selectStory(story.id)}
                        >
                            {story.name}
                        </Button>
                    ))}
                </React.Fragment>
            ))}
        </Panel>
    );
}
