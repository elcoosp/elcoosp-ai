import { defineConfig } from "@rslib/core";

export default defineConfig({
  lib: [
    {
      format: "esm",
      output: {
        distPath: {
          root: "./dist/esm",
        },
      },
    },
    {
      format: "cjs",
      output: {
        distPath: {
          root: "./dist/cjs",
        },
      },
    },
  ],
  source: {
    entry: {
      cli: "./src/cli.ts",
      index: "./src/index.ts",
    },
  },
  tools: {
    rspack: {
      externals: [
        /^node:/,
        /^fs-extra$/,
        /^@octokit\/rest$/,
        /^ai$/,
        /^@ai-sdk\/openai$/,
        /^commander$/,
        /^dotenv$/,
        /^gray-matter$/,
        /^slugify$/,
        /^zod$/,
      ],
    },
  },
});
