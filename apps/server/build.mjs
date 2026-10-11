// Bundles the server into a single runnable ESM file at dist/index.js.
//
// Why bundle instead of `tsc`:
//   * `@monopos/shared` is published as raw TypeScript (its package `main` is
//     `src/index.ts`); plain Node cannot execute it, and `tsc` would leave the
//     bare import in place.
//   * the generated Prisma client lives under `src/generated` which `tsc` is
//     configured to exclude, so a `tsc` emit would omit it.
// esbuild transpiles both into the bundle and leaves real npm dependencies
// external, so `node dist/index.js` runs with only `node_modules` present.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-dependencies',
      setup(b) {
        // Bundle relative imports and the workspace's raw-TS shared package;
        // leave every other bare specifier (npm deps, node: builtins) external.
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return undefined;
          const p = args.path;
          if (p.startsWith('.') || p.startsWith('/')) return undefined;
          if (p === '@monopos/shared' || p.startsWith('@monopos/shared/')) return undefined;
          return { path: p, external: true };
        });
      },
    },
  ],
});
