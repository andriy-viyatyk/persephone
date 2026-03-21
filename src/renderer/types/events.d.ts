import { MenuItem } from '../api/events/MenuItem';

declare global {
  interface MouseEvent {
    menuItems?: MenuItem[];
  }
}

export {};