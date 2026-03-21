import styled from "@emotion/styled";

import { Tooltip } from "../../components/basic/Tooltip";
import color from "../../theme/color";
import { LinkItem } from "./linkTypes";

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
});

interface LinkTooltipProps {
    id: string;
    link: LinkItem;
}

export function LinkTooltip({ id, link }: Readonly<LinkTooltipProps>) {
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
            </LinkTooltipContent>
        </Tooltip>
    );
}
