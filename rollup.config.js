import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import del from "rollup-plugin-delete";
import copy from 'rollup-plugin-copy'

export default {
  input: "src/index.ts",
  output: [
    {
      format: "es",
      sourcemap: true,
      dir: "dist"
    },
  ],
  plugins: [
    json(),
    commonjs(),
    resolve({
      preferBuiltins: true
    }),
    del({
      targets: "dist/*",
    }),
    typescript(),
    copy({
      targets: [
        { src: 'config-example.yaml', dest: 'dist', rename: "config.yaml" },
      ]
    })
  ],
};
