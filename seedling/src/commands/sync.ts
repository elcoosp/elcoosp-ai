import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { Octokit } from "@octokit/rest";
import { IssueMapping, IssueFrontmatter } from "../types.js";

export async function syncIssues(
  token: string,
  owner: string,
  repo: string,
  issuesDir: string,
  mappingFile: string,
  dryRun = false,
) {
  const octokit = new Octokit({ auth: token });
  const mapping: IssueMapping = await fs
    .readJSON(mappingFile)
    .catch(() => ({}));

  let dirty = false;

  // Get all existing labels
  const { data: existingLabels } = await octokit.rest.issues.listLabelsForRepo({
    owner,
    repo,
  });
  const labelSet = new Set(existingLabels.map((l) => l.name));

  // Read all markdown files
  const files = await fs.readdir(issuesDir);
  const processed = new Set<string>();

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const fullPath = path.join(issuesDir, file);
    const content = await fs.readFile(fullPath, "utf-8");
    const { data: frontmatter, content: body } = matter(content);
    const stats = await fs.stat(fullPath);

    // Get id from frontmatter or filename
    const id = (frontmatter.id as string) || file.replace(/\.md$/, "");
    const mtime = stats.mtimeMs;

    // Validate required fields
    if (!frontmatter.title) {
      console.warn(`Skipping ${file}: missing title`);
      continue;
    }

    const labels = (frontmatter.labels as string[]) || [];

    // Ensure labels exist
    for (const label of labels) {
      if (!labelSet.has(label)) {
        if (dryRun) {
          console.log(`[dry-run] Would create label: ${label}`);
        } else {
          await octokit.rest.issues.createLabel({
            owner,
            repo,
            name: label,
            color: "ededed",
          });
          labelSet.add(label);
        }
      }
    }

    if (!mapping[id]) {
      // Create new issue
      if (dryRun) {
        console.log(`[dry-run] Would create issue: ${frontmatter.title}`);
      } else {
        const { data: issue } = await octokit.rest.issues.create({
          owner,
          repo,
          title: frontmatter.title,
          body,
          labels,
          assignees: frontmatter.assignees || [],
        });
        mapping[id] = { number: issue.number, mtime };
        dirty = true;
        console.log(`Created issue #${issue.number} for ${id}`);
      }
    } else if (mapping[id].mtime !== mtime) {
      // Update existing issue
      const issueNumber = mapping[id].number;
      if (dryRun) {
        console.log(
          `[dry-run] Would update issue #${issueNumber}: ${frontmatter.title}`,
        );
      } else {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          title: frontmatter.title,
          body,
          state: frontmatter.state || "open",
        });
        // Replace labels
        await octokit.rest.issues.setLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels,
        });
        mapping[id].mtime = mtime;
        dirty = true;
        console.log(`Updated issue #${issueNumber} for ${id}`);
      }
    } else {
      console.log(`No changes for ${id} (issue #${mapping[id].number})`);
    }
    processed.add(id);
  }

  // Handle deleted files: close issues
  for (const [id, data] of Object.entries(mapping)) {
    if (!processed.has(id)) {
      if (dryRun) {
        console.log(`[dry-run] Would close issue #${data.number}`);
      } else {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: data.number,
          state: "closed",
        });
        delete mapping[id];
        dirty = true;
        console.log(`Closed issue #${data.number} (file deleted)`);
      }
    }
  }

  // Write updated mapping only if changes were made
  if (!dryRun && dirty) {
    await fs.writeJSON(mappingFile, mapping, { spaces: 2 });
  }
}
