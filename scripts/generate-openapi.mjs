import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import process from "node:process";
import { z } from "zod";
import {
  BulkImportSchema,
  ImportMaybankSchema,
} from "../lib/domains/integrations/import-contracts.ts";
import {
  BudgetPlanPatchSchema,
  BudgetPlanPostSchema,
  DeleteSchema as BudgetPlanDeleteSchema,
} from "../lib/domains/ledger/budget-plan/contracts.ts";

const root = resolve(import.meta.dirname, "..");
const apiRoot = resolve(root, "app", "api");
const outputPath = resolve(root, "generated", "openapi.json");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const schemaRegistry = {
  BulkImportSchema,
  ImportMaybankSchema,
  BudgetPlanPostSchema,
  BudgetPlanPatchSchema,
  BudgetPlanDeleteSchema,
};
const requestSchemaByOperation = {
  "POST /api/transactions/bulk-import": "BulkImportSchema",
  "POST /api/credit-transactions/import-maybank": "ImportMaybankSchema",
  "POST /api/budgets/plan": "BudgetPlanPostSchema",
  "PATCH /api/budgets/plan": "BudgetPlanPatchSchema",
};

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  }));
  return nested.flat();
}

function openApiPath(file) {
  const directory = relative(apiRoot, resolve(file, "..")).split(sep);
  return `/api/${directory.map((part) => {
    const catchAll = part.match(/^\[\.\.\.(.+)]$/);
    const dynamic = part.match(/^\[(.+)]$/);
    return catchAll ? `{${catchAll[1]}}` : dynamic ? `{${dynamic[1]}}` : part;
  }).join("/")}`.replace(/\/$/, "");
}

function operationFor({ method, file, source, path }) {
  const params = [...path.matchAll(/\{([^}]+)}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string", maxLength: 191 },
  }));
  const schemaNames = [...new Set([
    ...[...source.matchAll(/parseJsonBody\(request,\s*([A-Za-z0-9_]+)/g)].map((match) => match[1]),
    ...[...source.matchAll(/([A-Za-z0-9_]+Schema)\.(?:safeParse|parse)\(/g)].map((match) => match[1]),
  ])];
  const isPublic = path === "/api/auth/{nextauth}" ||
    path.startsWith("/api/public/") ||
    path.startsWith("/api/passkeys/authenticate/");
  const isCron = path.startsWith("/api/cron/");
  const operation = {
    operationId: `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    tags: [path.split("/")[2] || "api"],
    security: isPublic
      ? []
      : isCron
        ? [{ cronSecret: [] }]
        : [{ sessionCookie: [] }, { secureSessionCookie: [] }],
    parameters: params,
    responses: {
      "200": { description: "Successful response" },
      "400": { $ref: "#/components/responses/InvalidRequest" },
      "401": { $ref: "#/components/responses/Unauthenticated" },
      "403": { $ref: "#/components/responses/Forbidden" },
      "409": { $ref: "#/components/responses/Conflict" },
      "422": { $ref: "#/components/responses/UnprocessableEntity" },
      "429": { $ref: "#/components/responses/RateLimited" },
      "503": { $ref: "#/components/responses/ServiceUnavailable" },
    },
    "x-source-handler": relative(root, file).split(sep).join("/"),
  };
  if (method === "DELETE" && path === "/api/budgets/plan") {
    operation.parameters.push(
      { name: "workspaceId", in: "query", required: true, schema: { type: "string", maxLength: 191 } },
      { name: "id", in: "query", required: true, schema: { type: "string", maxLength: 191 } },
      {
        name: "type",
        in: "query",
        required: true,
        schema: { type: "string", enum: ["templateItem", "templateSource", "monthlyItem", "monthlySource"] },
      },
    );
    operation["x-request-schemas"] = ["BudgetPlanDeleteSchema"];
  }
  if (schemaNames.length) operation["x-request-schemas"] = schemaNames;
  const registeredSchema = requestSchemaByOperation[`${method} ${path}`];
  if (registeredSchema) operation["x-request-schemas"] = [registeredSchema];
  if (method !== "GET" && (method !== "DELETE" || registeredSchema)) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: registeredSchema
            ? { $ref: `#/components/schemas/${registeredSchema}` }
            : { type: "object" },
        },
      },
    };
  }
  return operation;
}

const files = (await routeFiles(apiRoot)).sort();
const paths = {};
for (const file of files) {
  const source = await readFile(file, "utf8");
  const path = openApiPath(file);
  for (const method of METHODS) {
    if (!new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s*\\{[^}]*\\b${method}\\b`, "m").test(source)) continue;
    paths[path] ??= {};
    paths[path][method.toLowerCase()] = operationFor({ method, file, source, path });
  }
}

const errorSchema = {
  type: "object",
  required: ["error", "code"],
  properties: {
    error: { type: "string" },
    code: { type: "string" },
    requestId: { type: "string", format: "uuid" },
    issues: {},
  },
};
const response = (description, headers) => ({
  description,
  headers,
  content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
});
const document = {
  openapi: "3.1.0",
  info: {
    title: "Nest API",
    version: "1.0.0",
    description: "Generated from the exported Next.js route handlers. Authentication uses the same HttpOnly NextAuth session cookie as the web application; no bearer token is accepted.",
  },
  paths,
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "next-auth.session-token",
        description: "NextAuth session cookie used in local and non-secure deployments.",
      },
      secureSessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-next-auth.session-token",
        description: "Secure NextAuth session cookie used by HTTPS production deployments.",
      },
      cronSecret: {
        type: "http",
        scheme: "bearer",
        description: "Scheduler-only CRON_SECRET. This is not a user API credential.",
      },
    },
    schemas: {
      ApiError: errorSchema,
      ...Object.fromEntries(
        Object.entries(schemaRegistry).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
      ),
    },
    responses: {
      InvalidRequest: response("Invalid request"),
      Unauthenticated: response("A valid session is required"),
      Forbidden: response("The session lacks the required workspace role"),
      Conflict: response("The request conflicts with current state or idempotency history"),
      UnprocessableEntity: response("The JSON body or query failed schema validation"),
      RateLimited: response("Rate limit exceeded", { "Retry-After": { schema: { type: "integer" } } }),
      ServiceUnavailable: response("A transient dependency is unavailable", { "Retry-After": { schema: { type: "integer" } } }),
    },
  },
};
const rendered = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== rendered) {
    console.error("generated/openapi.json is stale. Run npm run openapi:generate.");
    process.exitCode = 1;
  }
} else {
  await mkdir(resolve(root, "generated"), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");
  console.log(`Generated ${Object.keys(paths).length} OpenAPI paths.`);
}
