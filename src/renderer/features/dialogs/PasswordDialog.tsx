import styled from "@emotion/styled";
import { useCallback, useState } from "react";

import { showDialog } from "./Dialogs";
import { Dialog, DialogContent } from "./Dialog";
import color from "../../theme/color";
import { TDialogModel } from "../../core/state/model";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";
import { LockIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { TextField } from "../../components/basic/TextField";
import { TComponentState } from "../../core/state/state";

// =============================================================================
// Styles
// =============================================================================

const PasswordDialogContent = styled(DialogContent)({
    minWidth: 340,
    maxWidth: 500,
    "& .password-form": {
        display: "flex",
        flexDirection: "column",
        padding: "16px 24px",
        gap: 8,
    },
    "& .password-field": {
        marginTop: 16,
        "& input": {
            width: 280,
        },
    },
    "& .password-error": {
        color: color.misc.red,
        fontSize: 13,
    },
    "& .password-buttons": {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        columnGap: 8,
        padding: 8,
    },
    "& .dialog-button": {
        minWidth: 80,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "4px 12px",
        "&:hover": {
            borderColor: color.border.active,
        },
    },
});

// =============================================================================
// Model
// =============================================================================

const passwordDialogId = Symbol("passwordDialog");

export interface PasswordDialogProps {
    mode: "encrypt" | "decrypt";
}

const defaultPasswordDialogProps: PasswordDialogProps = {
    mode: "decrypt",
};

class PasswordDialogModel extends TDialogModel<PasswordDialogProps, string> {
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            this.close(undefined);
        }
    };
}

// =============================================================================
// Component
// =============================================================================

function PasswordDialog({ model }: ViewPropsRO<PasswordDialogModel>) {
    const state = model.state.use();
    const isDecrypt = state.mode === "decrypt";

    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");

    const doSubmit = useCallback(() => {
        if (!password) {
            setError("Password cannot be empty");
            return;
        }
        if (!isDecrypt && password !== confirm) {
            setError("Passwords do not match");
            return;
        }
        model.close(password);
    }, [password, confirm, isDecrypt, model]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                doSubmit();
            } else if (e.key === "Escape") {
                model.close(undefined);
            }
        },
        [doSubmit, model],
    );

    return (
        <Dialog onKeyDown={model.handleKeyDown} autoFocus={false}>
            <PasswordDialogContent
                title={
                    <>
                        <LockIcon color={color.icon.default} />{" "}
                        {isDecrypt ? "Decrypt File" : "Encrypt File"}
                    </>
                }
                onClose={() => model.close(undefined)}
            >
                <div className="password-form">
                    <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={setPassword}
                        className="password-field"
                        autoFocus
                        onKeyDown={handleKeyDown}
                    />
                    {!isDecrypt && (
                        <TextField
                            label="Confirm Password"
                            type="password"
                            value={confirm}
                            onChange={setConfirm}
                            className="password-field"
                            onKeyDown={handleKeyDown}
                        />
                    )}
                    {error && <div className="password-error">{error}</div>}
                </div>
                <div className="password-buttons">
                    <Button
                        onClick={doSubmit}
                        className="dialog-button"
                    >
                        {isDecrypt ? "Decrypt" : "Encrypt"}
                    </Button>
                    <Button
                        onClick={() => model.close(undefined)}
                        className="dialog-button"
                    >
                        Cancel
                    </Button>
                </div>
            </PasswordDialogContent>
        </Dialog>
    );
}

Views.registerView(passwordDialogId, PasswordDialog as DefaultView);

// =============================================================================
// Public API
// =============================================================================

export function showPasswordDialog(props?: Partial<PasswordDialogProps>) {
    const modelState = {
        ...defaultPasswordDialogProps,
        ...props,
    };

    const model = new PasswordDialogModel(new TComponentState(modelState));
    return showDialog({
        viewId: passwordDialogId,
        model,
    }) as Promise<string | undefined>;
}
