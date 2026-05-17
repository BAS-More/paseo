import { memo, useCallback, useMemo, useState } from "react";
import { type PressableStateCallbackType } from "react-native";
import {
  Eye,
  FileDiff,
  FolderOpen,
  ListTodo,
  PanelRight,
  SquareTerminal,
  Map,
  ListChecks,
} from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type RightPanelId } from "@/stores/panel-store";

interface PanelMenuEntry {
  id: RightPanelId;
  label: string;
  icon: typeof Eye;
  enabled: boolean;
}

const PANEL_ENTRIES: PanelMenuEntry[] = [
  { id: "preview", label: "Preview", icon: Eye, enabled: false },
  { id: "diff", label: "Diff", icon: FileDiff, enabled: true },
  { id: "terminal", label: "Terminal", icon: SquareTerminal, enabled: false },
  { id: "files", label: "Files", icon: FolderOpen, enabled: true },
  { id: "tasks", label: "Background tasks", icon: ListTodo, enabled: false },
  { id: "todos", label: "To-dos", icon: ListChecks, enabled: false },
  { id: "plan", label: "Plan", icon: Map, enabled: false },
];

interface WorkspacePanelMenuProps {
  activePanel: RightPanelId | null;
  onSelectPanel: (panel: RightPanelId) => void;
}

export const WorkspacePanelMenu = memo(function WorkspacePanelMenu({
  activePanel,
  onSelectPanel,
}: WorkspacePanelMenuProps) {
  const { theme } = useUnistyles();
  const [isOpen, setIsOpen] = useState(false);

  const triggerStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.triggerButton,
      (isOpen || Boolean(hovered)) && styles.triggerButtonActive,
    ],
    [isOpen],
  );

  const triggerIconColor = useMemo(
    () => (isOpen || activePanel ? theme.colors.foreground : theme.colors.foregroundMuted),
    [isOpen, activePanel, theme.colors.foreground, theme.colors.foregroundMuted],
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        style={triggerStyle}
        testID="workspace-panel-menu-trigger"
        accessibilityLabel="Toggle panels"
        accessibilityRole="button"
      >
        <PanelRight size={16} color={triggerIconColor} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        offset={4}
        width={220}
        testID="workspace-panel-menu"
      >
        {PANEL_ENTRIES.map((entry) => (
          <PanelMenuRow
            key={entry.id}
            entry={entry}
            isActive={activePanel === entry.id}
            disabled={!entry.enabled}
            onSelect={onSelectPanel}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

function PanelMenuRow({
  entry,
  isActive,
  disabled,
  onSelect,
}: {
  entry: PanelMenuEntry;
  isActive: boolean;
  disabled: boolean;
  onSelect: (panel: RightPanelId) => void;
}) {
  const { theme } = useUnistyles();
  const handleSelect = useCallback(() => onSelect(entry.id), [onSelect, entry.id]);

  const leadingIcon = useMemo(() => {
    const Icon = entry.icon;
    return <Icon size={16} color={theme.colors.foregroundMuted} />;
  }, [entry.icon, theme.colors.foregroundMuted]);

  return (
    <DropdownMenuItem
      onSelect={handleSelect}
      leading={leadingIcon}
      selected={isActive}
      disabled={disabled}
      testID={`workspace-panel-menu-${entry.id}`}
    >
      {entry.label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  triggerButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
}));
