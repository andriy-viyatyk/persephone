import type { ReactNode } from "react";

/** Menu item definition for context menus and popup menus. */
export interface MenuItem {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    icon?: ReactNode;
    invisible?: boolean;
    startGroup?: boolean;
    hotKey?: string;
    /** Initially highlighted item. */
    selected?: boolean;
    id?: string;
    items?: MenuItem[];
    minor?: boolean;
}
