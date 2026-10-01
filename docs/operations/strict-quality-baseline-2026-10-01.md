# Strict quality baseline — 2026-10-01

SonarQube Community Build 26.9 analyzed the Nest working tree on both the existing server and an isolated local validation instance. The strict gate failed; no thresholds were lowered and no issues were accepted or suppressed.

## Strict policy result

Analysis: 4abfbeb8-1ab7-4742-af0f-9f9617de07bf. Started: 2026-10-01T00:53:23.252Z.

| Measure | Result | Required |
| --- | ---: | ---: |
| Issues | 1290 | 0 |
| Combined Sonar coverage | 20.3% | 100% |
| Line coverage | 17.6% | 100% |
| Branch coverage | 68.3% | 100% |
| Duplication | 0.8% | 0% |
| Accepted issues | 0 | 0 |

Findings comprise 193 bug findings, 4 security findings, and 1093 maintainability findings. These are analyzer findings requiring review, not a count of confirmed exploitable vulnerabilities.

The final scan reports 0 open findings in the new quality scripts, their tests, and the CI workflows. All seven initial findings in the JavaScript quality scripts were fixed. Fixed CI database passwords were replaced with per-run credentials, verified with a mocked Docker execution that checks masking, loopback binding, and absence of passwords in command arguments.

The assigned strict gate, all nine language profiles, and the disabled small-change exemption were verified against the policy. Configuration drift: 0. Ignored gate conditions: false.

## Existing server and remaining activation

The existing server at http://localhost:9000 completed analysis 268363f7-6bad-4ac0-8e93-19ec0d8cf7d6. Its current gate also failed. Its new-coverage threshold remains 80%, so the strict policy has not been activated there. The existing analysis token cannot administer gates or verify their assignment (HTTP 403). An administrator user-token file is still needed for npm run sonar:configure.

The GitHub workflow and importable .github/rulesets/strict-quality.json are prepared. The new ruleset has not been applied in this session, and hosted workflow execution has not been verified. See [the policy guide](strict-quality-gate.md) for activation instructions and research sources.

## Validation and limits

- 425 unit and contract tests passed; two database integration tests were skipped locally. CI includes separate required database jobs.
- Production build, type checking, OpenAPI validation, actionlint, shell syntax validation, and the public-readiness audit passed. npm audit reported zero vulnerabilities, including development dependencies.
- Strict ESLint failed on the existing internal-navigation warning in components/settings-privacy-controls.tsx:98.
- npm run check stopped at the existing investments-page component-size ceiling; the ceiling was preserved.
- Docker and hosted GitHub jobs were not run locally. The Sonar API and scanner were exercised against real native SonarQube instances of the pinned server version.
- The working tree had uncommitted files. Sonar reported missing SCM blame for five changed files and excluded two untracked/modified files from its text/secret sensor. JavaScript/TypeScript analysis and full-source LCOV import completed. CI scans a committed checkout and also runs Gitleaks across history.
- Community does not provide the licensed dependency-risk gate or native pull-request decoration. The CI implementation analyzes the full checkout and uses npm audit and dependency review separately.

Raw local evidence is in ignored coverage/sonar-strict-result.json, coverage/sonar-existing-server-result.json, coverage/sonar-findings-summary.json, and coverage/lcov.info. Regenerate it with the commands in the policy guide.
