#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || -z "${RUNNER_TEMP:-}" || -z "${GITHUB_PATH:-}" ]]; then
  echo "Scanner installation is restricted to disposable GitHub-hosted Linux runners." >&2
  exit 1
fi

NEST_SCANNER_VERSION="8.1.0.6389"
NEST_SCANNER_SHA256="bb8f709f9cb73352f8d1260a3b3c506c0f41146754bc630762c126d795499d0b"
NEST_SCANNER_DIR="$(mktemp -d "$RUNNER_TEMP/nest-sonar-scanner.XXXXXX")"
NEST_SCANNER_ARCHIVE="$NEST_SCANNER_DIR/scanner.zip"

curl --fail --silent --show-error --location --retry 3 \
  "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-$NEST_SCANNER_VERSION-linux-x64.zip" \
  --output "$NEST_SCANNER_ARCHIVE"
printf '%s  %s\n' "$NEST_SCANNER_SHA256" "$NEST_SCANNER_ARCHIVE" | sha256sum --check --status
unzip -q "$NEST_SCANNER_ARCHIVE" -d "$NEST_SCANNER_DIR"
printf '%s\n' "$NEST_SCANNER_DIR/sonar-scanner-$NEST_SCANNER_VERSION-linux-x64/bin" >> "$GITHUB_PATH"
