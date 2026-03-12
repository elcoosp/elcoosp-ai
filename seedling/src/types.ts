import { z } from "zod";

/**
 * Zod schema for issue frontmatter validation.
 */
export const IssueFrontmatterSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
  state: z.enum(["open", "closed"]).default("open"),
  milestone: z.string().optional(),
  priority: z.enum(["must", "should", "could"]).optional(),
  effort: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/**
 * Type definition for issue frontmatter.
 */
export type IssueFrontmatter = z.infer<typeof IssueFrontmatterSchema>;

export interface IssueFile {
  path: string;
  id: string;
  frontmatter: IssueFrontmatter;
  body: string;
  mtimeMs: number;
}

// Mapping file structure
export interface IssueMapping {
  [id: string]: {
    number: number;
    mtime: number;
  };
}

// LLM generation request/response
export interface GenerateIssuesOptions {
  planPath: string;
  specsDir: string;
  outputDir: string;
  model?: string;
  temperature?: number;
}

export interface SyncIssuesOptions {
  token: string;
  owner: string;
  repo: string;
  issuesDir: string;
  mappingFile: string;
  dryRun?: boolean;
}
