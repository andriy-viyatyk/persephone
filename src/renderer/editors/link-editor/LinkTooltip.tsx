import styled from "@emotion/styled";
import { useCallback, useMemo, useState } from "react";

import { Tooltip } from "../../components/basic/Tooltip";
import color from "../../theme/color";
import type { ILink } from "../../api/types/io.tree";

const LinkTooltipContent = styled.div({
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxWidth: 360,
    "& .link-tooltip-title": {
        fontWeight: 600,
        color: color.text.strong,
        whiteSpace: "normal",
        wordBreak: "break-word",
    },
    "& .link-tooltip-href": {
        fontSize: 12,
        color: color.text.light,
        whiteSpace: "normal",
        wordBreak: "break-all",
        userSelect: "text",
    },
    "& .link-tooltip-img": {
        marginTop: 4,
        maxWidth: "100%",
        maxHeight: 200,
        objectFit: "contain",
        borderRadius: 4,
        border: `1px solid ${color.border.default}`,
    },
    "& .tag-badges": {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        maxHeight: 120,
        overflowY: "auto",
        marginTop: 4,
        borderTop: `1px solid ${color.border.default}`,
        paddingTop: 6,
    },
    "& .tag-badge": {
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        fontSize: 11,
        borderRadius: 3,
        cursor: "pointer",
        userSelect: "none",
        border: `1px solid ${color.border.default}`,
        backgroundColor: "transparent",
        color: color.text.muted,
        "&:hover": {
            borderColor: color.border.active,
        },
        "&.active": {
            backgroundColor: color.background.selection,
            color: color.text.strong,
            borderColor: color.border.active,
        },
    },
    "& .tag-new-input": {
        display: "inline-flex",
        alignItems: "center",
        minWidth: 50,
        maxWidth: 120,
        "& input": {
            width: "100%",
            padding: "1px 5px",
            fontSize: 11,
            borderRadius: 3,
            border: `1px solid ${color.border.default}`,
            backgroundColor: "transparent",
            color: color.text.default,
            outline: "none",
            "&:focus": {
                borderColor: color.border.active,
            },
            "&::placeholder": {
                color: color.text.muted,
                fontSize: 11,
            },
        },
    },
});

interface LinkTooltipProps {
    id: string;
    link: ILink;
    allTags?: string[];
    onToggleTag?: (link: ILink, tag: string) => void;
}

export function LinkTooltip({ id, link, allTags, onToggleTag }: Readonly<LinkTooltipProps>) {
    const [newTag, setNewTag] = useState("");

    const commitNewTag = useCallback((value: string) => {
        const trimmed = value.trim().replace(/:$/, "");
        if (trimmed && onToggleTag && !link.tags?.includes(trimmed)) {
            onToggleTag(link, trimmed);
        }
        setNewTag("");
    }, [link, onToggleTag]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commitNewTag((e.target as HTMLInputElement).value);
        }
    }, [commitNewTag]);

    const showTags = allTags && allTags.length > 0 && onToggleTag;
    const sortedTags = useMemo(() => allTags ? [...allTags].sort() : [], [allTags]);
    const linkTags = link.tags ?? [];

    return (
        <Tooltip id={id} place="bottom" delayShow={800}>
            <LinkTooltipContent>
                <span className="link-tooltip-title">{link.title || "Untitled"}</span>
                {link.href && (
                    <span className="link-tooltip-href">{link.href}</span>
                )}
                {link.imgSrc && (
                    <img className="link-tooltip-img" src={link.imgSrc} alt="" />
                )}
                {showTags && (
                    <div className="tag-badges">
                        {sortedTags.map((tag) => (
                            <span
                                key={tag}
                                className={linkTags.includes(tag) ? "tag-badge active" : "tag-badge"}
                                onClick={() => onToggleTag(link, tag)}
                            >
                                {tag}
                            </span>
                        ))}
                        <span className="tag-new-input">
                            <input
                                placeholder="+ tag (Enter)"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                        </span>
                    </div>
                )}
            </LinkTooltipContent>
        </Tooltip>
    );
}
