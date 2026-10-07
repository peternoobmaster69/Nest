// Every parser-loaded script is integrity-verified under strict-dynamic.
// Static-page tests check this list against the asset contents and HTML order.
const sharedScripts = [
  "sha256-NRLJOUYQiXiJ+3zEYp56d6/tOMiXBGt/x5/n1OirC3A=",
  "sha256-3IMa/4jyY4Q9HE7fkTB7udROLZIzbrr+JgeAXuo/17Y=",
];

const staticPageScripts = new Map<string, readonly string[]>([
  ["/style-guide.html", [...sharedScripts, "sha256-kJRY8u9Y9VhFtkfdu9teuqYexU0EL2bhXShtuadIBqU="]],
  ["/offline.html", [...sharedScripts, "sha256-nOi0x29Z4qye61WeE5ruIBjiDUv+xowxSk9yKZwfYzo="]],
]);

export function staticPageScriptIntegrity(pathname: string) {
  return staticPageScripts.get(pathname);
}
