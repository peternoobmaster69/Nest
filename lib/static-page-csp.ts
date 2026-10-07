// Every parser-loaded script is integrity-verified under strict-dynamic.
// Static-page tests check this list against the asset contents and HTML order.
const sharedScripts = [
  "sha256-1qMFETf0idFQp3JVsTxIVAnFQvpo56ARv3zC0brdA3s=",
  "sha256-2kZc1THhDtNE5KqKjcIvptqed5diU734ghTbdJ8lwIU=",
];

const staticPageScripts = new Map<string, readonly string[]>([
  ["/style-guide.html", [...sharedScripts, "sha256-dfDSEc34H9YAqzTrHrWxy/BF2DQsiyXUu26ieZt9vbk="]],
  ["/offline.html", [...sharedScripts, "sha256-3TBQgf8CwBiiDiqWuNuc+admBugLbu54sDGgAmRtBOw="]],
]);

export function staticPageScriptIntegrity(pathname: string) {
  return staticPageScripts.get(pathname);
}
