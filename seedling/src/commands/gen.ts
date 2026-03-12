import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import slugify from "slugify";
import { generateText } from "ai";
import { createOllama } from "ai-sdk-ollama";
import { IssueFrontmatter, IssueFrontmatterSchema } from "../types.js";
import { readConfig } from "../lib/config.js";

export interface GenerateIssuesOptions {
  model?: string;
  temperature?: number;
  configPath?: string;
  maxIssues?: number;
  chunkFilter?: string[];
  apiKey?: string;
  baseURL?: string;
  repoBaseUrl?: string;
  branch?: string;
}

export async function generateIssues(
  planPath: string | undefined,
  specsDir: string,
  outputDir: string,
  options?: GenerateIssuesOptions,
): Promise<void> {
  const config = await readConfig(options?.configPath);

  // Determine plan path: CLI argument > config > error
  const resolvedPlanPath = planPath || config.planPath;
  if (!resolvedPlanPath) {
    throw new Error(
      "Plan path must be provided either via --plan flag or planPath in config file",
    );
  }

  const model = options?.model || config.llm?.model || "llama3.2";
  const temperature = options?.temperature ?? config.llm?.temperature ?? 0.15;
  const apiKey = options?.apiKey || process.env.OLLAMA_API_KEY;
  const baseURL = options?.baseURL || process.env.OLLAMA_BASE_URL;

  const linkConfig = buildLinkConfig(
    resolvedPlanPath,
    specsDir,
    options?.repoBaseUrl,
    options?.branch || "main",
  );

  const plan = await fs.readFile(resolvedPlanPath, "utf-8");

  const specFiles = await fs.readdir(specsDir);
  const specsByName: Record<string, string> = {};

  for (const file of specFiles.filter((f) => f.endsWith(".md"))) {
    const content = await fs.readFile(path.join(specsDir, file), "utf-8");
    specsByName[file] = content;
  }

  let assigneesSection = "";
  if (config.assignees && config.assignees.length > 0) {
    assigneesSection = `
## Available Team Members

| Username | Role | Expertise |
|----------|------|-----------|
 ${config.assignees
   .map(
     (a) =>
       `| ${a.username} | ${a.role || "Contributor"} | ${a.expertise?.join(", ") || "General"} |`,
   )
   .join("\n")}

**Assignment Guidelines:**
- Match issues to team members based on their expertise
`;
  }

  const prompt = buildPrompt(plan, specsByName, assigneesSection, linkConfig);

  console.log(
    `Generating issues with model: ${model} (temperature: ${temperature})`,
  );
  console.log(`Specs loaded: ${Object.keys(specsByName).join(", ")}`);
  console.log(`Link config:`, linkConfig);

  const ollama = createOllama({
    ...(apiKey && { apiKey }),
    ...(baseURL && { baseURL }),
  });

  const { text } = await generateText({
    model: ollama(model, { keep_alive: "10m" }),
    prompt,
    temperature,
    maxTokens: 32000,
    abortSignal: AbortSignal.timeout(600000),
  });

  let issues: any[];
  try {
    let jsonText = text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "");
    }
    issues = JSON.parse(jsonText);
  } catch (err) {
    console.error("Raw LLM response:", text.slice(0, 2000));
    throw new Error(`Failed to parse LLM response as JSON: ${err}`);
  }

  console.log(`Generated ${issues.length} issues`);

  await fs.ensureDir(outputDir);

  let writtenCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];

    if (!issue.title || !issue.description) {
      console.warn(`Skipping issue ${i + 1}: missing title or description`);
      skippedCount++;
      continue;
    }

    const id = `${(i + 1).toString().padStart(3, "0")}-${slugify(issue.title, {
      lower: true,
      strict: true,
      replacement: "-",
    }).slice(0, 50)}`;

    const frontmatter: IssueFrontmatter = {
      id,
      title: issue.title,
      labels: issue.labels || [],
      assignees: issue.assignees || [],
      references: issue.references || [],
      state: "open",
      createdAt: new Date().toISOString(),
      priority: issue.priority || "should",
      effort: issue.effort || undefined,
      dependencies: issue.dependencies?.length ? issue.dependencies : undefined,
    };

    try {
      IssueFrontmatterSchema.parse(frontmatter);
    } catch (err) {
      console.warn(`Validation failed for issue ${id}:`, err);
      skippedCount++;
      continue;
    }

    const cleanFrontmatter = Object.fromEntries(
      Object.entries(frontmatter).filter(([, v]) => v !== undefined),
    );

    const fileContent = matter.stringify(issue.description, cleanFrontmatter);
    await fs.writeFile(path.join(outputDir, `${id}.md`), fileContent);
    writtenCount++;
  }

  console.log(`Successfully wrote ${writtenCount} issues to ${outputDir}`);
  if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} invalid issues`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalIssues: issues.length,
    written: writtenCount,
    skipped: skippedCount,
    linkConfig,
    byPriority: {
      must: issues.filter((i) => i.priority === "must").length,
      should: issues.filter((i) => i.priority === "should").length,
      could: issues.filter((i) => i.priority === "could").length,
    },
    byLabel: {} as Record<string, number>,
    byAssignee: {} as Record<string, number>,
  };

  for (const issue of issues) {
    for (const label of issue.labels || []) {
      report.byLabel[label] = (report.byLabel[label] || 0) + 1;
    }
    for (const assignee of issue.assignees || []) {
      report.byAssignee[assignee] = (report.byAssignee[assignee] || 0) + 1;
    }
  }

  await fs.writeJson(path.join(outputDir, "_report.json"), report, {
    spaces: 2,
  });
  console.log("Summary report written to _report.json");
}

interface LinkConfig {
  useFullUrls: boolean;
  baseUrl: string;
  branch: string;
  planPath: string;
  specsDir: string;
  buildUrl: (filePath: string, anchor?: string) => string;
}

function buildLinkConfig(
  planPath: string,
  specsDir: string,
  repoBaseUrl?: string,
  branch: string = "main",
): LinkConfig {
  const normalizePath = (p: string) =>
    p.replace(/^\.\//, "").replace(/\/$/, "");
  const normalizedPlanPath = normalizePath(planPath);
  const normalizedSpecsDir = normalizePath(specsDir);
  const useFullUrls = Boolean(repoBaseUrl);

  const buildUrl = (filePath: string, anchor?: string): string => {
    const normalizedFile = normalizePath(filePath);
    if (repoBaseUrl) {
      const base = `${repoBaseUrl}/blob/${branch}/${normalizedFile}`;
      return anchor ? `${base}#${anchor}` : base;
    }
    return anchor ? `./${normalizedFile}#${anchor}` : `./${normalizedFile}`;
  };

  return {
    useFullUrls,
    baseUrl: repoBaseUrl || "",
    branch,
    planPath: normalizedPlanPath,
    specsDir: normalizedSpecsDir,
    buildUrl,
  };
}

