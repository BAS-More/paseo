import { describe, expect, it } from "vitest";
import { lightClaudeTheme, THEME_TO_UNISTYLES, THEME_SWATCHES } from "./theme";

describe("lightClaudeTheme", () => {
  it("has light color scheme", () => {
    expect(lightClaudeTheme.colorScheme).toBe("light");
  });

  it("has warm beige background color", () => {
    expect(lightClaudeTheme.colors.background).toBe("#FAF9F5");
  });

  it("has userBubble semantic token", () => {
    expect(lightClaudeTheme.colors.userBubble).toBe("#F0EFE9");
  });

  it("has surface tokens", () => {
    expect(lightClaudeTheme.colors.surface0).toBeDefined();
    expect(lightClaudeTheme.colors.surface1).toBeDefined();
    expect(lightClaudeTheme.colors.surface2).toBeDefined();
    expect(lightClaudeTheme.colors.surface3).toBeDefined();
  });

  it("has foreground tokens", () => {
    expect(lightClaudeTheme.colors.foreground).toBeDefined();
    expect(lightClaudeTheme.colors.foregroundMuted).toBeDefined();
  });

  it("has accent color", () => {
    expect(lightClaudeTheme.colors.accent).toBeDefined();
  });

  it("has shadow definitions", () => {
    expect(lightClaudeTheme.shadow.sm).toBeDefined();
    expect(lightClaudeTheme.shadow.md).toBeDefined();
    expect(lightClaudeTheme.shadow.lg).toBeDefined();
  });

  it("has palette base colors", () => {
    expect(lightClaudeTheme.colors.palette).toBeDefined();
  });

  it("has terminal colors", () => {
    expect(lightClaudeTheme.colors.terminal).toBeDefined();
    expect(lightClaudeTheme.colors.terminal.background).toBe("#FAF9F5");
  });
});

describe("THEME_TO_UNISTYLES", () => {
  it("maps claudeLight to lightClaude unistyles key", () => {
    expect(THEME_TO_UNISTYLES.claudeLight).toBe("lightClaude");
  });

  it("includes all expected theme names", () => {
    const keys = Object.keys(THEME_TO_UNISTYLES);
    expect(keys).toContain("light");
    expect(keys).toContain("dark");
    expect(keys).toContain("claudeLight");
  });
});

describe("THEME_SWATCHES", () => {
  it("has warm beige swatch for claudeLight", () => {
    expect(THEME_SWATCHES.claudeLight).toBe("#FAF9F5");
  });

  it("has swatches for all themes", () => {
    for (const key of Object.keys(THEME_TO_UNISTYLES)) {
      expect(THEME_SWATCHES[key as keyof typeof THEME_SWATCHES]).toBeDefined();
    }
  });
});
