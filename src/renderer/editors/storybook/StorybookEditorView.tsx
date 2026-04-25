import React from "react";
import styled from "@emotion/styled";
import { EditorType } from "../../../shared/types";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { Toolbar } from "../../uikit/Toolbar/Toolbar";
import { SegmentedControl } from "../../uikit/SegmentedControl/SegmentedControl";
import { Text } from "../../uikit/Text/Text";
import { HStack } from "../../uikit/Flex/Flex";
import { spacing } from "../../uikit/tokens";
import {
    PreviewBackground,
    StorybookEditorModel,
    StorybookEditorState,
    getDefaultStorybookEditorState,
    STORYBOOK_PAGE_ID,
} from "./StorybookEditorModel";
import { ComponentBrowser } from "./ComponentBrowser";
import { LivePreview } from "./LivePreview";
import { PropertyEditor } from "./PropertyEditor";

// ============================================================================
// Styles
// ============================================================================

const Root = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
});

const Body = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
});

const ToolbarTitle = styled.span({
    fontWeight: 600,
    fontSize: 13,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
});

// ============================================================================
// View
// ============================================================================

const BG_OPTIONS: Array<{ value: PreviewBackground; label: string }> = [
    { value: "dark",    label: "Dark"    },
    { value: "default", label: "Default" },
    { value: "light",   label: "Light"   },
];

function StorybookEditorView({ model }: { model: StorybookEditorModel }) {
    const { previewBackground } = model.state.use();
    return (
        <Root data-type="storybook-editor">
            <Toolbar borderBottom aria-label="Storybook editor toolbar">
                <ToolbarTitle>Storybook</ToolbarTitle>
                <HStack gap={spacing.sm} align="center" style={{ marginLeft: "auto" }}>
                    <Text variant="caption">Background:</Text>
                    <SegmentedControl
                        items={BG_OPTIONS}
                        value={previewBackground}
                        onChange={(v) => model.setPreviewBackground(v as PreviewBackground)}
                        size="sm"
                    />
                </HStack>
            </Toolbar>
            <Body>
                <ComponentBrowser model={model} />
                <LivePreview model={model} />
                <PropertyEditor model={model} />
            </Body>
        </Root>
    );
}

// ============================================================================
// Editor Module
// ============================================================================

const storybookEditorModule: EditorModule = {
    Editor: StorybookEditorView as any,

    newEditorModel: async () => {
        return new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState()));
    },

    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType !== "storybookPage") return null;
        return new StorybookEditorModel(new TComponentState(getDefaultStorybookEditorState()));
    },

    newEditorModelFromState: async (state) => {
        const s: StorybookEditorState = {
            ...getDefaultStorybookEditorState(),
            ...(state as Partial<StorybookEditorState>),
        };
        return new StorybookEditorModel(new TComponentState(s));
    },
};

export default storybookEditorModule;
export { STORYBOOK_PAGE_ID };
