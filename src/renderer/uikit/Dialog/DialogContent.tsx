import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import { IconButton } from "../IconButton";
import { CloseIcon } from "../../theme/icons";

// --- Types ---

export interface DialogContentProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "title"> {
    /** Title text or rich node. */
    title?: React.ReactNode;
    /** Optional leading icon in the header. */
    icon?: React.ReactNode;
    /** Close-X button click. When unset, the X is hidden. */
    onClose?: () => void;
    /** Inline buttons rendered between the title and the close X. */
    headerButtons?: React.ReactNode;

    /** Sizing — pass through to the root element. Numbers → px. */
    width?: number | string;
    height?: number | string;
    minWidth?: number | string;
    maxWidth?: number | string;
    minHeight?: number | string;
    maxHeight?: number | string;

    children?: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: color.background.default,
        overflow: "hidden",
    },
    { label: "DialogContent" },
);

const Header = styled.div({
    display: "flex",
    alignItems: "center",
    columnGap: spacing.md,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    borderBottom: `1px solid ${color.border.default}`,
    backgroundColor: color.background.light,
    overflow: "hidden",
    flexShrink: 0,
});

const TitleBox = styled.span({
    display: "flex",
    alignItems: "center",
    columnGap: spacing.md,
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
});

// --- Component ---

export function DialogContent({
    title,
    icon,
    onClose,
    headerButtons,
    width,
    height,
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    children,
    ...rest
}: DialogContentProps) {
    const sizing: React.CSSProperties = {};
    if (width !== undefined) sizing.width = width;
    if (height !== undefined) sizing.height = height;
    if (minWidth !== undefined) sizing.minWidth = minWidth;
    if (maxWidth !== undefined) sizing.maxWidth = maxWidth;
    if (minHeight !== undefined) sizing.minHeight = minHeight;
    if (maxHeight !== undefined) sizing.maxHeight = maxHeight;

    const hasHeader = title !== undefined || icon !== undefined || onClose !== undefined || headerButtons !== undefined;

    return (
        <Root
            data-type="dialog-content"
            data-has-header={hasHeader || undefined}
            style={sizing}
            {...rest}
        >
            {hasHeader && (
                <Header>
                    {icon}
                    <TitleBox>{title}</TitleBox>
                    {headerButtons}
                    {onClose && (
                        <IconButton
                            size="sm"
                            icon={<CloseIcon />}
                            onClick={onClose}
                            aria-label="Close"
                        />
                    )}
                </Header>
            )}
            {children}
        </Root>
    );
}
