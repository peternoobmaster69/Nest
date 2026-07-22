import { normalizeInternalAppPath } from "@/lib/workspace-entry";

const POST_SIGN_IN_DESTINATION_KEY = "nest:postSignInDestination";

export function rememberPostSignInDestination(destination: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    POST_SIGN_IN_DESTINATION_KEY,
    normalizeInternalAppPath(destination),
  );
}

export function consumePostSignInDestination() {
  if (typeof window === "undefined") return "/";
  const destination = normalizeInternalAppPath(
    window.sessionStorage.getItem(POST_SIGN_IN_DESTINATION_KEY),
  );
  window.sessionStorage.removeItem(POST_SIGN_IN_DESTINATION_KEY);
  return destination;
}

export function clearPostSignInDestination() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(POST_SIGN_IN_DESTINATION_KEY);
}
