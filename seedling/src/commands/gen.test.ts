import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs-extra";
import { generateIssues } from "./gen.js";
import { generateText } from "ai";

// Mock all dependencies
vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    pathExists: vi.fn(),
  },
  readFile: vi.fn(),
  readdir: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  writeJson: vi.fn(),
  pathExists: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/ollama", () => ({
  ollama: vi.fn(() => ({
    specificationVersion: "v1",
    provider: "ollama",
    modelId: "llama3.2",
    defaultObjectGenerationMode: "json",
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  })),
}));

vi.mock("../lib/config.js", () => ({
  readConfig: vi.fn(),
}));

// Import after mocks
import { readConfig } from "../lib/config.js";

describe("generateIssues", () => {
  const planPath = "plan.md";
  const specsDir = "specs";
  const outputDir = "issues";

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock readConfig to return a valid config object
    vi.mocked(readConfig).mockResolvedValue({
      llm: {
        model: "llama3.2",
        temperature: 0.15,
      },
      assignees: [],
    });

    // Mock fs.readFile for plan and specs
    vi.mocked(fs.readFile).mockImplementation(async (file: string) => {
      if (file === planPath) return "# Implementation Plan\n\nChunk 1: Setup";
      if (typeof file === "string" && file.includes("specs")) {
        const filename = file.split("/").pop() || file.split("\\").pop() || "";
        return `# ${filename}\n\nSome spec content`;
      }
      return "";
    });

    // Mock fs.readdir to return spec files
    vi.mocked(fs.readdir).mockResolvedValue(["archi.md", "srs.md"] as any);

    // Mock fs.ensureDir
    vi.mocked(fs.ensureDir).mockResolvedValue();

    // Mock fs.writeFile
    vi.mocked(fs.writeFile).mockResolvedValue();

    // Mock fs.writeJson for the report
    vi.mocked(fs.writeJson).mockResolvedValue();

    // Mock fs.pathExists if used
    vi.mocked(fs.pathExists).mockResolvedValue(true);
  });

  it("should generate issues and write files", async () => {
    const mockIssues = [
      {
        title: "Implement feature X",
        description: "## Context\n\nDo something",
        labels: ["backend"],
        priority: "must",
        references: ["archi.md#42"],
        assignees: [],
        effort: "2d",
        dependencies: [],
      },
    ];

    const mockResponse = {
      text: JSON.stringify(mockIssues),
    };
    vi.mocked(generateText).mockResolvedValue(mockResponse as any);

    await generateIssues(planPath, specsDir, outputDir);

    // Should write 1 issue file
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    // Should write 1 report file
    expect(fs.writeJson).toHaveBeenCalledTimes(1);

    // Check the issue file was written
    const issueCall = vi.mocked(fs.writeFile).mock.calls[0];
    expect(issueCall[0]).toContain(outputDir);
    expect(issueCall[1]).toContain("Implement feature X");

    // Check the report was written
    const reportCall = vi.mocked(fs.writeJson).mock.calls[0];
    expect(reportCall[0]).toContain("_report.json");
    expect(reportCall[1]).toMatchObject({
      totalIssues: 1,
      byPriority: { must: 1, should: 0 },
    });
  });

  it("should handle multiple issues", async () => {
    const mockIssues = [
      {
        title: "Implement feature X",
        description: "Description X",
        labels: ["backend"],
        priority: "must",
        references: ["srs.md#REQ-FUNC-001"],
        assignees: [],
      },
      {
        title: "Add frontend component",
        description: "Description Y",
        labels: ["frontend"],
        priority: "should",
        references: ["archi.md#component"],
        assignees: [],
      },
    ];

    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(mockIssues),
    } as any);

    await generateIssues(planPath, specsDir, outputDir);

    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it("should throw if LLM returns invalid JSON", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "not json" } as any);

    await expect(generateIssues(planPath, specsDir, outputDir)).rejects.toThrow(
      "Failed to parse LLM response",
    );
  });

  it("should handle JSON wrapped in markdown code blocks", async () => {
    const mockIssues = [
      {
        title: "Test issue",
        description: "Test description",
        labels: ["test"],
        priority: "should",
        references: [],
        assignees: [],
      },
    ];

    // Simulate LLM wrapping JSON in markdown
    vi.mocked(generateText).mockResolvedValue({
      text: "```json\n" + JSON.stringify(mockIssues) + "\n```",
    } as any);

    await generateIssues(planPath, specsDir, outputDir);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(outputDir),
      expect.stringContaining("Test issue"),
    );
  });

  it("should skip issues missing required fields", async () => {
    const mockIssues = [
      {
        title: "Valid issue",
        description: "Valid description",
        labels: ["backend"],
        priority: "must",
        references: [],
        assignees: [],
      },
      {
        // Missing title and description
        labels: ["frontend"],
        priority: "should",
      },
      {
        title: "Another valid issue",
        description: "Another description",
        labels: ["database"],
        priority: "should",
        references: [],
        assignees: [],
      },
    ];

    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(mockIssues),
    } as any);

    await generateIssues(planPath, specsDir, outputDir);

    // Should only write 2 valid issues
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it("should apply config defaults", async () => {
    const mockIssues = [
      {
        title: "Test issue",
        description: "Test",
        labels: ["backend"],
        priority: "should",
        references: [],
      },
    ];

    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(mockIssues),
    } as any);

    await generateIssues(planPath, specsDir, outputDir, {
      model: "llama3.1",
      temperature: 0.1,
    });

    // generateText should have been called with the model and temperature
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.1,
      }),
    );
  });

  it("should label issues correctly by priority", async () => {
    const mockIssues = [
      {
        title: "Must have feature",
        description: "Critical feature",
        labels: ["backend", "must"],
        priority: "must",
        references: [],
        assignees: [],
      },
      {
        title: "Nice to have",
        description: "Enhancement",
        labels: ["frontend", "should"],
        priority: "should",
        references: [],
        assignees: [],
      },
    ];

    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(mockIssues),
    } as any);

    await generateIssues(planPath, specsDir, outputDir);

    // Check the report has correct priority counts
    const reportCall = vi.mocked(fs.writeJson).mock.calls[0];
    expect(reportCall[1]).toMatchObject({
      byPriority: { must: 1, should: 1 },
      byLabel: {
        backend: 1,
        frontend: 1,
        must: 1,
        should: 1,
      },
    });
  });

  it("should use config assignees in prompt", async () => {
    // Mock config with assignees
    vi.mocked(readConfig).mockResolvedValue({
      llm: {
        model: "llama3.2",
        temperature: 0.15,
      },
      assignees: [
        {
          username: "alice",
          role: "Backend Developer",
          expertise: ["rust", "backend"],
        },
        {
          username: "bob",
          role: "Frontend Developer",
          expertise: ["react", "typescript"],
        },
      ],
    });

    const mockIssues = [
      {
        title: "Test issue",
        description: "Test",
        labels: ["backend"],
        priority: "must",
        references: [],
        assignees: ["alice"],
      },
    ];

    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(mockIssues),
    } as any);

    await generateIssues(planPath, specsDir, outputDir);

    // Verify generateText was called
    expect(generateText).toHaveBeenCalled();

    // Verify assignees appear in the report
    const reportCall = vi.mocked(fs.writeJson).mock.calls[0];
    expect(reportCall[1]).toMatchObject({
      byAssignee: { alice: 1 },
    });
  });

  it("should use planPath from config when CLI flag is missing", async () => {
    // Mock config with planPath
    vi.mocked(readConfig).mockResolvedValue({
      planPath: "config-plan.md",
      llm: { model: "llama3.2", temperature: 0.15 },
      assignees: [],
    });

    const mockIssues = [
      {
        title: "Config plan issue",
        description: "From config",
        labels: ["test"],
        priority: "must",
        references: [],
        assignees: [],
      },
    ];

    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify(mockIssues),
    } as any);

    // Call generateIssues without planPath (pass undefined)
    await generateIssues(undefined, specsDir, outputDir, {
      configPath: "dummy.json",
    });

    // Verify fs.readFile was called with the config plan path
    expect(fs.readFile).toHaveBeenCalledWith("config-plan.md", "utf-8");
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it("should throw error if no planPath provided", async () => {
    vi.mocked(readConfig).mockResolvedValue({}); // empty config

    await expect(
      generateIssues(undefined, specsDir, outputDir),
    ).rejects.toThrow(
      "Plan path must be provided either via --plan flag or planPath in config file",
    );
  });
});
