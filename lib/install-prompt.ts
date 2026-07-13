export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function rememberInstallPrompt(prompt: InstallPromptEvent) {
  deferredPrompt = prompt;
  emitChange();
}

export function clearInstallPrompt() {
  deferredPrompt = null;
  emitChange();
}

export function getInstallPrompt() {
  return deferredPrompt;
}

export function hasInstallPrompt() {
  return deferredPrompt !== null;
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
