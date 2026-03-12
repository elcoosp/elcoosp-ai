import fs from "fs-extra";
import path from "path";

export interface SeedlingConfig {
  planPath?: string;
  specsDir?: string;
  issuesDir?: string;
  mappingFile?: string;
  github?: {
    owner?: string;
    repo?: string;
  };
  llm?: {
    model?: string;
    temperature?: number;
  };
  assignees?: Array<{ username: string; role?: string; expertise?: string[] }>;
}

export async function readConfig(configPath?: string): Promise<SeedlingConfig> {
  const file = configPath || path.join(process.cwd(), "seedling.config.json");
  if (await fs.pathExists(file)) {
    return fs.readJSON(file);
  }
  return {};
}
