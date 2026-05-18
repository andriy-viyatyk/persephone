import React, { useState } from "react";
import styled from "@emotion/styled";

export interface TruncatedTextProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "className"> {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
    /** Content to render — typically a string, but any React node is supported. When the
     *  rendered width exceeds the visible width, hovering shows the full text in a native
     *  browser title tooltip. */
    children?: React.ReactNode;
}

const Root = styled.span(
    {
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "inline-block",
        whiteSpace: "nowrap",
    },
    { label: "TruncatedText" },
);

function getTextFromReactChildren(children: React.ReactNode): string {
    if (typeof children === "string" || typeof children === "number") {
        return String(children);
    }
    if (Array.isArray(children)) {
        return children.map(getTextFromReactChildren).join("");
    }
    if (React.isValidElement(children)) {
        const inner = (children.props as { children?: React.ReactNode }).children;
        if (inner) return getTextFromReactChildren(inner);
    }
    return "";
}

export function TruncatedText({ name, children, ...rest }: TruncatedTextProps) {
    const [overflow, setOverflow] = useState(false);

    return (
        <Root
            data-type="truncated-text"
            data-name={name}
            onMouseOver={(e) => {
                if (e.currentTarget.offsetWidth < e.currentTarget.scrollWidth) {
                    setOverflow(true);
                }
            }}
            onMouseOut={() => setOverflow(false)}
            title={overflow ? getTextFromReactChildren(children) : undefined}
            {...rest}
        >
            {children}
        </Root>
    );
}
