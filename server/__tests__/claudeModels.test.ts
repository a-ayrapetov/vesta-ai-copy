import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { getClaudeModels, DEFAULT_CLAUDE_MODELS } from "../services/claudeModels";

describe("getClaudeModels", () => {
  it("defaults to current Sonnet then Haiku", () => {
    expect(getClaudeModels({})).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("never defaults to a retired Claude 3 model", () => {
    for (const model of DEFAULT_CLAUDE_MODELS) {
      expect(model.startsWith("claude-3")).toBe(false);
    }
  });

  it("puts ANTHROPIC_MODEL first when set", () => {
    expect(getClaudeModels({ ANTHROPIC_MODEL: "claude-opus-5-5" })).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("does not list a model twice when the override is already a default", () => {
    expect(getClaudeModels({ ANTHROPIC_MODEL: "claude-haiku-5-5" })).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ]);
  });

  it("ignores a blank override", () => {
    expect(getClaudeModels({ ANTHROPIC_MODEL: "  " })).toEqual(DEFAULT_CLAUDE_MODELS);
  });
});

describe("fashionAi model wiring", () => {
  it("has no hard-coded Claude model IDs left in the chat service", () => {
    const source = readFileSync(
      path.join(__dirname, "..", "services", "fashionAi.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/["']claude-[a-z0-9-]+["']/);
  });
});
