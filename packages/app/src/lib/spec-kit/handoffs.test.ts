import { describe, expect, it } from "vitest";
import { extractFrontmatter, parseHandoffs } from "./handoffs";

describe("extractFrontmatter", () => {
  it("returns null when there is no frontmatter", () => {
    expect(extractFrontmatter("# Just markdown\n\nNo frontmatter here.")).toBeNull();
  });

  it("returns null when the closing delimiter is missing", () => {
    expect(extractFrontmatter("---\ndescription: x\n# body without close")).toBeNull();
  });

  it("extracts content between --- delimiters", () => {
    const md = "---\ndescription: x\nhandoffs: []\n---\n# body";
    expect(extractFrontmatter(md)).toBe("description: x\nhandoffs: []");
  });

  it("tolerates Windows-style CRLF line endings", () => {
    const md = "---\r\ndescription: x\r\n---\r\nbody";
    expect(extractFrontmatter(md)).toBe("description: x");
  });
});

describe("parseHandoffs", () => {
  it("returns empty when no frontmatter", () => {
    expect(parseHandoffs("# no frontmatter")).toEqual([]);
  });

  it("returns empty when frontmatter has no handoffs key", () => {
    const md = "---\ndescription: just a description\n---\nbody";
    expect(parseHandoffs(md)).toEqual([]);
  });

  it("parses a single handoff with all fields", () => {
    const md = [
      "---",
      "description: Create the spec",
      "handoffs:",
      "  - label: Build Technical Plan",
      "    agent: speckit.plan",
      "    prompt: Create a plan for the spec",
      "    send: true",
      "---",
      "body",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      {
        label: "Build Technical Plan",
        agent: "speckit.plan",
        prompt: "Create a plan for the spec",
        send: true,
      },
    ]);
  });

  it("parses multiple handoffs preserving order", () => {
    const md = [
      "---",
      "handoffs:",
      "  - label: Plan",
      "    agent: speckit.plan",
      "    prompt: Plan it",
      "  - label: Clarify",
      "    agent: speckit.clarify",
      "    prompt: Clarify it",
      "    send: true",
      "---",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      { label: "Plan", agent: "speckit.plan", prompt: "Plan it" },
      { label: "Clarify", agent: "speckit.clarify", prompt: "Clarify it", send: true },
    ]);
  });

  it("omits send when not present (rather than defaulting to false)", () => {
    const md = [
      "---",
      "handoffs:",
      "  - label: Plan",
      "    agent: speckit.plan",
      "    prompt: Plan it",
      "---",
    ].join("\n");

    const result = parseHandoffs(md);
    expect(result).toHaveLength(1);
    expect("send" in result[0]).toBe(false);
  });

  it("strips matching surrounding quotes from values", () => {
    const md = [
      "---",
      "handoffs:",
      '  - label: "Build the Plan"',
      "    agent: 'speckit.plan'",
      '    prompt: "Create a plan, please"',
      "---",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      { label: "Build the Plan", agent: "speckit.plan", prompt: "Create a plan, please" },
    ]);
  });

  it("ignores unknown keys for forward compatibility", () => {
    const md = [
      "---",
      "handoffs:",
      "  - label: Plan",
      "    agent: speckit.plan",
      "    prompt: Plan it",
      "    icon: rocket",
      "    priority: 5",
      "---",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      { label: "Plan", agent: "speckit.plan", prompt: "Plan it" },
    ]);
  });

  it("skips an entry missing any required field", () => {
    const md = [
      "---",
      "handoffs:",
      "  - label: Incomplete",
      "    agent: speckit.plan",
      "  - label: Complete",
      "    agent: speckit.plan",
      "    prompt: ok",
      "---",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([{ label: "Complete", agent: "speckit.plan", prompt: "ok" }]);
  });

  it("stops parsing when the handoffs block dedents to a sibling key", () => {
    const md = [
      "---",
      "handoffs:",
      "  - label: Plan",
      "    agent: speckit.plan",
      "    prompt: Plan it",
      "scripts:",
      "  sh: scripts/bash/setup-plan.sh",
      "---",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      { label: "Plan", agent: "speckit.plan", prompt: "Plan it" },
    ]);
  });

  it("treats `send: false` as explicitly false", () => {
    const md = [
      "---",
      "handoffs:",
      "  - label: Plan",
      "    agent: speckit.plan",
      "    prompt: Plan it",
      "    send: false",
      "---",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      { label: "Plan", agent: "speckit.plan", prompt: "Plan it", send: false },
    ]);
  });

  it("handles the real spec-kit specify.md frontmatter shape", () => {
    const md = [
      "---",
      "description: Create or update the feature specification from a natural language feature description.",
      "handoffs: ",
      "  - label: Build Technical Plan",
      "    agent: speckit.plan",
      "    prompt: Create a plan for the spec. I am building with...",
      "  - label: Clarify Spec Requirements",
      "    agent: speckit.clarify",
      "    prompt: Clarify specification requirements",
      "    send: true",
      "---",
      "",
      "## User Input",
    ].join("\n");

    expect(parseHandoffs(md)).toEqual([
      {
        label: "Build Technical Plan",
        agent: "speckit.plan",
        prompt: "Create a plan for the spec. I am building with...",
      },
      {
        label: "Clarify Spec Requirements",
        agent: "speckit.clarify",
        prompt: "Clarify specification requirements",
        send: true,
      },
    ]);
  });
});
