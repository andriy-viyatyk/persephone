import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Text } from "../../uikit/Text/Text";
import { spacing } from "../../uikit/tokens";
import { findStory } from "./storyRegistry";
import { STORYBOOK_MANAGED_PROPS } from "./storyTypes";
import { StorybookEditorModel } from "./StorybookEditorModel";

const Root = styled.div({
    flex: "1 1 auto",
    overflow: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    '&[data-bg="default"]': { backgroundColor: color.background.default },
    '&[data-bg="light"]': { backgroundColor: color.background.light },
    '&[data-bg="dark"]': { backgroundColor: color.background.dark },
});

export function LivePreview({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, propValues, previewBackground } = model.state.use();
    const story = findStory(selectedStoryId);

    if (!story) {
        return (
            <Root data-type="live-preview" data-bg={previewBackground}>
                <Text variant="caption">Select a component</Text>
            </Root>
        );
    }

    const Component = story.component as React.ComponentType<any>;
    const hasChildrenProp = story.props.some((p) => p.name === "children");
    const componentProps = { ...propValues };
    if (!hasChildrenProp && story.previewChildren) {
        componentProps.children = story.previewChildren();
    }
    // Auto-inject Storybook-managed values (e.g. background) when the
    // component's story declares the matching prop.
    const managedValues: Record<string, unknown> = { background: previewBackground };
    for (const propName of STORYBOOK_MANAGED_PROPS) {
        if (story.props.some((p) => p.name === propName)) {
            componentProps[propName] = managedValues[propName];
        }
    }

    return (
        <Root data-type="live-preview" data-bg={previewBackground}>
            <Component {...componentProps} />
        </Root>
    );
}
