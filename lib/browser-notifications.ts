type PushConfiguration = { configured: boolean; publicKey: string } | undefined;

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const bytes = window.atob(base64);
  return Uint8Array.from(bytes, (character) => character.codePointAt(0)!);
}

export async function preparePushSubscription(configuration: PushConfiguration, supported: boolean) {
  if (!configuration?.configured || !configuration.publicKey) throw new Error("Push notifications are not configured for this deployment.");
  if (!supported) throw new Error("This browser does not support push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.getRegistration("/") ?? await navigator.serviceWorker.register("/sw.js");
  return await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(configuration.publicKey),
  });
}

export async function getBrowserPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) throw new Error("Notifications are not enabled in this browser. Revoke an older notification device below instead.");
  return subscription;
}
