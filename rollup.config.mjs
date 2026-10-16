import { readFileSync } from 'node:fs';
import { babel } from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const name = 'Compressor';
const banner = `/*!
 * Compressor.js v${pkg.version}
 * ${pkg.homepage}
 *
 * Copyright 2018-present Chen Fengyuan
 * Copyright ${new Date().getFullYear()} ${pkg.author}
 * Released under the MIT license
 *
 * Date: ${new Date().toISOString()}
 */
`;

export default {
  input: 'src/index.js',
  output: [
    {
      banner,
      name,
      file: 'dist/compressor.js',
      format: 'umd',
    },
    {
      banner,
      name,
      file: 'dist/compressor.min.js',
      format: 'umd',
      plugins: [
        terser({
          format: {
            comments: /^!/,
          },
        }),
      ],
    },
    {
      banner,
      file: 'dist/compressor.common.js',
      format: 'cjs',
      exports: 'auto',
    },
    {
      banner,
      file: 'dist/compressor.mjs',
      format: 'esm',
    },
    {
      banner,
      name,
      file: 'docs/js/compressor.js',
      format: 'umd',
    },
  ],
  plugins: [
    babel({
      babelHelpers: 'bundled',
    }),
  ],
};
