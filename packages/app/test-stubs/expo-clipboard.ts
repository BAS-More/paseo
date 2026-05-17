// Stub for expo-clipboard in vitest.
// The real package ships JSX in its compiled .js build output
// which Vite/Rollup cannot parse without a JSX transform.
import { vi } from "vitest";

export async function getStringAsync(): Promise<string> {
  return "";
}

export async function setStringAsync(_text: string): Promise<boolean> {
  return true;
}

export async function hasStringAsync(): Promise<boolean> {
  return false;
}

export async function getImageAsync() {
  return null;
}

export async function setImageAsync() {
  return true;
}

export async function hasImageAsync(): Promise<boolean> {
  return false;
}

export async function getUrlAsync(): Promise<string> {
  return "";
}

export async function hasUrlAsync(): Promise<boolean> {
  return false;
}

export const addClipboardListener = vi.fn(() => ({ remove: vi.fn() }));
export const removeClipboardListener = vi.fn();

export const ClipboardPasteButton = () => null;

export default {
  getStringAsync,
  setStringAsync,
  hasStringAsync,
  getImageAsync,
  setImageAsync,
  hasImageAsync,
  getUrlAsync,
  hasUrlAsync,
  addClipboardListener,
  removeClipboardListener,
};
