import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Button } from "../../uikit/Button/Button";
import { Label } from "../../uikit/Label/Label";
import { spacing } from "../../uikit/tokens";
import { storiesBySection } from "./storyRegistry";
import { StorybookEditorModel } from "./StorybookEditorModel";

const Root = styled.div({
    width: 200,
    flexShrink: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${color.border.default}`,
    padding: spacing.sm,
    gap: spacing.xs,
});

const SectionLabel = styled(Label)({
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    paddingLeft: spacing.xs,
});

export function ComponentBrowser({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId } = model.state.use();
    const sections = storiesBySection();

    return (
        <Root data-type="component-browser">
            {Array.from(sections.entries()).map(([section, stories]) => (
                <React.Fragment key={section}>
                    <SectionLabel variant="section">{section}</SectionLabel>
                    {stories.map((story) => (
                        <Button
                            key={story.id}
                            variant={selectedStoryId === story.id ? "primary" : "ghost"}
                            size="sm"
                            onClick={() => model.selectStory(story.id)}
                            style={{ width: "100%", justifyContent: "flex-start" }}
                        >
                            {story.name}
                        </Button>
                    ))}
                </React.Fragment>
            ))}
        </Root>
    );
}
