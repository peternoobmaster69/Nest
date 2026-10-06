// Script integrity is checked against the bundled assets by the static-page tests.
const staticPageScripts = new Map<string, string>([
  ["/style-guide.html", "sha256-qa8KDE+UqyL8GBAwDZ2pN8U6FA3jOvvn7OrEV/RC58s="],
  ["/offline.html", "sha256-ZQIEPExNqdmGu/RY3I/w5LgmU/ukXWkkYPFpqxTuw88="],
]);

export function staticPageScriptIntegrity(pathname: string) {
  return staticPageScripts.get(pathname);
}
