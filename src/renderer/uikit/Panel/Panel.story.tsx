import React from "react";
import { Panel } from "./Panel";
import { Story } from "../../editors/storybook/storyTypes";

const SIZES = ["none", "xs", "sm", "md", "lg", "xl", "xxl"];
const PADDING_SIZES = ["none", "xs", "sm", "md", "lg", "xl", "xxl", "xxxl"];
const ALIGNS = ["start", "center", "end", "stretch", "baseline"];
const JUSTIFIES = ["start", "center", "end", "between", "around", "evenly"];
const DIRECTIONS = ["row", "column", "row-reverse", "column-reverse"];
const OVERFLOWS = ["visible", "hidden", "auto", "scroll"];

export const panelStory: Story = {
    id: "panel",
    name: "Panel",
    section: "Layout",
    component: Panel as any,
    props: [
        { name: "direction",   type: "enum",    options: DIRECTIONS, default: "row" },
        { name: "padding",     type: "enum",    options: PADDING_SIZES, default: "md" },
        { name: "gap",         type: "enum",    options: SIZES, default: "sm" },
        { name: "align",       type: "enum",    options: [...ALIGNS, ""], default: "" },
        { name: "justify",     type: "enum",    options: [...JUSTIFIES, ""], default: "" },
        { name: "wrap",        type: "boolean", default: false },
        { name: "border",      type: "boolean", default: false },
        { name: "borderTop",   type: "boolean", default: false },
        { name: "borderBottom",type: "boolean", default: false },
        { name: "rounded",     type: "enum",    options: [...SIZES, ""], default: "" },
        { name: "shadow",      type: "boolean", default: false },
        { name: "background",  type: "enum",    options: ["", "default", "light", "dark"], default: "" },
        { name: "overflow",    type: "enum",    options: ["", ...OVERFLOWS], default: "" },
        { name: "width",       type: "string", default: "" },
        { name: "height",      type: "string", default: "" },
        { name: "maxWidth",    type: "string", default: "" },
        { name: "minWidth",    type: "string", default: "" },
        { name: "maxHeight",   type: "string", default: "" },
        { name: "minHeight",   type: "string", default: "" },
        { name: "disabled",    type: "boolean", default: false },
    ],
    previewChildren: () => React.createElement(React.Fragment, null,
        React.createElement("span", { key: "a" }, "Child A"),
        React.createElement("span", { key: "b" }, "Child B"),
        React.createElement("span", { key: "c" }, "Child C"),
    ),
};
