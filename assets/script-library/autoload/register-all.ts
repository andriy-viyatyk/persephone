// Autoload Registration Script
//
// Scripts in the "autoload" folder are loaded automatically when persephone
// starts. Each script that exports a "register" function will have it called.
// Inside register(), you can subscribe to application events (like context
// menus) to extend persephone with custom functionality.
//
// To test: uncomment the code below, save the file, then click the yellow
// reload indicator (↻) on the app toolbar to load the changes.
//
// Learn more: https://github.com/andriy-viyatyk/persephone/blob/main/docs/scripting.md

// export function register() {
//     // Add "Properties" to file context menu (right-click any file in File Explorer)
//     app.events.fileExplorer.itemContextMenu.subscribe(event => {
//         if (!event.target.isDirectory) {
//             event.items.push({
//                 icon: "📋",
//                 label: "Properties",
//                 onClick: () => {
//                     const { showFileProperties } = require("library/file-scripts/file-properties");
//                     showFileProperties(event.target.path);
//                 },
//             });
//         }
//     });
// }
