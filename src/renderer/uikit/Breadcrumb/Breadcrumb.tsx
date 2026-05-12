import React, { useCallback, useMemo } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, spacing } from "../tokens";
import { splitWithSeparators } from "../../core/utils/utils";

// --- Types ---

export interface BreadcrumbProps
    extends Omit<
        React.HTMLAttributes<HTMLDivElement>,
        "style" | "className" | "onChange"
    > {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
    rootLabel: React.ReactNode;
    value: string;
    onChange: (value: string) => void;
    separators?: string;
    trailingParentSeparator?: boolean;
    separatorContent?: React.ReactNode;
    size?: "sm" | "md";
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        alignItems: "center",
        color: color.text.light,

        '&[data-size="sm"]': { fontSize: fontSize.sm },
        '&[data-size="md"]': { fontSize: fontSize.base },

        '& [data-part="separator"]': {
            color: color.text.light,
            userSelect: "none",
            margin: `0 ${spacing.sm}px`,
        },
        '& [data-part="root"], & [data-part="segment"]': {
            cursor: "pointer",
            "&:hover": { color: color.text.default },
        },
        "& [data-current]": {
            color: color.misc.blue,
            cursor: "default",
            "&:hover": { color: color.misc.blue },
        },
    },
    { label: "Breadcrumb" },
);

// --- Component ---

export function Breadcrumb({
    name,
    rootLabel,
    value,
    onChange,
    separators = "/\\",
    trailingParentSeparator = false,
    separatorContent = ">",
    size = "md",
    ...rest
}: BreadcrumbProps) {
    const joinSeparator = separators[0];

    const segments = useMemo(() => {
        if (!value) return [];
        return splitWithSeparators(value, separators);
    }, [value, separators]);

    const handleClick = useCallback(
        (index: number) => {
            if (index < 0) {
                onChange("");
                return;
            }
            const path = segments.slice(0, index + 1).join(joinSeparator);
            const isLeaf = index === segments.length - 1;
            const finalPath =
                !isLeaf && trailingParentSeparator
                    ? path + joinSeparator
                    : path;
            onChange(finalPath);
        },
        [segments, onChange, joinSeparator, trailingParentSeparator],
    );

    const rootIsCurrent = segments.length === 0;

    return (
        <Root data-type="breadcrumb" data-name={name} data-size={size} {...rest}>
            <span
                data-part="root"
                data-current={rootIsCurrent || undefined}
                onClick={rootIsCurrent ? undefined : () => handleClick(-1)}
            >
                {rootLabel}
            </span>
            {segments.map((segment, index) => {
                const isLeaf = index === segments.length - 1;
                return (
                    <React.Fragment key={index}>
                        <span data-part="separator">{separatorContent}</span>
                        <span
                            data-part="segment"
                            data-current={isLeaf || undefined}
                            onClick={isLeaf ? undefined : () => handleClick(index)}
                        >
                            {segment}
                        </span>
                    </React.Fragment>
                );
            })}
        </Root>
    );
}
