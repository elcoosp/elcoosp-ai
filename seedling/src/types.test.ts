import { describe, it, expect } from "vitest";
import { IssueFrontmatterSchema } from "./types.js";

describe("IssueFrontmatterSchema", () => {
  it("should validate correct frontmatter", () => {
    const input = {
      title: "Test Issue",
      labels: ["bug"],
      assignees: ["user1"],
    };
    const result = IssueFrontmatterSchema.parse(input);
    expect(result.title).toBe("Test Issue");
    expect(result.labels).toEqual(["bug"]);
  });

  it("should provide defaults", () => {
    const input = { title: "Test" };
    const result = IssueFrontmatterSchema.parse(input);
    expect(result.labels).toEqual([]);
    expect(result.assignees).toEqual([]);
    expect(result.references).toEqual([]);
    expect(result.state).toBe("open");
  });

  it("should reject missing title", () => {
    const input = { labels: [] };
    expect(() => IssueFrontmatterSchema.parse(input)).toThrow();
  });
});
