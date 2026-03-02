import { PagesModel } from "./pages/PagesModel";

/**
 * The pages singleton — manages all open pages (tabs) in the current window.
 * Available as `app.pages` after bootstrap.
 */
export const pages = new PagesModel();

/** Backward-compatible alias during migration. Consumers can import { pagesModel }. */
export { pages as pagesModel };
