#!/usr/bin/env node
import { Command } from "commander";
import dotenv from "dotenv";
import { generateIssues } from "./commands/gen.js";
import { syncIssues } from "./commands/sync.js";
import { readConfig } from "./lib/config.js";

dotenv.config();

const program = new Command();

program
  .name("seedling")
  .description("AI-powered GitHub issue generator and syncer")
  .version("0.1.0");

program
  .command("gen")
  .description("Generate issue markdown files from implementation plan")
  .option("-p, --plan <path>", "Path to implementation plan markdown file") // Now optional
  .option(
    "-c, --config <path>",
    "Path to config file (default: seedling.config.json)",
  )
  .option("-s, --specs <dir>", "Directory containing spec files", "./specs")
  .option("-o, --out <dir>", "Output directory for issues", "./issues")
  .option("-m, --model <model>", "LLM model to use", "glm-5:cloud")
  .option("-t, --temperature <number>", "LLM temperature", parseFloat, 0.2)
  .action(async (options) => {
    try {
      await generateIssues(
        options.plan, // may be undefined
        options.specs,
        options.out,
        {
          model: options.model,
          temperature: options.temperature,
          configPath: options.config,
        },
      );
      console.log(`Issues generated in ${options.out}`);
    } catch (err) {
      console.error("Generation failed:", err);
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Sync issue files with GitHub")
  .requiredOption(
    "-t, --token <token>",
    "GitHub token (or set GITHUB_TOKEN env)",
  )
  .requiredOption("-r, --repo <owner/repo>", "GitHub repository")
  .option("-d, --dir <dir>", "Issues directory", "./issues")
  .option("-m, --mapping <file>", "Mapping file", "./issues-mapping.json")
  .option("--dry-run", "Preview changes without actually calling GitHub")
  .action(async (options) => {
    const [owner, repo] = options.repo.split("/");
    if (!owner || !repo) {
      console.error("Invalid repo format. Use owner/repo");
      process.exit(1);
    }
    const token = options.token || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("GitHub token required via --token or GITHUB_TOKEN env");
      process.exit(1);
    }
    try {
      await syncIssues(
        token,
        owner,
        repo,
        options.dir,
        options.mapping,
        options.dryRun,
      );
      console.log("Sync completed");
    } catch (err) {
      console.error("Sync failed:", err);
      process.exit(1);
    }
  });

program.parse(process.argv);
