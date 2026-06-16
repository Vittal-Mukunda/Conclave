// Bundles the extension host entry (src/extension.ts) into out/extension.js.
// vscode is marked external because the runtime provides it. Webview assets in
// media/ are plain JS/CSS and need no bundling.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'out/extension.js',
  // vscode is provided by the host; node-sqlite3-wasm is a runtime module that
  // loads a .wasm file and must not be bundled (required from node_modules).
  external: ['vscode', 'node-sqlite3-wasm'],
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching...');
  } else {
    await esbuild.build(options);
    console.log('[esbuild] build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
