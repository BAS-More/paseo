import { memo, useEffect } from "react";
import { Modal, Pressable, Platform, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ReactNode } from "react";

interface SettingsModalProps {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
}

export const SettingsModal = memo(function SettingsModal({
  visible,
  onDismiss,
  children,
}: SettingsModalProps) {
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onDismiss]);

  const modalContentStyle = {
    width: Math.min(640, width - 64),
    maxHeight: height - 128,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={modalStyles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[modalStyles.content, modalContentStyle]}
          onPress={(e) => e.stopPropagation()}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const modalStyles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  content: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.xl,
    overflow: "hidden" as const,
    ...theme.shadow.lg,
  },
}));
