#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || -z "${GITHUB_ENV:-}" ]]; then
  echo "SQL Server bootstrap is restricted to disposable GitHub-hosted runners." >&2
  exit 1
fi

NEST_SQL_PASSWORD="$(openssl rand -hex 32)Aa1!"
NEST_AUTH_SECRET="$(openssl rand -hex 32)"
printf '::add-mask::%s\n' "$NEST_SQL_PASSWORD" "$NEST_AUTH_SECRET"
export MSSQL_SA_PASSWORD="$NEST_SQL_PASSWORD"
export SQLCMDPASSWORD="$NEST_SQL_PASSWORD"

# Pass credentials through the process environment, never Docker command arguments.
docker run --detach --name nest-ci-sqlserver --publish 127.0.0.1:1433:1433 \
  --env ACCEPT_EULA=Y --env MSSQL_SA_PASSWORD \
  mcr.microsoft.com/mssql/server:2022-latest@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090

for ((attempt = 0; attempt < 60; attempt++)); do
  if docker exec --env SQLCMDPASSWORD nest-ci-sqlserver \
    /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -Q 'SELECT 1' > /dev/null 2>&1; then
    {
      printf 'DATABASE_URL=sqlserver://127.0.0.1:1433;database=master;user=sa;password=%s;encrypt=true;trustServerCertificate=true\n' "$NEST_SQL_PASSWORD"
      printf 'SHADOW_DATABASE_URL=sqlserver://127.0.0.1:1433;database=master;user=sa;password=%s;encrypt=true;trustServerCertificate=true\n' "$NEST_SQL_PASSWORD"
      printf 'NEXTAUTH_SECRET=%s\n' "$NEST_AUTH_SECRET"
    } >> "$GITHUB_ENV"
    exit 0
  fi
  sleep 2
done

echo "The disposable SQL Server did not become healthy within two minutes." >&2
exit 1
