import React from "react";
import { EditorType } from "../../../shared/types";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { Panel } from "../../uikit/Panel/Panel";
import { Toolbar } from "../../uikit/Toolbar/Toolbar";
import { SegmentedControl } from "../../uikit/SegmentedControl/SegmentedControl";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { Text } from "../../uikit/Text/Text";
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

const BG_OPTIONS: Array<{ value: PreviewBackground; label: string }> = [
    { value: "dark",    label: "Dark"    },
    { value: "default", label: "Default" },
    { value: "light",   label: "Light"   },
];

function StorybookEditorView({ model }: { model: StorybookEditorModel }) {
    const { previewBackground } = model.state.use();
    return (
        <Panel
            data-type="storybook-editor"
            direction="column"
            flex
            overflow="hidden"
        >
            <Toolbar borderBottom aria-label="Storybook editor toolbar">
                <Panel paddingLeft="sm" paddingRight="md">
                    <Text size="lg" bold>Storybook</Text>
                </Panel>
                <Spacer />
                <Text size="sm" color="light">Background:</Text>
                <SegmentedControl
                    items={BG_OPTIONS}
                    value={previewBackground}
                    onChange={(v) => model.setPreviewBackground(v as PreviewBackground)}
                    size="sm"
                />
            </Toolbar>
            <Panel direction="row" flex overflow="hidden">
                <ComponentBrowser model={model} />
                <LivePreview model={model} />
                <PropertyEditor model={model} />
            </Panel>
        </Panel>
    );
}

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
