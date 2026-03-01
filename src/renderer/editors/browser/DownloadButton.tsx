import { useRef } from "react";
import styled from "@emotion/styled";
import { DownloadIcon } from "../../theme/icons";
import color from "../../theme/color";
import { Tooltip } from "../../components/basic/Tooltip";

import { downloadsStore } from "../../store/downloads-store";

const ICON_SIZE = 16;
const RING_SIZE = 22;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const DownloadButtonRoot = styled.button({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: 24,
    height: 24,
    padding: 0,
    border: "none",
    borderRadius: 6,
    backgroundColor: "transparent",
    cursor: "pointer",
    outline: "none",
    "& svg.download-icon": {
        width: ICON_SIZE,
        height: ICON_SIZE,
        color: color.icon.light,
    },
    "&:hover svg.download-icon": {
        color: color.icon.default,
    },
    "&:active svg.download-icon": {
        color: color.icon.dark,
    },
    "&.active svg.download-icon": {
        color: color.icon.active,
    },
    "& .progress-ring": {
        position: "absolute",
        top: (24 - RING_SIZE) / 2,
        left: (24 - RING_SIZE) / 2,
        width: RING_SIZE,
        height: RING_SIZE,
        pointerEvents: "none",
    },
    "& .progress-ring-bg": {
        fill: "none",
        stroke: color.border.light,
        strokeWidth: 1.5,
    },
    "& .progress-ring-fg": {
        fill: "none",
        stroke: color.border.active,
        strokeWidth: 1.5,
        strokeLinecap: "round",
        transform: "rotate(-90deg)",
        transformOrigin: "center",
        transition: "stroke-dashoffset 0.3s ease",
    },
});

interface DownloadButtonProps {
    onClick: (anchorEl: HTMLElement) => void;
}

export function DownloadButton({ onClick }: DownloadButtonProps) {
    const tooltipId = useRef(crypto.randomUUID()).current;
    const buttonRef = useRef<HTMLButtonElement>(null);

    const { hasActive, progress } = downloadsStore.state.use((s) => {
        const active = s.downloads.filter((d) => d.status === "downloading");
        const hasActive = active.length > 0;
        let progress = 0;
        if (hasActive) {
            const totalBytes = active.reduce((sum, d) => sum + d.totalBytes, 0);
            const receivedBytes = active.reduce((sum, d) => sum + d.receivedBytes, 0);
            progress = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
        }
        return { hasActive, progress };
    });

    const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

    const handleClick = () => {
        if (buttonRef.current) {
            onClick(buttonRef.current);
        }
    };

    return (
        <>
            <DownloadButtonRoot
                ref={buttonRef}
                className={hasActive ? "active" : undefined}
                onClick={handleClick}
                data-tooltip-id={tooltipId}
            >
                <DownloadIcon className="download-icon" />
                {hasActive && (
                    <svg className="progress-ring" viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
                        <circle
                            className="progress-ring-bg"
                            cx={RING_CENTER}
                            cy={RING_CENTER}
                            r={RING_RADIUS}
                        />
                        <circle
                            className="progress-ring-fg"
                            cx={RING_CENTER}
                            cy={RING_CENTER}
                            r={RING_RADIUS}
                            strokeDasharray={RING_CIRCUMFERENCE}
                            strokeDashoffset={dashOffset}
                        />
                    </svg>
                )}
            </DownloadButtonRoot>
            <Tooltip id={tooltipId}>Downloads</Tooltip>
        </>
    );
}
