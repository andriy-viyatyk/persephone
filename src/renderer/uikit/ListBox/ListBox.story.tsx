import React, { useState } from "react";
import { ListBox, IListBoxItem, ListItemRenderContext } from "./ListBox";
import { ListItem } from "./ListItem";
import { IconButton } from "../IconButton/IconButton";
import { Panel } from "../Panel/Panel";
import { GlobeIcon, CloseIcon } from "../../theme/icons";
import { Story } from "../../editors/storybook/storyTypes";

const ITEMS: IListBoxItem[] = Array.from({ length: 60 }, (_, i) => ({
    value: i,
    label: `Suggestion ${i} — apple banana cherry`,
    icon: <GlobeIcon />,
}));

interface DemoProps {
    searchText?: string;
    keyboardNav?: boolean;
    loading?: boolean;
    customRow?: boolean;
}

function ListBoxDemo({
    searchText = "apple",
    keyboardNav = true,
    loading = false,
    customRow = false,
}: DemoProps) {
    const [value, setValue] = useState<IListBoxItem["value"] | null>(null);
    const [active, setActive] = useState<number>(0);
    const [removed, setRemoved] = useState<Set<IListBoxItem["value"]>>(new Set());
    const visible = ITEMS.filter((it) => !removed.has(it.value));

    const renderItem = customRow
        ? (ctx: ListItemRenderContext<IListBoxItem>) => (
            <ListItem
                id={ctx.id}
                icon={ctx.item.icon}
                label={ctx.item.label}
                searchText={searchText}
                selected={ctx.selected}
                active={ctx.active}
                trailing={
                    <IconButton
                        icon={<CloseIcon />}
                        size="sm"
                        aria-label="Remove"
                        onClick={(e) => {
                            e.stopPropagation();
                            setRemoved((s) => {
                                const next = new Set(s);
                                next.add(ctx.item.value);
                                return next;
                            });
                        }}
                    />
                }
            />
        )
        : undefined;

    return (
        <Panel direction="column" width={360} height={240}>
            <ListBox
                items={visible}
                value={value}
                onChange={(v) => setValue(v)}
                activeIndex={active}
                onActiveChange={setActive}
                searchText={searchText}
                renderItem={renderItem}
                keyboardNav={keyboardNav}
                loading={loading}
                emptyMessage="no rows"
            />
        </Panel>
    );
}

export const listBoxStory: Story = {
    id: "list-box",
    name: "ListBox",
    section: "Lists",
    component: ListBoxDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "searchText",  type: "string",  default: "apple" },
        { name: "keyboardNav", type: "boolean", default: true },
        { name: "loading",     type: "boolean", default: false },
        { name: "customRow",   type: "boolean", default: false },
    ],
};
