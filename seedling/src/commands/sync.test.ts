import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs-extra";
import { syncIssues } from "./sync.js";
import { Octokit } from "@octokit/rest";

// Mock fs-extra
vi.mock("fs-extra");

// Mock the Octokit module (just the constructor)
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(),
}));

describe("syncIssues", () => {
  const token = "fake-token";
  const owner = "owner";
  const repo = "repo";
  const issuesDir = "issues";
  const mappingFile = "mapping.json";

  // Helper to set up the Octokit mock with fresh spies and return them
  const setupMockOctokit = () => {
    const mockCreate = vi.fn();
    const mockUpdate = vi.fn();
    const mockSetLabels = vi.fn();
    const mockListLabels = vi.fn().mockResolvedValue({ data: [] });
    const mockCreateLabel = vi.fn();

    const mockInstance = {
      rest: {
        issues: {
          create: mockCreate,
          update: mockUpdate,
          setLabels: mockSetLabels,
          listLabelsForRepo: mockListLabels,
          createLabel: mockCreateLabel,
        },
      },
    };

    // FIX: Use a regular function expression instead of an arrow function.
    // Arrow functions cannot be constructed (called with `new`).
    vi.mocked(Octokit).mockImplementation(function () {
      return mockInstance as any;
    });

    return {
      mockCreate,
      mockUpdate,
      mockSetLabels,
      mockListLabels,
      mockCreateLabel,
    };
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Default fs mocks
    vi.mocked(fs.readJSON).mockRejectedValue(new Error("not found")); // mapping missing
    vi.mocked(fs.readdir).mockResolvedValue(["001-test.md"] as any);
    vi.mocked(fs.readFile).mockResolvedValue(
      '---\ntitle: Test Issue\nlabels: ["bug"]\n---\nBody content',
    );
    vi.mocked(fs.stat).mockResolvedValue({ mtimeMs: 123456 } as any);
  });

  it("should create a new issue if not in mapping", async () => {
    const { mockCreate, mockListLabels } = setupMockOctokit();
    mockCreate.mockResolvedValue({ data: { number: 42 } });

    await syncIssues(token, owner, repo, issuesDir, mappingFile);

    expect(mockCreate).toHaveBeenCalledWith({
      owner,
      repo,
      title: "Test Issue",
      body: "Body content",
      labels: ["bug"],
      assignees: [],
    });
    expect(fs.writeJSON).toHaveBeenCalledWith(
      mappingFile,
      expect.objectContaining({
        "001-test": { number: 42, mtime: 123456 },
      }),
      expect.anything(),
    );
  });

  it("should update issue if mtime changed", async () => {
    const { mockUpdate, mockSetLabels, mockListLabels } = setupMockOctokit();
    vi.mocked(fs.readJSON).mockResolvedValue({
      "001-test": { number: 42, mtime: 100000 },
    });
    mockListLabels.mockResolvedValue({ data: [{ name: "bug" }] });

    await syncIssues(token, owner, repo, issuesDir, mappingFile);

    expect(mockUpdate).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: 42,
      title: "Test Issue",
      body: "Body content",
      state: "open",
    });
    expect(mockSetLabels).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: 42,
      labels: ["bug"],
    });
    expect(fs.writeJSON).toHaveBeenCalled();
  });

  it("should not update if mtime unchanged", async () => {
    const { mockUpdate, mockListLabels } = setupMockOctokit();
    vi.mocked(fs.readJSON).mockResolvedValue({
      "001-test": { number: 42, mtime: 123456 },
    });
    mockListLabels.mockResolvedValue({ data: [{ name: "bug" }] });

    await syncIssues(token, owner, repo, issuesDir, mappingFile);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(fs.writeJSON).not.toHaveBeenCalled();
  });

  it("should close issue if file deleted", async () => {
    const { mockUpdate, mockListLabels } = setupMockOctokit();
    vi.mocked(fs.readJSON).mockResolvedValue({
      "001-test": { number: 42, mtime: 123456 },
      "002-old": { number: 99, mtime: 111111 },
    });
    vi.mocked(fs.readdir).mockResolvedValue(["001-test.md"] as any); // 002-old missing
    mockListLabels.mockResolvedValue({ data: [{ name: "bug" }] });

    await syncIssues(token, owner, repo, issuesDir, mappingFile);

    expect(mockUpdate).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: 99,
      state: "closed",
    });
    const savedMapping = vi.mocked(fs.writeJSON).mock.calls[0][1];
    expect(savedMapping).not.toHaveProperty("002-old");
  });

  it("should handle dry-run mode", async () => {
    const { mockCreate } = setupMockOctokit();
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncIssues(token, owner, repo, issuesDir, mappingFile, true);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dry-run] Would create issue: Test Issue"),
    );
    expect(fs.writeJSON).not.toHaveBeenCalled();
  });
});
