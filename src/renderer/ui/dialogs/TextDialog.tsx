import styled from "@emotion/styled";
import { Editor, OnMount } from "@monaco-editor/react";

import { Dialog, DialogContent } from "./Dialog";
import { TDialogModel } from "../../core/state/model";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";
import color from "../../theme/color";
import { ConfirmIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { TComponentState } from "../../core/state/state";
import { showDialog } from "./Dialogs";

const TextDialogContent = styled(DialogContent)({
    width: 600,
    height: 400,
    "& .text-dialog-editor": {
        flex: "1 1 auto",
        overflow: "hidden",
    },
    "& .text-dialog-buttons": {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        columnGap: 8,
        padding: 8,
    },
    "& .dialog-button": {
        minWidth: 60,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "4px 12px",
        "&:hover": {
            borderColor: color.border.active,
        },
    },
});

const textDialogId = Symbol("textDialog");

export interface TextDialogEditorOptions {
    language?: string;
    wordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
    minimap?: boolean;
    lineNumbers?: "on" | "off" | "relative" | "interval";
}

export interface TextDialogProps {
    title?: string;
    text?: string;
    buttons?: string[];
    readOnly?: boolean;
    options?: TextDialogEditorOptions;
    width?: number;
    height?: number;
}

const defaultTextDialogProps: Required<Pick<TextDialogProps, "title" | "text" | "buttons" | "readOnly">> = {
    title: "",
    text: "",
    buttons: ["OK"],
    readOnly: true,
};

export interface TextDialogResult {
    text: string;
    button: string;
}

class TextDialogModel extends TDialogModel<TextDialogProps, TextDialogResult | undefined> {
    editorText: string;

    constructor(state: TComponentState<TextDialogProps>) {
        super(state);
        this.editorText = state.get().text || "";
    }

    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            this.close(undefined);
        }
    };

    handleEditorChange = (value: string | undefined) => {
        this.editorText = value || "";
    };
}

function TextDialog({ model }: ViewPropsRO<TextDialogModel>) {
    const state = model.state.use();
    const title = state.title || defaultTextDialogProps.title;
    const buttons = state.buttons || defaultTextDialogProps.buttons;
    const readOnly = state.readOnly ?? defaultTextDialogProps.readOnly;
    const opts = state.options;

    const handleEditorDidMount: OnMount = (editor) => {
        editor.focus();
    };

    const sizeStyle = {
        ...(state.width ? { width: state.width } : {}),
        ...(state.height ? { height: state.height } : {}),
    };

    return (
        <Dialog onKeyDown={model.handleKeyDown} autoFocus={false}>
            <TextDialogContent
                title={
                    <>
                        <ConfirmIcon color={color.icon.default} /> {title}
                    </>
                }
                onClose={() => model.close(undefined)}
                style={sizeStyle}
            >
                <div className="text-dialog-editor">
                    <Editor
                        value={state.text || ""}
                        language={opts?.language || "plaintext"}
                        onChange={readOnly ? undefined : model.handleEditorChange}
                        onMount={handleEditorDidMount}
                        theme="custom-dark"
                        options={{
                            automaticLayout: true,
                            readOnly,
                            wordWrap: opts?.wordWrap || "on",
                            minimap: { enabled: opts?.minimap ?? false },
                            lineNumbers: opts?.lineNumbers || "off",
                            scrollBeyondLastLine: false,
                            renderLineHighlight: readOnly ? "none" : "line",
                            domReadOnly: readOnly,
                        }}
                    />
                </div>
                <div className="text-dialog-buttons">
                    {buttons.map((bt, i) => (
                        <Button
                            key={i}
                            onClick={() => model.close({ text: model.editorText, button: bt })}
                            className="dialog-button"
                        >
                            {bt}
                        </Button>
                    ))}
                </div>
            </TextDialogContent>
        </Dialog>
    );
}

Views.registerView(textDialogId, TextDialog as DefaultView);

export function showTextDialog(props: TextDialogProps) {
    const modelState = {
        ...defaultTextDialogProps,
        ...props,
    };

    const model = new TextDialogModel(new TComponentState(modelState));
    return showDialog({
        viewId: textDialogId,
        model,
    }) as Promise<TextDialogResult | undefined>;
}
