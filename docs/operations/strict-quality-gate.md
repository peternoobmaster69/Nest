# Strict quality gate for Nest

Nest applies the same quality requirements to human and AI contributions. Generated code and generated tests require accountable human review. The policy is intentionally strict across the entire application: existing debt blocks the gate as well as new defects.

The [2026-10-01 baseline](strict-quality-baseline-2026-10-01.md) records the initial scan results, validation, and activation status.

## Policy

`quality/sonar-policy.json` is the source of truth for the dedicated **Nest strict AI** gate. `npm run sonar:configure` creates or updates only Nest's gate, project settings, and named language profiles. It does not change server defaults or other projects' gates.

| Check | Required result |
| --- | --- |
| Sonar issues, at every severity | Zero overall and on new code |
| Accepted issues | Zero overall and on new code |
| Line and branch coverage | 100% overall and on new code |
| Duplicated lines | 0% overall and on new code |
| Security hotspots | 100% reviewed overall and on new code |
| Small changes | Coverage and duplication conditions always apply |
| Local coverage | Exactly 100% of lines, statements, functions, and branches; no skipped entries in the coverage report |
| Dependencies, including development tools | No known vulnerabilities at low severity or above |
| CodeQL | `security-and-quality` suite; zero results, including suppressed results |
| Secrets | Gitleaks scan of repository history |
| ESLint | No errors or warnings |
| Application checks | Types, OpenAPI, UI budgets, unit tests, build, browser/accessibility checks, SQL integrity, and ledger concurrency |

**Nest comprehensive** inherits the strongest curated Sonar profile for JavaScript, TypeScript, CSS, HTML, JSON, YAML, Docker, secrets, and text. On Community Build 26.9, that built-in is called **Sonar way**; newer documentation calls its replacement **Sonar way comprehensive**. All additional stable, non-template rules with security or reliability impact and all stable security hotspot rules are activated. JavaScript and TypeScript also report `NOSONAR` comments. Inheriting the curated maintainability rules avoids enabling mutually conflicting style rules. No scanner can prove that all defects are absent.

The verifier rejects missing conditions, altered thresholds, a different assigned gate, missing or modified inherited rules, missing extra security rules, and small-change exemptions. The new-code window is 30 days. Overall conditions also apply, so the first analysis and a missing comparison baseline cannot hide existing issues.

## Local use

Use Node 22.13 or newer. Start your SonarQube server, then configure credentials without adding them to source control or command arguments:

```sh
export SONAR_HOST_URL=http://localhost:9000
export SONAR_ADMIN_TOKEN_FILE="$HOME/.config/sonarqube/nest-admin-token"
export SONAR_TOKEN_FILE="$HOME/.config/sonarqube/nest-analysis-token"
npm run sonar:configure
npm run sonar
```

Create an administrator **user token** to manage gates, profiles, and project settings. A global or project **analysis token** can scan but cannot administer quality policy. A token that verifies gate assignment also needs project Browse permission; the scripts use the administrator token for verification when available. `SONAR_ADMIN_TOKEN` and `SONAR_TOKEN` environment variables are also supported. Use HTTPS for a remote server. Tokens must stay in private files outside the repository, ideally mode `0600`.

`npm run test:coverage` runs the real test suite with c8, source maps, and `all: true`. Unloaded production files count as uncovered. The scope includes application code, components, hooks, libraries, the service worker, scripts, Prisma seed code, and executable root configuration. Declaration files and generated SQL migrations are outside executable JavaScript coverage. Reading source text in a contract test does not count as executing that source.

`npm run sonar` generates fresh coverage and scans the current workspace. `npm run sonar:scan` reuses coverage only if every production source is present and none has changed since the report. The scanner waits up to ten minutes for the server's gate result; the wrapper also verifies policy and exact coverage counts. Missing LCOV, incomplete analysis, connection failures, insufficient verification permissions, or a failed gate return a nonzero exit code. Results are written to ignored `coverage/sonar-result.json` and `coverage/lcov.info`.

