import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import {
  buildExplorerCheckoutKey,
  resolveExplorerTabForCheckout,
  type ExplorerTab,
} from "@/stores/explorer-tab-memory";
import {
  selectIsAgentListOpen,
  selectIsFileExplorerOpen,
  selectPanelVisibility,
  usePanelStore,
  type PanelState,
} from "@/stores/panel-store";

function resetPanelStore() {
  usePanelStore.setState({
    mobileView: "agent",
    desktop: {
      agentListOpen: false,
      fileExplorerOpen: false,
      focusModeEnabled: false,
      rightPanel: null,
    },
    explorerTab: "changes",
    explorerTabByCheckout: {},
  });
}

function createPanelState(input: {
  mobileView: PanelState["mobileView"];
  agentListOpen: boolean;
  fileExplorerOpen: boolean;
}): PanelState {
  return {
    ...usePanelStore.getState(),
    mobileView: input.mobileView,
    desktop: {
      ...usePanelStore.getState().desktop,
      agentListOpen: input.agentListOpen,
      fileExplorerOpen: input.fileExplorerOpen,
    },
  };
}

beforeEach(() => {
  resetPanelStore();
});

describe("panel-store explorer tab resolution", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo";

  it("defaults to changes for git checkouts", () => {
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {},
      }),
    ).toBe("changes");
  });

  it("defaults to files for non-git checkouts", () => {
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: false,
        explorerTabByCheckout: {},
      }),
    ).toBe("files");
  });

  it("restores a stored files tab for git checkouts", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {
          [key]: "files",
        },
      }),
    ).toBe("files");
  });

  it("falls back to default when stored tab is invalid", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: true,
        explorerTabByCheckout: {
          [key]: "terminals" as unknown as ExplorerTab,
        },
      }),
    ).toBe("changes");
  });

  it("coerces stored changes to files for non-git checkouts", () => {
    const key = buildExplorerCheckoutKey(serverId, cwd)!;
    expect(
      resolveExplorerTabForCheckout({
        serverId,
        cwd,
        isGit: false,
        explorerTabByCheckout: {
          [key]: "changes",
        },
      }),
    ).toBe("files");
  });
});

describe("panel-store visibility selectors", () => {
  it("uses mobileView for compact layout visibility", () => {
    const state = createPanelState({
      mobileView: "file-explorer",
      agentListOpen: true,
      fileExplorerOpen: false,
    });

    expect(selectPanelVisibility(state, { isCompact: true })).toEqual({
      isAgentListOpen: false,
      isFileExplorerOpen: true,
    });
    expect(selectIsAgentListOpen(state, { isCompact: true })).toBe(false);
    expect(selectIsFileExplorerOpen(state, { isCompact: true })).toBe(true);
  });

  it("uses desktop flags for expanded layout visibility", () => {
    const state = createPanelState({
      mobileView: "file-explorer",
      agentListOpen: true,
      fileExplorerOpen: false,
    });

    expect(selectPanelVisibility(state, { isCompact: false })).toEqual({
      isAgentListOpen: true,
      isFileExplorerOpen: false,
    });
    expect(selectIsAgentListOpen(state, { isCompact: false })).toBe(true);
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(false);
  });
});

