// Stub for expo-modules-core in vitest — the real package ships TypeScript
// source that vitest refuses to transform from node_modules.
export class EventEmitter {
  addListener() {
    return { remove() {} };
  }
  removeAllListeners() {}
  emit() {}
  listenerCount() {
    return 0;
  }
}
export class NativeModule extends EventEmitter {}
export class SharedObject extends EventEmitter {}
export class SharedRef extends SharedObject {}
export const requireNativeModule = () => ({});
export const requireOptionalNativeModule = () => null;
export const isDOMAvailable = true;
export const canUseEventListeners = true;
export const canUseViewport = true;
export const isAsyncDebugging = false;
export const Platform = {
  OS: "web" as const,
  select: <T>(specifics: Record<string, T>): T | undefined =>
    specifics.web ?? specifics.default ?? undefined,
  isDOMAvailable: true,
  canUseEventListeners: true,
  canUseViewport: true,
};
