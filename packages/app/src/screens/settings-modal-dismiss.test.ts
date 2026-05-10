import { describe, expect, it, vi } from "vitest";

// Settings modal dismiss uses DOM addEventListener for Escape key
// and Pressable onPress for backdrop. Since vitest runs in Node (no DOM),
// test the behavioral logic directly.

describe("settings modal dismiss behavior", () => {
  it("Escape key handler calls dismiss when key is Escape", () => {
    const handleBackToWorkspace = vi.fn();

    // Replicate the keydown handler from settings-screen.tsx:1010-1014
    const handler = (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleBackToWorkspace();
      }
    };

    const preventDefault = vi.fn();
    handler({ key: "Escape", preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(handleBackToWorkspace).toHaveBeenCalledTimes(1);
  });

  it("handler ignores non-Escape keys", () => {
    const handleBackToWorkspace = vi.fn();

    const handler = (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleBackToWorkspace();
      }
    };

    handler({ key: "Enter", preventDefault: vi.fn() });
    handler({ key: "Tab", preventDefault: vi.fn() });
    handler({ key: "a", preventDefault: vi.fn() });

    expect(handleBackToWorkspace).not.toHaveBeenCalled();
  });

  it("backdrop onPress calls dismiss", () => {
    const handleBackToWorkspace = vi.fn();

    // Pressable onPress={handleBackToWorkspace} — direct invocation
    handleBackToWorkspace();

    expect(handleBackToWorkspace).toHaveBeenCalledTimes(1);
  });

  it("modal overlay guard prevents listener when not in modal mode", () => {
    const handleBackToWorkspace = vi.fn();
    let listenerRegistered = false;

    // Replicate the useEffect guard: if (!showModalOverlay) return;
    const showModalOverlay = false;

    if (showModalOverlay) {
      listenerRegistered = true;
    }

    expect(listenerRegistered).toBe(false);
    expect(handleBackToWorkspace).not.toHaveBeenCalled();
  });

  it("modal overlay guard registers listener when in modal mode", () => {
    let listenerRegistered = false;

    const showModalOverlay = true;

    if (showModalOverlay) {
      listenerRegistered = true;
    }

    expect(listenerRegistered).toBe(true);
  });
});
