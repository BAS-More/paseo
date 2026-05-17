// Stub for lucide-react-native in vitest.
// The real package imports react-native-svg which ships TypeScript source
// that vitest cannot transform from node_modules.
import { forwardRef, createElement } from "react";

function createIcon(name: string) {
  return forwardRef(function LucideIcon(props: Record<string, unknown>, ref: unknown) {
    return createElement("svg", { ...props, ref, "data-lucide": name });
  });
}

// Export all icons as stubs — only the ones actually used in tests matter,
// but we use a Proxy to handle any icon import.
const handler: ProxyHandler<object> = {
  get(_target, prop: string) {
    if (prop === "__esModule") return true;
    if (prop === "default") return createIcon("default");
    return createIcon(prop);
  },
};

export default new Proxy({}, handler);

// Named exports for commonly used icons
export const Activity = createIcon("Activity");
export const AlertTriangle = createIcon("AlertTriangle");
export const ArrowLeft = createIcon("ArrowLeft");
export const ArrowRight = createIcon("ArrowRight");
export const Check = createIcon("Check");
export const CheckCircle2 = createIcon("CheckCircle2");
export const ChevronDown = createIcon("ChevronDown");
export const ChevronRight = createIcon("ChevronRight");
export const ChevronUp = createIcon("ChevronUp");
export const Copy = createIcon("Copy");
export const Eye = createIcon("Eye");
export const EyeOff = createIcon("EyeOff");
export const File = createIcon("File");
export const Folder = createIcon("Folder");
export const Info = createIcon("Info");
export const Loader2 = createIcon("Loader2");
export const MoreHorizontal = createIcon("MoreHorizontal");
export const MoreVertical = createIcon("MoreVertical");
export const Plus = createIcon("Plus");
export const RefreshCw = createIcon("RefreshCw");
export const Search = createIcon("Search");
export const Settings = createIcon("Settings");
export const Trash2 = createIcon("Trash2");
export const Wifi = createIcon("Wifi");
export const WifiOff = createIcon("WifiOff");
export const X = createIcon("X");
export const XCircle = createIcon("XCircle");
