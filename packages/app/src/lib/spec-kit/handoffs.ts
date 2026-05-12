// Parses `handoffs:` frontmatter from slash-command markdown files.
//
// Pattern adapted from github/spec-kit's command template format. Each
// command markdown file may declare follow-up actions in its YAML
// frontmatter, which Paseo renders as one-click chips after the
// assistant turn that ran the command finishes.
//
// Example frontmatter:
//
//   ---
//   description: Create or update the feature specification.
//   handoffs:
//     - label: Build Technical Plan
//       agent: speckit.plan
//       prompt: Create a plan for the spec
//       send: true
//     - label: Clarify Spec Requirements
//       agent: speckit.clarify
//       prompt: Clarify specification requirements
//   ---
//
// This module is a minimal, dependency-free parser. It is NOT a full
// YAML implementation — it only handles the shape spec-kit uses for
// handoffs: a list of mappings with scalar string values. Anything
// outside that shape is ignored.

export interface Handoff {
  label: string;
  agent: string;
  prompt: string;
  // When true, the chip submits the prompt immediately. When false or
  // omitted, the chip populates the composer and waits for the user to
  // hit send.
  send?: boolean;
}

const FRONTMATTER_DELIM = /^---\s*$/;
const HANDOFFS_KEY = /^handoffs\s*:\s*$/;
const LIST_ITEM_START = /^(\s*)-\s+(.*)$/;
const KEY_VALUE = /^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;

/**
 * Extract the YAML frontmatter block from a markdown document.
 * Returns null if there is no frontmatter or the closing delimiter is missing.
 */
export function extractFrontmatter(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_DELIM.test(lines[0])) {
    return null;
  }
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_DELIM.test(lines[i])) {
      return lines.slice(1, i).join("\n");
    }
  }
  return null;
}

/**
 * Parse handoff entries out of a markdown document's frontmatter.
 * Returns an empty array if no frontmatter, no handoffs key, or no
 * well-formed entries.
 */
export function parseHandoffs(markdown: string): Handoff[] {
  const frontmatter = extractFrontmatter(markdown);
  if (frontmatter == null) {
    return [];
  }

  const lines = frontmatter.split("\n");
  let i = 0;

  while (i < lines.length && !HANDOFFS_KEY.test(lines[i])) {
    i++;
  }
  if (i >= lines.length) {
    return [];
  }
  i++; // step past `handoffs:`

  const handoffs: Handoff[] = [];
  let listIndent: number | null = null;
  let current: Partial<Handoff> | null = null;
  let currentItemIndent: number | null = null;

  const commit = () => {
    if (
      current &&
      typeof current.label === "string" &&
      typeof current.agent === "string" &&
      typeof current.prompt === "string"
    ) {
      handoffs.push({
        label: current.label,
        agent: current.agent,
        prompt: current.prompt,
        ...(current.send !== undefined ? { send: current.send } : {}),
      });
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;

    // Dedent below the handoffs block — we're done.
    if (listIndent !== null && indent < listIndent) {
      commit();
      current = null;
      break;
    }

    const listMatch = LIST_ITEM_START.exec(line);
    if (listMatch && (listIndent === null || indent === listIndent)) {
      commit();
      current = {};
      listIndent = indent;
      currentItemIndent = indent + 2;

      // The first key may be inline on the `- key: value` line.
      const inline = listMatch[2];
      assignFromKeyValueText(inline, current);
      continue;
    }

    if (current && currentItemIndent !== null && indent >= currentItemIndent) {
      const kv = KEY_VALUE.exec(line);
      if (kv) {
        assignFromKeyValueText(`${kv[2]}: ${kv[3]}`, current);
      }
    }
  }

  commit();
  return handoffs;
}

function assignFromKeyValueText(text: string, target: Partial<Handoff>): void {
  // text is "key: value" (with no leading indent)
  const idx = text.indexOf(":");
  if (idx <= 0) return;
  const key = text.slice(0, idx).trim();
  const rawValue = text.slice(idx + 1).trim();
  if (rawValue.length === 0) return;

  const value = unquote(rawValue);

  switch (key) {
    case "label":
      target.label = value;
      return;
    case "agent":
      target.agent = value;
      return;
    case "prompt":
      target.prompt = value;
      return;
    case "send":
      target.send = value === "true";
      return;
    default:
      // Ignore unknown keys — forward compatibility.
      return;
  }
}

function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}
