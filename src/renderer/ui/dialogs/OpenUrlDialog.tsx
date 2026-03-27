import styled from "@emotion/styled";
import { Dialog, DialogContent } from "./Dialog";
import { TDialogModel } from "../../core/state/model";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";
import color from "../../theme/color";
import { OpenFileIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { TComponentState } from "../../core/state/state";
import { showDialog } from "./Dialogs";
import { TextAreaField, TextAreaFieldRef } from "../../components/basic/TextAreaField";
import { useRef, useEffect } from "react";

const OpenUrlDialogContent = styled(DialogContent)({
    minWidth: 500,
    maxWidth: 800,
    "& .url-input": {
        margin: "16px 24px 8px 24px",
        minHeight: 80,
        maxHeight: 300,
        overflowY: "auto",
        fontSize: 13,
    },
    "& .dialog-buttons": {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        columnGap: 8,
        padding: "4px 8px 8px 8px",
        "& .open-file-button": {
            marginRight: "auto",
        },
    },
    "& .dialog-button": {
        minWidth: 60,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "4px 12px",
        columnGap: 4,
        "&.ok-button": {
            backgroundColor: color.background.light,
        },
        "&:hover": {
            borderColor: color.border.active,
        },
    },
});

const openUrlDialogId = Symbol("openUrlDialog");

interface OpenUrlDialogState {
    value: string;
}

export type OpenUrlDialogResult = { type: "url"; value: string } | { type: "file" } | undefined;

class OpenUrlDialogModel extends TDialogModel<OpenUrlDialogState, OpenUrlDialogResult> {
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            this.close(undefined);
        }

        // Ctrl+Enter to submit (Enter alone creates newlines in TextArea)
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            this.submit();
        }
    };

    setValue = (value: string) => {
        this.state.update((s) => { s.value = value; });
    };

    submit = () => {
        const value = this.state.get().value?.trim();
        if (value) {
            this.close({ type: "url", value });
        }
    };

    openFile = () => {
        this.close({ type: "file" });
    };
}

function OpenUrlDialog({ model }: ViewPropsRO<OpenUrlDialogModel>) {
    const state = model.state.use();
    const textRef = useRef<TextAreaFieldRef>(null);

    useEffect(() => {
        setTimeout(() => {
            textRef.current?.div?.focus();
        }, 0);
    }, []);

    const isEmpty = !state.value?.trim();

    return (
        <Dialog onKeyDown={model.handleKeyDown} autoFocus={false}>
            <OpenUrlDialogContent
                title="Open"
                onClose={() => model.close(undefined)}
            >
                <TextAreaField
                    ref={textRef}
                    className="url-input"
                    value={state.value}
                    onChange={model.setValue}
                    placeholder="Paste file path, URL, or cURL command"
                />
                <div className="dialog-buttons">
                    <Button
                        className="dialog-button open-file-button"
                        onClick={model.openFile}
                    >
                        <OpenFileIcon /> Open File
                    </Button>
                    <Button
                        className="dialog-button"
                        onClick={() => model.close(undefined)}
                    >
                        Cancel
                    </Button>
                    <Button
                        className="dialog-button ok-button"
                        onClick={model.submit}
                        disabled={isEmpty}
                    >
                        Open
                    </Button>
                </div>
            </OpenUrlDialogContent>
        </Dialog>
    );
}

Views.registerView(openUrlDialogId, OpenUrlDialog as DefaultView);

export function showOpenUrlDialog(): Promise<OpenUrlDialogResult> {
    const model = new OpenUrlDialogModel(new TComponentState({ value: "" }));
    return showDialog({
        viewId: openUrlDialogId,
        model,
    }) as Promise<OpenUrlDialogResult>;
}
