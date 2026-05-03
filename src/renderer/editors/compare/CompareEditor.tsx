import * as monaco from "monaco-editor";
import { useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { TextFileModel } from "../text";
import { Panel, Toolbar, Text, IconButton } from "../../uikit";
import { CompareIcon } from "../../theme/icons";
import { TComponentModel, useComponentModel } from "../../core/state/model";

interface CompareEditorProps {
    model: TextFileModel;
    groupedModel: TextFileModel;
}

class CompareEditorModel extends TComponentModel<null, CompareEditorProps> {
    didChangeSubscription: monaco.IDisposable | null = null;
    editor: monaco.editor.IStandaloneDiffEditor | null = null;

    editorDidMount = (editor: monaco.editor.IStandaloneDiffEditor) => {
        this.editor = editor;
        const modifiedEditor = editor.getModifiedEditor();
        this.didChangeSubscription = modifiedEditor.onDidChangeModelContent(
            () => {
                const newValue = modifiedEditor.getValue();
                this.props.groupedModel.changeContent(newValue, true);
            },
        );
    };

    dispose() {
        this.didChangeSubscription?.dispose();
        this.editor?.dispose();
        this.editor = null;
    }
}

export function CompareEditor(props: CompareEditorProps) {
    const { model, groupedModel } = props;
    const editorModel = useComponentModel(props, CompareEditorModel, null);

    const { language, content, filePath, title } = model.state.use((s) => ({
        language: s.language,
        content: s.content,
        filePath: s.filePath,
        title: s.title,
    }));
    const { groupedContent, groupedFilePath, groupedTitle } =
        groupedModel.state.use((s) => ({
            groupedContent: s.content,
            groupedFilePath: s.filePath,
            groupedTitle: s.title,
        }));

    useEffect(() => {
        return () => {
            editorModel.dispose();
        };
    }, []);

    const leftLabel = filePath || title;
    const rightLabel = groupedFilePath || groupedTitle;

    return (
        <Panel direction="column" flex overflow="hidden">
            <Toolbar borderBottom>
                <Panel flex overflow="hidden" justify="end">
                    <Text
                        dir="rtl"
                        truncate
                        color="light"
                        title={leftLabel}
                    >
                        {leftLabel}
                    </Text>
                </Panel>
                <Text size="xl" color="light">→</Text>
                <Panel flex overflow="hidden">
                    <Text
                        dir="rtl"
                        truncate
                        color="light"
                        title={rightLabel}
                    >
                        {rightLabel}
                    </Text>
                </Panel>
                <IconButton
                    size="sm"
                    title="Exit Compare Mode"
                    onClick={() => {
                        model.setCompareMode(false);
                        groupedModel.setCompareMode(false);
                    }}
                    icon={<CompareIcon />}
                />
            </Toolbar>
            <DiffEditor
                language={language}
                original={content}
                modified={groupedContent}
                onMount={editorModel.editorDidMount}
                options={{
                    readOnly: false,
                    renderSideBySide: true,
                    automaticLayout: true,
                }}
                theme="custom-dark"
            />
        </Panel>
    );
}

export type { CompareEditorProps };
