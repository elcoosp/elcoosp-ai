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
  maxSteps?: number;
  maxRetries?: number;
}

interface GenerationChunk {
  issues: any[];
  isCompleted: boolean;
  nextSectionHint?: string;
}

// Determine if an error is retryable or permanent
function isRetryableError(error: any): boolean {
  const message = error?.message || String(error);
  const lower = message.toLowerCase();

  // Permanent errors – do not retry
  const permanentKeywords = [
    "session usage limit",
    "quota exceeded",
    "upgrade",
    "payment required",
    "forbidden",
    "unauthorized",
    "invalid api key",
    "rate limit", // rate limit is transient but we want to respect it; maybe retry after backoff but for simplicity treat as permanent for now
  ];
  if (permanentKeywords.some((keyword) => lower.includes(keyword))) {
    return false;
  }

  // Transient errors – retry
  const transientKeywords = [
    "network error",
    "timeout",
    "econnrefused",
    "econnreset",
    "etimedout",
    "5xx",
    "internal server error",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "aborted",
    "parse error", // LLM output malformed – may be temporary glitch
  ];
  if (transientKeywords.some((keyword) => lower.includes(keyword))) {
    return true;
  }

  // By default, assume transient (safe)
  return true;
}

export async function generateIssues(
  planPath: string | undefined,
  specsDir: string | undefined,
  outputDir: string | undefined,
  options?: GenerateIssuesOptions,
): Promise<void> {
  const config = await readConfig(options?.configPath);

  const resolvedPlanPath = planPath || config.planPath;
  if (!resolvedPlanPath) {
    throw new Error(
      "Plan path must be provided either via --plan flag or planPath in config file",
    );
  }
  const resolvedSpecsDir = specsDir || config.specsDir || "./specs";
  const resolvedOutputDir = outputDir || config.issuesDir || "./issues";
  const model = options?.model || config.llm?.model || "llama3.2";
  const temperature = options?.temperature ?? config.llm?.temperature ?? 0.15;
  const apiKey = options?.apiKey || process.env.OLLAMA_API_KEY;
  const baseURL = options?.baseURL || process.env.OLLAMA_BASE_URL;
  const maxSteps = options?.maxSteps || 20;
  const maxRetries = options?.maxRetries || 3;

  const plan = await fs.readFile(resolvedPlanPath, "utf-8");
  if (!(await fs.pathExists(resolvedSpecsDir))) {
    throw new Error(`Specs directory not found: ${resolvedSpecsDir}`);
  }
  const specFiles = await fs.readdir(resolvedSpecsDir);
  const specsByName: Record<string, string> = {};
  for (const file of specFiles.filter((f) => f.endsWith(".md"))) {
    specsByName[file] = await fs.readFile(
      path.join(resolvedSpecsDir, file),
      "utf-8",
    );
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

  const linkConfig = buildLinkConfig(
    resolvedPlanPath,
    resolvedSpecsDir,
    resolvedOutputDir,
    options?.repoBaseUrl,
    options?.branch || "main",
  );

  const ollama = createOllama({
    ...(apiKey && { apiKey }),
    ...(baseURL && { baseURL }),
  });

  const messages = [
    {
      role: "system",
      content: `You are an expert project manager generating GitHub issues from an implementation plan and specifications.
You will generate issues in **chunks**. Each response MUST be a valid JSON object with the following structure:
{
  "issues": [ ... ],   // array of issue objects (each with title, description, labels, priority, references, assignees, effort, dependencies)
  "isCompleted": false, // set to true ONLY when you have generated ALL possible issues from the plan
  "nextSectionHint": "optional description of what you will tackle next"
}

Issue object format:
{
  "title": "imperative title",
  "description": "detailed markdown",
  "labels": ["domain", "priority", "type", "size"],
  "priority": "must|should|could",
  "references": ["path#anchor"],
  "assignees": ["username"],
  "effort": "1d",
  "dependencies": ["issue-id"]
}

Do not include any text outside the JSON. If you need more steps, set "isCompleted": false and provide a hint.
If you have generated all issues, set "isCompleted": true.

Here are the input documents.
`,
    },
    {
      role: "user",
      content: buildInitialPrompt(
        plan,
        specsByName,
        assigneesSection,
        linkConfig,
      ),
    },
  ];

  let stepCount = 0;
  let completed = false;
  let writtenCount = 0;
  let skippedCount = 0;

  console.log(
    `Starting iterative generation with model ${model}, max steps ${maxSteps}, max retries per step ${maxRetries}`,
  );

  await fs.ensureDir(resolvedOutputDir);

  while (!completed && stepCount < maxSteps) {
    stepCount++;
    console.log(`Step ${stepCount}...`);

    let chunk: GenerationChunk | null = null;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries && !chunk) {
      attempt++;
      try {
        const result = await generateText({
          model: ollama(model, { keep_alive: "10m" }),
          messages,
          temperature,
          maxTokens: 8192,
        });

        let text = result.text.trim();
        if (text.startsWith("```")) {
          text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }
        chunk = JSON.parse(text);

        if (!chunk.issues || !Array.isArray(chunk.issues)) {
          throw new Error('Missing "issues" array');
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `Step ${stepCount} attempt ${attempt} failed: ${lastError.message}`,
        );

        // If error is permanent, break out of retry loop immediately
        if (!isRetryableError(lastError)) {
          console.error(`Permanent error, aborting step ${stepCount}`);
          throw lastError;
        }

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // exponential backoff
          console.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (!chunk) {
      throw (
        lastError ||
        new Error(`Step ${stepCount} failed after ${maxRetries} attempts`)
      );
    }

    // Write issues from this chunk
    for (const issue of chunk.issues) {
      if (!issue.title || !issue.description) {
        console.warn(
          `Skipping issue in step ${stepCount}: missing title or description`,
        );
        skippedCount++;
        continue;
      }

      const id = slugify(issue.title, {
        lower: true,
        strict: true,
        replacement: "-",
      }).slice(0, 50);
      let finalId = id;
      let counter = 1;
      while (
        await fs.pathExists(path.join(resolvedOutputDir, `${finalId}.md`))
      ) {
        finalId = `${id}-${counter}`;
        counter++;
      }

      const frontmatter: IssueFrontmatter = {
        id: finalId,
        title: issue.title,
        labels: issue.labels || [],
        assignees: issue.assignees || [],
        references: issue.references || [],
        state: "open",
        createdAt: new Date().toISOString(),
        priority: issue.priority || "should",
        effort: issue.effort || undefined,
        dependencies: issue.dependencies?.length
          ? issue.dependencies
          : undefined,
      };

      try {
        IssueFrontmatterSchema.parse(frontmatter);
      } catch (err) {
        console.warn(`Validation failed for issue ${finalId}:`, err);
        skippedCount++;
        continue;
      }

      const cleanFrontmatter = Object.fromEntries(
        Object.entries(frontmatter).filter(([, v]) => v !== undefined),
      );

      const fileContent = matter.stringify(issue.description, cleanFrontmatter);
      await fs.writeFile(
        path.join(resolvedOutputDir, `${finalId}.md`),
        fileContent,
      );
      writtenCount++;
    }

    completed = chunk.isCompleted === true;

    // Add assistant's response to conversation history
    messages.push({ role: "assistant", content: JSON.stringify(chunk) });

    if (!completed) {
      const hint = chunk.nextSectionHint
        ? ` Continue with: ${chunk.nextSectionHint}`
        : "";
      messages.push({
        role: "user",
        content: `Please generate the next chunk of issues.${hint} Remember to set "isCompleted" to true when you have covered everything.`,
      });
    }
  }

  if (!completed) {
    console.warn(
      `Reached maximum steps (${maxSteps}) without completion signal. Generated ${writtenCount} issues so far.`,
    );
  } else {
    console.log(
      `Generation completed in ${stepCount} steps. Total issues: ${writtenCount}`,
    );
  }

  const allIssues = await readAllIssues(resolvedOutputDir);
  const report = {
    generatedAt: new Date().toISOString(),
    totalIssues: writtenCount + skippedCount,
    written: writtenCount,
    skipped: skippedCount,
    stepsUsed: stepCount,
    completed,
    linkConfig,
    byPriority: {
      must: allIssues.filter((i) => i.priority === "must").length,
      should: allIssues.filter((i) => i.priority === "should").length,
      could: allIssues.filter((i) => i.priority === "could").length,
    },
    byLabel: {} as Record<string, number>,
    byAssignee: {} as Record<string, number>,
  };

  for (const issue of allIssues) {
    for (const label of issue.labels || []) {
      report.byLabel[label] = (report.byLabel[label] || 0) + 1;
    }
    for (const assignee of issue.assignees || []) {
      report.byAssignee[assignee] = (report.byAssignee[assignee] || 0) + 1;
    }
  }

  await fs.writeJson(path.join(resolvedOutputDir, "_report.json"), report, {
    spaces: 2,
  });
  console.log("Summary report written to _report.json");
}

async function readAllIssues(dir: string): Promise<any[]> {
  const files = await fs.readdir(dir);
  const issues = [];
  for (const file of files) {
    if (file.endsWith(".md") && file !== "_report.json") {
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const { data } = matter(content);
      issues.push(data);
    }
  }
  return issues;
}

interface LinkConfig {
  useFullUrls: boolean;
  planExample: string;
  specExample: string;
  archExample: string;
  testExample: string;
}

function buildLinkConfig(
  planPath: string,
  specsDir: string,
  outputDir: string,
  repoBaseUrl?: string,
  branch: string = "main",
): LinkConfig {
  const absPlan = path.resolve(planPath);
  const absSpecs = path.resolve(specsDir);
  const absOut = path.resolve(outputDir);
  const useFullUrls = Boolean(repoBaseUrl);

  const normalizePath = (p: string) =>
    p.replace(/^\.\//, "").replace(/\/$/, "");

  if (useFullUrls) {
    const base = `${repoBaseUrl}/blob/${branch}`;
    const planRel = normalizePath(planPath);
    const specsRel = normalizePath(specsDir);
    return {
      useFullUrls: true,
      planExample: `${base}/${planRel}#chunk-5-skill-system`,
      specExample: `${base}/${specsRel}/srs.md#req-func-040`,
      archExample: `${base}/${specsRel}/archi.md#adr-007`,
      testExample: `${base}/${specsRel}/test-verification.md#sc-func-010`,
    };
  }

  const planRel = path.relative(absOut, absPlan);
  const specRelBase = path.relative(absOut, absSpecs);

  const withDot = (rel: string) => (rel.startsWith(".") ? rel : `./${rel}`);

  return {
    useFullUrls: false,
    planExample: `${withDot(planRel)}#chunk-5-skill-system`,
    specExample: `${withDot(path.join(specRelBase, "srs.md"))}#req-func-040`,
    archExample: `${withDot(path.join(specRelBase, "archi.md"))}#adr-007`,
    testExample: `${withDot(path.join(specRelBase, "test-verification.md"))}#sc-func-010`,
  };
}

function buildInitialPrompt(
  plan: string,
  specsByName: Record<string, string>,
  assigneesSection: string,
  linkConfig: LinkConfig,
): string {
  const { useFullUrls, planExample, specExample, archExample, testExample } =
    linkConfig;

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
- [Name](${planExample}) - description

**Related Requirements:**
- [REQ-ID](${specExample}) - description

**Related Architecture:**
- [Component](${archExample}) - description

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
- [ID](${testExample}) - description

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
- Plan: \`${planExample}\`
- Specs: \`${specExample}\`
- Tests: \`${testExample}\`

Format: \`https://github.com/user/repo/blob/BRANCH/path/to/file.md#anchor\`
`
     : `
**Using RELATIVE paths** (for markdown files in the issues directory):
- Plan: \`${planExample}\`
- Specs: \`${specExample}\`
- Tests: \`${testExample}\`

These paths are correct from the location of the generated issue files.
`
 }

---

## Labels

**Domain**: backend, frontend, database, infrastructure, testing, documentation, security, performance
**Priority**: must, should, could
**Work Type**: feature, bug, refactor, test, chore
**Size**: size:small, size:medium, size:large

---

## Output Instructions

You will generate issues in **multiple chunks**. Your first response must be a valid JSON object with:
- \`issues\`: array of issue objects (as described)
- \`isCompleted\`: false (unless you truly have generated all issues in this one go)
- \`nextSectionHint\`: optional string indicating what you plan to cover next

Do not include any text outside the JSON. If you need more steps, set \`isCompleted\` to false and provide a hint.
When you have generated **all** issues, set \`isCompleted\` to true and omit the hint.

Now, begin with the first chunk.`;
}