describe("panel-store checkout-intent file explorer actions", () => {
  it("opens the compact explorer and resolves the tab from the explicit checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    usePanelStore.setState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "files" },
    });

    usePanelStore.getState().openFileExplorerForCheckout({
      isCompact: true,
      checkout,
    });

    expect(usePanelStore.getState().mobileView).toBe("file-explorer");
    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(false);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });

  it("opens the expanded explorer and resolves the tab from the explicit checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    usePanelStore.setState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "files" },
    });

    usePanelStore.getState().openFileExplorerForCheckout({
      isCompact: false,
      checkout,
    });

    expect(usePanelStore.getState().mobileView).toBe("agent");
    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(true);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });

  it("toggles the explorer closed without changing the active tab", () => {
    usePanelStore.setState({
      desktop: {
        agentListOpen: false,
        fileExplorerOpen: true,
        focusModeEnabled: false,
        rightPanel: null,
      },
      explorerTab: "files",
    });

    usePanelStore.getState().toggleFileExplorerForCheckout({
      isCompact: false,
      checkout: { serverId: "server-1", cwd: "/tmp/repo", isGit: true },
    });

    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(false);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });

  it("coerces changes to files for a non-git checkout", () => {
    const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: false };
    const key = buildExplorerCheckoutKey(checkout.serverId, checkout.cwd)!;
    usePanelStore.setState({
      explorerTab: "changes",
      explorerTabByCheckout: { [key]: "changes" },
    });

    usePanelStore.getState().openFileExplorerForCheckout({
      isCompact: false,
      checkout,
    });

    expect(usePanelStore.getState().explorerTab).toBe("files");
  });

  it("opens with the default files tab for an explicit non-git checkout with no stored tab", () => {
    usePanelStore.setState({ explorerTab: "changes", explorerTabByCheckout: {} });

    usePanelStore.getState().openFileExplorerForCheckout({
      isCompact: false,
      checkout: { serverId: "server-1", cwd: "/tmp/non-git", isGit: false },
    });

    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(true);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });
});

describe("panel-store right panel actions", () => {
  it("setRightPanel sets the active panel", () => {
    usePanelStore.getState().setRightPanel("preview");
    expect(usePanelStore.getState().desktop.rightPanel).toBe("preview");
  });

  it("setRightPanel(null) clears the active panel", () => {
    usePanelStore.getState().setRightPanel("preview");
    usePanelStore.getState().setRightPanel(null);
    expect(usePanelStore.getState().desktop.rightPanel).toBeNull();
  });

  it("toggleRightPanel activates a panel when none is active", () => {
    usePanelStore.getState().toggleRightPanel("terminal");
    expect(usePanelStore.getState().desktop.rightPanel).toBe("terminal");
  });

  it("toggleRightPanel deactivates the currently active panel", () => {
    usePanelStore.getState().setRightPanel("terminal");
    usePanelStore.getState().toggleRightPanel("terminal");
    expect(usePanelStore.getState().desktop.rightPanel).toBeNull();
  });

  it("toggleRightPanel switches to a different panel", () => {
    usePanelStore.getState().setRightPanel("terminal");
    usePanelStore.getState().toggleRightPanel("preview");
    expect(usePanelStore.getState().desktop.rightPanel).toBe("preview");
  });

  it("toggleRightPanel does not affect other desktop state", () => {
    usePanelStore.getState().openDesktopAgentList();
    usePanelStore.getState().toggleRightPanel("todos");
    expect(usePanelStore.getState().desktop.agentListOpen).toBe(true);
    expect(usePanelStore.getState().desktop.focusModeEnabled).toBe(false);
  });
});

describe("panel-store right panel ↔ explorer visibility", () => {
  it("rightPanel=files implies file explorer is open on desktop", () => {
    usePanelStore.getState().setRightPanel("files");
    const state = usePanelStore.getState();
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(true);
    // Direct flag is false — the explorer is derived from rightPanel
    expect(state.desktop.fileExplorerOpen).toBe(false);
  });

  it("rightPanel=diff implies file explorer is open on desktop", () => {
    usePanelStore.getState().setRightPanel("diff");
    const state = usePanelStore.getState();
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(true);
  });

  it("rightPanel=preview does NOT imply file explorer is open", () => {
    usePanelStore.getState().setRightPanel("preview");
    const state = usePanelStore.getState();
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(false);
  });

  it("rightPanel=todos does NOT imply file explorer is open", () => {
    usePanelStore.getState().setRightPanel("todos");
    const state = usePanelStore.getState();
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(false);
  });

  it("rightPanel does not affect mobile visibility", () => {
    usePanelStore.getState().setRightPanel("files");
    const state = usePanelStore.getState();
    expect(selectIsFileExplorerOpen(state, { isCompact: true })).toBe(false);
  });

  it("explorer is open when either fileExplorerOpen or rightPanel is explorer", () => {
    usePanelStore.setState({
      desktop: {
        agentListOpen: false,
        fileExplorerOpen: true,
        focusModeEnabled: false,
        rightPanel: "preview",
      },
    });
    const state = usePanelStore.getState();
    expect(selectIsFileExplorerOpen(state, { isCompact: false })).toBe(true);
  });
});

