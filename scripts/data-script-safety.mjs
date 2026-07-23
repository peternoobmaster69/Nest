const SAFE_DEFAULT_ENVIRONMENTS = ["development", "test"];

export function parseSafetyArgs(args = process.argv.slice(2)) {
  const apply = args.includes("--apply");
  const environment = valueFor(args, "--environment") ?? process.env.NODE_ENV ?? "development";
  const confirmation = valueFor(args, "--confirm");
  const allowed = (process.env.DATA_SCRIPT_ALLOWED_ENVIRONMENTS || SAFE_DEFAULT_ENVIRONMENTS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return { apply, environment, confirmation, allowed };
}

function valueFor(args, name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
}

export function assertMutationAllowed({ safety, workspaceId, operation }) {
  if (!safety.apply) return;
  if (!workspaceId) throw new Error(`${operation}: --workspace is required for live changes.`);
  if (!safety.allowed.includes(safety.environment)) {
    throw new Error(
      `${operation}: environment "${safety.environment}" is not in DATA_SCRIPT_ALLOWED_ENVIRONMENTS.`,
    );
  }
  if (safety.confirmation !== workspaceId) {
    throw new Error(`${operation}: pass --confirm=${workspaceId} to confirm the exact workspace.`);
  }
}

export function auditDataScript(event) {
  console.log(JSON.stringify({
    event: "data_script",
    at: new Date().toISOString(),
    ...event,
  }));
}

