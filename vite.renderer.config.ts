import { defineConfig, Plugin } from 'vite';
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';
import electronRenderer from 'vite-plugin-electron-renderer';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Vite plugin that copies .d.ts files from src/renderer/api/types/ to assets/editor-types/
 * and generates _imports.txt listing all type files for Monaco IntelliSense.
 *
 * Runs on dev server start, on build, and watches for changes in dev mode.
 */
function editorTypesPlugin(): Plugin {
  const srcDir = path.resolve(__dirname, 'src/renderer/api/types');
  const destDir = path.resolve(__dirname, 'assets/editor-types');

  function syncTypes() {
    if (!fs.existsSync(srcDir)) return;

    // Copy all .d.ts files from api/types/ to assets/editor-types/
    const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.d.ts'));
    for (const file of srcFiles) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }

    // Generate _imports.txt from ALL .d.ts files in destination
    // (includes both copied files and manually maintained ones like page.d.ts)
    const allFiles = fs.readdirSync(destDir)
      .filter(f => f.endsWith('.d.ts'))
      .sort();

    // Put index.d.ts last since it imports the others
    const idx = allFiles.indexOf('index.d.ts');
    if (idx !== -1) {
      allFiles.splice(idx, 1);
      allFiles.push('index.d.ts');
    }

    fs.writeFileSync(path.join(destDir, '_imports.txt'), allFiles.join('\n') + '\n');
  }

  return {
    name: 'editor-types',

    // Runs on both dev and build
    buildStart() {
      syncTypes();
    },

    // Watch for changes in dev mode
    configureServer(server) {
      server.watcher.add(srcDir);
      server.watcher.on('change', (changedPath) => {
        if (changedPath.startsWith(srcDir) && changedPath.endsWith('.d.ts')) {
          syncTypes();
        }
      });
      server.watcher.on('add', (addedPath) => {
        if (addedPath.startsWith(srcDir) && addedPath.endsWith('.d.ts')) {
          syncTypes();
        }
      });
    },
  };
}

export default defineConfig({
  // Pin a dedicated dev-server port (Vite's default 5173 conflicts with another
  // local React app whose redirect URI is locked to that port in its app
  // registration). strictPort fails fast instead of hopping to 5174+, so the
  // URL stays deterministic.
  server: {
    port: 5273,
    strictPort: true,
    watch: {
      // Cargo build output must not be watched. A `cargo build` running while the
      // dev server is up churns thousands of files and briefly locks the build-script
      // executables it is writing; chokidar then fails to watch one with EBUSY, and
      // that error is emitted on the FSWatcher rather than swallowed — which takes
      // the whole dev server (and therefore Persephone) down mid-session:
      //   Error: EBUSY: resource busy or locked, watch
      //     'snip-tool/target/release/build/serde-<hash>/build_script_build-<hash>.exe'
      // None of these trees is an import source, so watching them buys nothing.
      // `release/` is electron-builder's output and churns the same way.
      //
      // A bundled board's generated `lib/` is the same story: `npm run build-board-lib`
      // deletes the tree and rewrites it, and chokidar hits the same EBUSY on a file it
      // is mid-replace. Nothing under it is an import source either — the main process
      // serves those files from disk over `board://`, so the renderer never imports
      // them and watching them cannot trigger anything useful.
      ignored: [
        '**/snip-tool/target/**',
        '**/mneme/target/**',
        '**/launcher/target/**',
        '**/release/**',
        '**/assets/boards/*/lib/**',
      ],
    },
  },
  plugins: [
    editorTypesPlugin(),
    monacoEditorPlugin({
      languageWorkers: ['typescript', 'editorWorkerService', 'json', 'html'],
    }),
    // The renderer runs with nodeIntegration, so Node builtins (buffer, stream,
    // fs, path, …) and `electron` must resolve to the real runtime modules via
    // require() — not Vite's browser-external stubs (which broke iconv-lite /
    // safer-buffer under Vite 8). Electron Forge's plugin-vite did this before
    // the decoupling; this plugin restores it for both dev and prod.
    electronRenderer(),
  ],
  build: {
    target: 'esnext',
  },
});