describe("panel-store closeDesktopFileExplorer clears explorer rightPanels", () => {
  it("clears rightPanel when it is files", () => {
    usePanelStore.getState().setRightPanel("files");
    usePanelStore.getState().closeDesktopFileExplorer();
    expect(usePanelStore.getState().desktop.rightPanel).toBeNull();
    expect(selectIsFileExplorerOpen(usePanelStore.getState(), { isCompact: false })).toBe(false);
  });

  it("clears rightPanel when it is diff", () => {
    usePanelStore.getState().setRightPanel("diff");
    usePanelStore.getState().closeDesktopFileExplorer();
    expect(usePanelStore.getState().desktop.rightPanel).toBeNull();
  });

  it("preserves rightPanel when it is non-explorer (e.g. preview)", () => {
    usePanelStore.getState().setRightPanel("preview");
    // Also set fileExplorerOpen so closeDesktopFileExplorer doesn't early-return
    usePanelStore.setState({
      desktop: {
        ...usePanelStore.getState().desktop,
        fileExplorerOpen: true,
      },
    });
    usePanelStore.getState().closeDesktopFileExplorer();
    expect(usePanelStore.getState().desktop.rightPanel).toBe("preview");
    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(false);
  });

  it("is a no-op when explorer is already closed and rightPanel is non-explorer", () => {
    usePanelStore.getState().setRightPanel("todos");
    const before = usePanelStore.getState().desktop;
    usePanelStore.getState().closeDesktopFileExplorer();
    const after = usePanelStore.getState().desktop;
    expect(after).toBe(before); // reference equality — no new object created
  });
});

describe("panel-store toggleFileExplorerForCheckout clears explorer rightPanels", () => {
  const checkout = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };

  it("clears rightPanel=files when toggling explorer closed", () => {
    usePanelStore.getState().setRightPanel("files");
    // explorer is open via derived state, so toggling should close
    usePanelStore.getState().toggleFileExplorerForCheckout({ isCompact: false, checkout });
    expect(usePanelStore.getState().desktop.rightPanel).toBeNull();
    expect(selectIsFileExplorerOpen(usePanelStore.getState(), { isCompact: false })).toBe(false);
  });

  it("clears rightPanel=diff when toggling explorer closed", () => {
    usePanelStore.getState().setRightPanel("diff");
    usePanelStore.getState().toggleFileExplorerForCheckout({ isCompact: false, checkout });
    expect(usePanelStore.getState().desktop.rightPanel).toBeNull();
  });

  it("preserves rightPanel=preview when toggling explorer closed", () => {
    usePanelStore.setState({
      desktop: {
        ...usePanelStore.getState().desktop,
        fileExplorerOpen: true,
        rightPanel: "preview",
      },
    });
    usePanelStore.getState().toggleFileExplorerForCheckout({ isCompact: false, checkout });
    expect(usePanelStore.getState().desktop.rightPanel).toBe("preview");
    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(false);
  });

  it("opens explorer when it was closed and rightPanel is non-explorer", () => {
    usePanelStore.getState().setRightPanel("todos");
    // fileExplorerOpen is false, rightPanel=todos doesn't imply explorer
    expect(selectIsFileExplorerOpen(usePanelStore.getState(), { isCompact: false })).toBe(false);
    usePanelStore.getState().toggleFileExplorerForCheckout({ isCompact: false, checkout });
    expect(usePanelStore.getState().desktop.fileExplorerOpen).toBe(true);
    // rightPanel is untouched
    expect(usePanelStore.getState().desktop.rightPanel).toBe("todos");
  });
});
