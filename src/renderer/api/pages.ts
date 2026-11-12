import { PagesModel } from "./pages/PagesModel";

/**
 * The pages singleton — manages all open pages (tabs) in the current window.
 * Available as `app.pages` after bootstrap.
 */
export const pages = new PagesModel();

