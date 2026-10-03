import color from "../../theme/color";
import { createIconElement } from "../../uikit/shared/slots";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import type { TextSize } from "../../uikit/Text/text-style";
import type { NormalizedBoardPermissions } from "../../../shared/board-manifest-utils";
import { FULL_ACCESS_DETAIL, boardPermissionDiffLines, boardPermissionLines } from "./board-permission-copy";
import type { BoardPermissionLine } from "./board-permission-copy";

const ICON_SIZE = 14;

function rowIcon(name: "check" | "warning", iconColor: string): SVGElement {
    return createIconElement(name, {
        width: ICON_SIZE,
        height: ICON_SIZE,
        color: iconColor,
        style: "flex-shrink: 0; margin-top: 2px",
    });
}

/** A permission set as a list: one checked row per granted permission. Full-access rows carry
 *  the warning badge; a legacy set is one warning row; an empty set is plain text. */
export function createBoardPermissionList(
    permissions: NormalizedBoardPermissions,
    size?: TextSize,
): HTMLElement {
    const list = createPanelElement({ direction: "column", gap: "xs", align: "stretch" });
    list.setAttribute("role", "list");
    const granted = permissions.kind === "legacy" || Object.values(permissions.flags).some((value) => value !== false);
    for (const line of boardPermissionLines(permissions)) {
        if (!granted) {
            list.append(createTextElement(line.text, { size, color: "light" }));
            continue;
        }
        const legacy = permissions.kind === "legacy";
        const detailSize = size === "sm" ? "xs" : size;
        const heading = createPanelElement({ direction: "row", gap: "lg", align: "center", wrap: true }, [
            createTextElement(line.text, { size }),
        ]);
        const content = createPanelElement({ direction: "column", gap: "xs", flex: 1 }, [heading]);
        if (line.fullAccess) {
            heading.append(createTextElement("Full access", { size: detailSize, bold: true, color: "warning" }));
            content.append(createTextElement(FULL_ACCESS_DETAIL, { size: detailSize, color: "light" }));
        }
        const row = createPanelElement({ direction: "row", gap: "sm", align: "start" }, [
            rowIcon(legacy ? "warning" : "check", line.fullAccess || legacy ? color.warning.text : color.success.text),
            content,
        ]);
        row.setAttribute("role", "listitem");
        list.append(row);
    }
    return list;
}

function lineContent(line: BoardPermissionLine, size: TextSize | undefined, struck: boolean): HTMLElement {
    const detailSize = size === "sm" ? "xs" : size;
    const label = createTextElement(line.text, { size, color: struck ? "light" : undefined });
    if (struck) label.style.textDecoration = "line-through";
    const heading = createPanelElement({ direction: "row", gap: "lg", align: "center", wrap: true }, [label]);
    const content = createPanelElement({ direction: "column", gap: "xs", flex: 1 }, [heading]);
    if (line.fullAccess && !struck) {
        heading.append(createTextElement("Full access", { size: detailSize, bold: true, color: "warning" }));
        content.append(createTextElement(FULL_ACCESS_DETAIL, { size: detailSize, color: "light" }));
    }
    return content;
}

function signMarker(sign: "+" | "−", textColor: "success" | "light", size: TextSize | undefined): HTMLElement {
    const marker = createTextElement(sign, { size, bold: true, color: textColor });
    marker.style.width = `${ICON_SIZE}px`;
    marker.style.flexShrink = "0";
    marker.style.textAlign = "center";
    return marker;
}

/** Granted and proposed sets as one list: a check for kept permissions, "+" for added ones and
 *  a struck-through "−" line for removed ones. */
export function createBoardPermissionChangeList(
    granted: NormalizedBoardPermissions,
    proposed: NormalizedBoardPermissions,
    size?: TextSize,
): HTMLElement {
    const list = createPanelElement({ direction: "column", gap: "xs", align: "stretch" });
    list.setAttribute("role", "list");
    for (const line of boardPermissionDiffLines(granted, proposed)) {
        const legacy = line.text === "Unrestricted";
        const marker = line.mark === "kept"
            ? rowIcon(legacy ? "warning" : "check", line.fullAccess || legacy ? color.warning.text : color.success.text)
            : signMarker(line.mark === "added" ? "+" : "−", line.mark === "added" ? "success" : "light", size);
        const row = createPanelElement({ direction: "row", gap: "sm", align: "start" }, [
            marker,
            lineContent(line, size, line.mark === "removed"),
        ]);
        row.setAttribute("role", "listitem");
        row.dataset.change = line.mark;
        list.append(row);
    }
    return list;
}