function buildPrompt(
  plan: string,
  specsByName: Record<string, string>,
  assigneesSection: string,
  linkConfig: LinkConfig,
): string {
  const { useFullUrls, planPath, specsDir, buildUrl } = linkConfig;

  const planLinkExample = buildUrl(planPath, "chunk-5-skill-system");
  const specLinkExample = buildUrl(`${specsDir}/srs.md`, "req-func-040");
  const archLinkExample = buildUrl(`${specsDir}/archi.md`, "adr-007");
  const testLinkExample = buildUrl(
    `${specsDir}/test-verification.md`,
    "sc-func-010",
  );

  return `# Task: Generate GitHub Issues from Implementation Plan

You are an expert project manager and software architect. Given a specification suite and implementation plan, generate a complete set of actionable, well-structured GitHub issues.

## Input Documents

Analyze the input documents to understand:
1. **The project scope and goals**
2. **The requirements** (with IDs like REQ-*, BR-*, NFR-*)
3. **The architecture** (ADRs, components, patterns)
4. **The implementation structure** (phases, chunks, milestones)
5. **The test strategy** (BDD scenarios, test cases)

### Implementation Plan

\`\`\`markdown
 ${plan}
\`\`\`

### Specification Files

 ${Object.entries(specsByName)
   .map(
     ([name, content]) => `---

#### ${name}

\`\`\`markdown
 ${content}
\`\`\`
`,
   )
   .join("\n")}

 ${assigneesSection}

---

## Analysis Instructions

1. **Plan structure** — Find phases/chunks/sections and their headings
2. **Requirement IDs** — Pattern: REQ-*, BR-*, NFR-*, US-*, etc.
3. **Architecture decisions** — ADRs, design patterns
4. **Test scenarios** — BDD scenario IDs
5. **Dependencies** — What must be built first

Create anchors from headings: lowercase, spaces→hyphens, remove punctuation
Example: "## Chunk 1: Foundation" → \`#chunk-1-foundation\`

---

## Issue Structure

\`\`\`markdown
## Context

[Why this issue exists]

**Related Plan Section:**
- [Name](${planLinkExample}) - description

**Related Requirements:**
- [REQ-ID](${specLinkExample}) - description

**Related Architecture:**
- [Component](${archLinkExample}) - description

## Problem Statement

[One paragraph description]

## Solution Approach

### Implementation Details

**Files to create/modify:**
- \`path/to/file\` — purpose

**Key interfaces:**
- \`Name\` — purpose

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Testing Requirements

**BDD scenarios:**
- [ID](${testLinkExample}) - description

## Dependencies

- **Blocked by:** Issue IDs or "None"
- **Blocks:** Issue IDs or "None"

## Effort Estimate

- **Complexity:** Low | Medium | High
- **Effort:** 0.5d | 1d | 2d | 3d | 5d
\`\`\`

---

## Link Format

 ${
   useFullUrls
     ? `
**Using FULL URLs** (for GitHub issues):
- Plan: \`${planLinkExample}\`
- Specs: \`${specLinkExample}\`
- Tests: \`${testLinkExample}\`

Format: \`https://github.com/user/repo/blob/BRANCH/path/to/file.md#anchor\`
`
     : `
**Using RELATIVE paths** (for markdown files):
- Plan: \`./${planPath}#anchor\`
- Specs: \`./${specsDir}/filename.md#anchor\`

Format: \`./path/from/repo/root/file.md#anchor\`
`
 }

---

## Labels

**Domain**: backend, frontend, database, infrastructure, testing, documentation, security, performance
**Priority**: must, should, could
**Work Type**: feature, bug, refactor, test, chore
**Size**: size:small, size:medium, size:large

---

## Output

Return ONLY a JSON array:

\`\`\`json
[
  {
    "title": "imperative title",
    "description": "markdown with links",
    "labels": ["domain", "priority", "type", "size"],
    "priority": "must|should|could",
    "references": ["path#anchor"],
    "assignees": ["username"],
    "effort": "1d",
    "dependencies": ["issue-id"]
  }
]
\`\`\`

---

## Quality Checklist

- [ ] Title imperative
- [ ] All sections present
- [ ] **Links use correct format${useFullUrls ? " (full URLs)" : " (relative paths)"}**
- [ ] Anchors correctly formatted
- [ ] Acceptance criteria testable
- [ ] Dependencies identified

Generate comprehensive issues with proper links.`;
}