`npm run coverage:check` enforces the coverage requirement separately. `npm run sonar:verify` detects server configuration drift. Do not round a coverage percentage up to pass, exclude untested modules, or reset the baseline to conceal debt.

## CI and merge enforcement

CI provisions a fresh, digest-pinned SonarQube Community Build 26.9 container, bound to runner loopback. It rotates the empty instance's default password and creates separate administrator and project analysis tokens that expire the next day. Bootstrap refuses an existing instance and is restricted to GitHub-hosted disposable runners. No production Sonar credentials or connectivity to a developer's laptop are required.

Browser and database jobs also start loopback-only SQL Server containers with independently generated database and session credentials for each run. Credentials are masked in logs and passed through environment variables; the workflow contains no fixed database passwords.

Each pull request checkout is analyzed as a complete main project. This supports Community's edition limits without pretending to offer licensed pull request decoration. The fresh database does not retain triage decisions or hotspot reviews between runs. Recurring findings must be resolved; persistent review history requires a separately managed Sonar server and appropriate branch-analysis support. Community lacks the licensed dependency-risk gate, so npm audit and GitHub dependency review enforce dependency checks independently.

The **Strict quality gate** job waits for validation, browser checks, SQL checks, SonarQube, secret/dependency review, and CodeQL. Failure, cancellation, or skipping any required job prevents success. CodeQL's SARIF is checked explicitly because successful execution of the analyzer alone does not mean it found zero issues. Coverage and Sonar evidence are retained as CI artifacts for 14 days. Actions and server images are pinned. Dependabot proposes npm and action updates; update server image digests explicitly.

Workflow files alone do not enforce merges. In the GitHub ruleset for `main`, require:

1. A pull request, at least one human approval, and code-owner review.
2. Dismissal of stale approvals and approval of the most recent push by someone other than its author.
3. The **Strict quality gate** status check, with the branch up to date, and resolved review conversations.
4. No force pushes, branch deletion, or routine bypasses of these requirements.

The repository's existing CODEOWNERS file names its owner. Add another trusted code owner if that owner authors changes and cannot approve their own pull requests. Protect quality-policy and workflow changes through the same review process. Repository rules must be applied in GitHub; committing this configuration does not activate them automatically.

The importable `.github/rulesets/strict-quality.json` contains these settings and restricts the required check to the GitHub Actions app. A repository administrator can import it in **Settings → Rules → Rulesets**, or create the ruleset with authenticated GitHub CLI access:

```sh
gh api --method POST repos/peternoobmaster69/SaveTogether/rulesets \
  --input .github/rulesets/strict-quality.json
```

Check for an existing ruleset before creating another one. This command changes live merge restrictions and should be applied after the workflow exists on GitHub and the human review arrangement is in place.

## Basis for the policy

Reviewed 2026-10-01:

- [GitHub: reviewing AI-generated code](https://docs.github.com/en/copilot/tutorials/review-ai-generated-code): compile, test, and analyze; verify intent and architecture; scrutinize dependencies; watch for omitted or weakened tests.
- [GitHub: responsible use of agents](https://docs.github.com/en/copilot/responsible-use/agents): retain human responsibility and combine review with security, dependency, and secret checks.
- [Sonar: quality gate for agentic AI](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/ai-code-assurance/quality-gate-for-agentic-ai): stronger reliability, security, maintainability, and dependency checks; its documented coverage/duplication limits are 80%/3%. Nest deliberately tightens these to 100%/0% and applies them to overall code too.
- [Sonar: built-in profiles](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-profiles/built-in-quality-profiles): comprehensive is the strongest curated profile and replaces the former Sonar way name.
- [Sonar Community: quality gates](https://docs.sonarsource.com/sonarqube-community-build/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates): zero issues is stronger than relying on A ratings; small-change exemptions otherwise skip some conditions.
- [Sonar Community: JavaScript/TypeScript coverage](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/test-coverage/javascript-typescript-test-coverage): coverage must be produced by tests and imported through LCOV.

This is a project quality policy informed by that guidance, not a claim of Sonar's licensed AI Code Assurance certification. Static analysis and 100% coverage support review; neither establishes that the product meets its requirements or that every important behavior was tested.
