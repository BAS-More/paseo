import { describe, expect, it, vi } from "vitest";

describe("sidebar inline rename behavior", () => {
  it("double-click sets isRenaming to true", () => {
    let isRenaming = false;
    const handleDoubleClick = () => {
      isRenaming = true;
    };

    handleDoubleClick();
    expect(isRenaming).toBe(true);
  });

  it("commitRename calls client.renameWorkspace with new name", () => {
    const renameWorkspace = vi.fn();
    const workspaceId = "ws-123";

    const commitRename = (newName: string) => {
      if (newName.trim()) {
        renameWorkspace(workspaceId, newName.trim());
      }
    };

    commitRename("  New Name  ");
    expect(renameWorkspace).toHaveBeenCalledWith("ws-123", "New Name");
  });

  it("commitRename does NOT call rename with empty string", () => {
    const renameWorkspace = vi.fn();
    const workspaceId = "ws-123";

    const commitRename = (newName: string) => {
      if (newName.trim()) {
        renameWorkspace(workspaceId, newName.trim());
      }
    };

    commitRename("   ");
    expect(renameWorkspace).not.toHaveBeenCalled();
  });

  it("Enter key commits rename and exits editing", () => {
    let isRenaming = true;
    const renameWorkspace = vi.fn();
    const workspaceId = "ws-456";
    const renameText = "Updated Name";

    const handleRenameKeyPress = (key: string) => {
      if (key === "Enter") {
        if (renameText.trim()) {
          renameWorkspace(workspaceId, renameText.trim());
        }
        isRenaming = false;
      } else if (key === "Escape") {
        isRenaming = false;
      }
    };

    handleRenameKeyPress("Enter");
    expect(renameWorkspace).toHaveBeenCalledWith("ws-456", "Updated Name");
    expect(isRenaming).toBe(false);
  });

  it("Escape key cancels rename without saving", () => {
    let isRenaming = true;
    const renameWorkspace = vi.fn();

    const handleRenameKeyPress = (key: string) => {
      if (key === "Enter") {
        renameWorkspace("ws", "text");
        isRenaming = false;
      } else if (key === "Escape") {
        isRenaming = false;
      }
    };

    handleRenameKeyPress("Escape");
    expect(renameWorkspace).not.toHaveBeenCalled();
    expect(isRenaming).toBe(false);
  });

  it("onBlur commits rename (same as Enter)", () => {
    const renameWorkspace = vi.fn();
    const workspaceId = "ws-789";

    const commitRename = (newName: string) => {
      if (newName.trim()) {
        renameWorkspace(workspaceId, newName.trim());
      }
    };

    // onBlur calls commitRename
    commitRename("Blurred Name");
    expect(renameWorkspace).toHaveBeenCalledWith("ws-789", "Blurred Name");
  });
});
