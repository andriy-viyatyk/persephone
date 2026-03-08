import styled from "@emotion/styled";
import { Dialog, DialogContent } from "./Dialog";
import { TDialogModel } from "../../core/state/model";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";
import color from "../../theme/color";
import { ConfirmIcon, RadioCheckedIcon, RadioUncheckedIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { TComponentState } from "../../core/state/state";
import { showDialog } from "./Dialogs";
import { TextField } from "../../components/basic/TextField";
import { useEffect, useRef } from "react";

const InputDialogContent = styled(DialogContent)({
    minWidth: 340,
    maxWidth: 800,
    "& .confirmation-message": {
        padding: "16px 24px 4px 24px",
        fontSize: 16,
        color: color.text.default,
    },
    "& .confirmation-dialog-buttons": {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        columnGap: 8,
        padding: 8,
    },
    "& .value-input": {
        margin: "0 24px",
    },
    "& .input-dialog-options": {
        display: "flex",
        flexDirection: "row",
        columnGap: 4,
        padding: "4px 24px",
    },
    "& .dialog-button": {
        minWidth: 60,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "4px 12px",
        "&.ok-button": {
            backgroundColor: color.background.light,
        },
        "&:hover": {
            borderColor: color.border.active,
        },
    },
});

const inputDialogId = Symbol("inputDialog");

interface InputDialogProps {
    title?: string;
    message: string;
    value?: string;
    buttons?: string[];
    selectAll?: boolean;
    defaultButton?: string;
    /** Optional radio button options rendered below the input field. */
    options?: string[];
    /** Initially selected option (must match one of `options`). */
    selectedOption?: string;
}

const defaultInputDialogProps: InputDialogProps = {
    title: "Input",
    message: "",
    value: "",
    buttons: ["OK", "Cancel"],
    selectAll: false,
    defaultButton: undefined,
};

export interface InputResult {
    value: string;
    button: string;
    selectedOption?: string;
}

class InputDialogModel extends TDialogModel<InputDialogProps, InputResult | undefined> {
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            this.close(undefined);
        }

        if (e.key === "Enter") {
            e.preventDefault();
            const state = this.state.get();
            if (!state.buttons || state.buttons.length === 0 || !state.value?.trim()) {
                return;
            }
            const defBt = state.defaultButton || (state.buttons ? state.buttons[0] : "OK");
            this.close({ value: state.value || "", button: defBt, selectedOption: state.selectedOption });
        }
    };

    setValue = (value: string) => {
        this.state.update((s) => {
            s.value = value;
        });
    };

    setSelectedOption = (option: string) => {
        this.state.update((s) => {
            s.selectedOption = option;
        });
    };
}

function InputDialog({ model }: ViewPropsRO<InputDialogModel>) {
    const state = model.state.use();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Delay focus to run after popup menu's focus-restore completes
        setTimeout(() => {
            if (state.selectAll) {
                inputRef.current?.select();
            } else {
                inputRef.current?.focus();
            }
        }, 0);
    }, []);

    return (
        <Dialog onKeyDown={model.handleKeyDown} autoFocus={false}>
            <InputDialogContent
                title={
                    <>
                        <ConfirmIcon color={color.icon.default} /> {state.title}
                    </>
                }
                onClose={() => model.close(undefined)}
            >
                <div className="confirmation-message">{state.message}</div>
                <TextField
                    ref={inputRef}
                    className="value-input"
                    value={state.value}
                    onChange={model.setValue}
                    autoFocus
                />
                {state.options && state.options.length > 0 && (
                    <div className="input-dialog-options">
                        {state.options.map((option) => (
                            <Button
                                key={option}
                                type="flat"
                                size="small"
                                onClick={() => model.setSelectedOption(option)}
                            >
                                {state.selectedOption === option
                                    ? <RadioCheckedIcon />
                                    : <RadioUncheckedIcon />}
                                {option}
                            </Button>
                        ))}
                    </div>
                )}
                <div className="confirmation-dialog-buttons">
                    {state.buttons?.map((bt, i) => (
                        <Button
                            key={i}
                            onClick={() => model.close({ value: state.value, button: bt, selectedOption: state.selectedOption })}
                            className="dialog-button"
                        >
                            {bt}
                        </Button>
                    ))}
                </div>
            </InputDialogContent>
        </Dialog>
    );
}

Views.registerView(inputDialogId, InputDialog as DefaultView);

export function showInputDialog(props: InputDialogProps) {
    const modelState = {
        ...defaultInputDialogProps,
        ...props,
    };

    const model = new InputDialogModel(new TComponentState(modelState));
    return showDialog({
        viewId: inputDialogId,
        model,
    }) as Promise<InputResult | undefined>;
}
