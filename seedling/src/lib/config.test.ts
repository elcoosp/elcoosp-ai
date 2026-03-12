import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs-extra";
import { readConfig } from "./config.js"; // Correct relative import

vi.mock("fs-extra");

describe("readConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return empty object if config file does not exist", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false);
    const config = await readConfig();
    expect(config).toEqual({});
  });

  it("should read and return config if file exists", async () => {
    const mockConfig = { specsDir: "./specs", issuesDir: "./issues" };
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readJSON).mockResolvedValue(mockConfig);
    const config = await readConfig();
    expect(config).toEqual(mockConfig);
  });

  it("should use custom config path", async () => {
    const customPath = "/custom/path/config.json";
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readJSON).mockResolvedValue({});
    await readConfig(customPath);
    expect(fs.pathExists).toHaveBeenCalledWith(customPath);
  });
});
