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
import { CorrectTransactionSchema } from "../lib/domains/ledger/transaction-contracts.ts";
import { TransactionAgentRequestSchema } from "../lib/ai/transaction-agent-contracts.ts";
import {
  AgentConfigurationUpdateSchema, AgentExampleSchema, AgentExampleUpdateSchema, AgentRevisionSchema,
  AgentEvaluationRequestSchema, AgentFineTuneRequestSchema, AgentFineTuneActionSchema,
} from "../lib/ai/agent-contracts.ts";
import {
  CioExposuresInputSchema,
  CioInvestmentProfileInputSchema,
  CioPlanningPositionCreateSchema,
  CioPlanningPositionUpdateSchema,
  CioPolicyInputSchema,
  CioProfileInputSchema,
  CioRecurringFlowCreateSchema,
  CioRecurringFlowUpdateSchema,
  CioRetirementProjectionInputSchema,
  CioStrategyReportCreateInputSchema,
} from "../lib/domains/cio/contracts.ts";
import {
  CIO_ASSET_CLASSES,
  CIO_GEOGRAPHIES,
} from "../lib/domains/cio/types.ts";

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
  CorrectTransactionSchema,
  TransactionAgentRequestSchema,
  AgentConfigurationUpdateSchema, AgentExampleSchema, AgentExampleUpdateSchema, AgentRevisionSchema,
  AgentEvaluationRequestSchema, AgentFineTuneRequestSchema, AgentFineTuneActionSchema,
  CioProfileInputSchema,
  CioPolicyInputSchema,
  CioInvestmentProfileInputSchema,
  CioExposuresInputSchema,
  CioRecurringFlowCreateSchema,
  CioRecurringFlowUpdateSchema,
  CioPlanningPositionCreateSchema,
  CioPlanningPositionUpdateSchema,
  CioRetirementProjectionInputSchema,
  CioStrategyReportCreateInputSchema,
};
const requestSchemaByOperation = {
  "PATCH /api/admin/agents/{agentId}": "AgentConfigurationUpdateSchema",
  "POST /api/admin/agents/{agentId}/examples": "AgentExampleSchema",
  "PUT /api/admin/agents/{agentId}/examples/{exampleId}": "AgentExampleUpdateSchema",
  "DELETE /api/admin/agents/{agentId}/examples/{exampleId}": "AgentRevisionSchema",
  "POST /api/admin/agents/{agentId}/evaluations": "AgentEvaluationRequestSchema",
  "POST /api/admin/agents/{agentId}/fine-tuning": "AgentFineTuneRequestSchema",
  "POST /api/admin/agents/{agentId}/fine-tuning/{jobId}": "AgentFineTuneActionSchema",
  "POST /api/ai/transactions": "TransactionAgentRequestSchema",
  "POST /api/transactions/bulk-import": "BulkImportSchema",
  "POST /api/transactions/{id}/corrections": "CorrectTransactionSchema",
  "POST /api/credit-transactions/import-maybank": "ImportMaybankSchema",
  "POST /api/budgets/plan": "BudgetPlanPostSchema",
  "PATCH /api/budgets/plan": "BudgetPlanPatchSchema",
  "PATCH /api/cio/profile": "CioProfileInputSchema",
  "PATCH /api/cio/policy": "CioPolicyInputSchema",
  "PUT /api/cio/investments/{investmentId}/profile": "CioInvestmentProfileInputSchema",
  "PUT /api/cio/investments/{investmentId}/exposures": "CioExposuresInputSchema",
  "POST /api/cio/recurring-flows": "CioRecurringFlowCreateSchema",
  "PATCH /api/cio/recurring-flows/{id}": "CioRecurringFlowUpdateSchema",
  "POST /api/cio/planning-positions": "CioPlanningPositionCreateSchema",
  "PATCH /api/cio/planning-positions/{id}": "CioPlanningPositionUpdateSchema",
  "POST /api/cio/retirement-projection": "CioRetirementProjectionInputSchema",
  "POST /api/cio/reports": "CioStrategyReportCreateInputSchema",
};
const cioOperationContract = {
  "GET /api/cio/overview": { role: "VIEWER", sameOrigin: false, summary: "Get the canonical CIO overview" },
  "GET /api/cio/profile": { role: "VIEWER", sameOrigin: false, summary: "Get household CIO assumptions" },
  "PATCH /api/cio/profile": { role: "EDITOR", sameOrigin: true, summary: "Update household CIO assumptions" },
  "GET /api/cio/policy": { role: "VIEWER", sameOrigin: false, summary: "Get the CIO investment policy" },
  "PATCH /api/cio/policy": { role: "EDITOR", sameOrigin: true, summary: "Update the CIO investment policy" },
  "GET /api/cio/investments/{investmentId}/profile": { role: "VIEWER", sameOrigin: false, summary: "Get a CIO investment profile" },
  "PUT /api/cio/investments/{investmentId}/profile": { role: "EDITOR", sameOrigin: true, summary: "Replace a CIO investment profile" },
  "GET /api/cio/investments/{investmentId}/exposures": { role: "VIEWER", sameOrigin: false, summary: "Get CIO investment exposures" },
  "PUT /api/cio/investments/{investmentId}/exposures": { role: "EDITOR", sameOrigin: true, summary: "Replace CIO investment exposures" },
  "GET /api/cio/recurring-flows": { role: "VIEWER", sameOrigin: false, summary: "List CIO recurring flows" },
  "POST /api/cio/recurring-flows": { role: "EDITOR", sameOrigin: true, successStatus: "201", summary: "Create a CIO recurring flow" },
  "PATCH /api/cio/recurring-flows/{id}": { role: "EDITOR", sameOrigin: true, summary: "Update a CIO recurring flow" },
  "DELETE /api/cio/recurring-flows/{id}": { role: "EDITOR", sameOrigin: true, summary: "Delete a CIO recurring flow" },
  "GET /api/cio/planning-positions": { role: "VIEWER", sameOrigin: false, summary: "List CIO planning positions" },
  "POST /api/cio/planning-positions": { role: "EDITOR", sameOrigin: true, successStatus: "201", summary: "Create a CIO planning position" },
  "PATCH /api/cio/planning-positions/{id}": { role: "EDITOR", sameOrigin: true, summary: "Update a CIO planning position" },
  "DELETE /api/cio/planning-positions/{id}": { role: "EDITOR", sameOrigin: true, summary: "Delete a CIO planning position" },
  "POST /api/cio/retirement-projection": { role: "VIEWER", sameOrigin: false, summary: "Run a read-only CIO retirement projection" },
  "GET /api/cio/reports": { role: "VIEWER", sameOrigin: false, summary: "List immutable CIO strategy reports" },
  "POST /api/cio/reports": { role: "EDITOR", sameOrigin: true, successStatus: "201", summary: "Generate an immutable CIO strategy report" },
  "GET /api/cio/reports/{id}": { role: "VIEWER", sameOrigin: false, summary: "Get an immutable CIO strategy report" },
  "GET /api/cio/reports/{id}/pdf": { role: "VIEWER", sameOrigin: false, responseContentType: "application/pdf", summary: "Download a CIO strategy report PDF" },
};

function presentStringProperty(name) {
  return {
    required: [name],
    properties: { [name]: { type: "string" } },
  };
}

function typeIs(value) {
  return {
    required: ["type"],
    properties: { type: { const: value } },
  };
}

function addSchemaAllOf(schema, conditions) {
  schema.allOf = [...(schema.allOf ?? []), ...conditions];
}

function openApiSchema(name, zodSchema) {
  const schema = z.toJSONSchema(zodSchema);

  if (name === "CioProfileInputSchema") {
    const currentAge = {
      required: ["primaryCurrentAge"],
      properties: { primaryCurrentAge: { type: "integer" } },
    };
    addSchemaAllOf(schema, [
      { not: { allOf: [presentStringProperty("primaryBirthDate"), currentAge] } },
      {
        not: {
          allOf: [
            { required: ["targetRetirementAge"], properties: { targetRetirementAge: { type: "integer" } } },
            presentStringProperty("targetRetirementDate"),
          ],
        },
      },
    ]);
    schema["x-runtime-refinements"] = [
      "When primaryCurrentAge is supplied, primaryAgeAsOfDate cannot be explicitly null.",
      "When all are supplied, bearReturnBps must not exceed baseReturnBps and baseReturnBps must not exceed bullReturnBps.",
    ];
  }

  if (name === "CioPolicyInputSchema") {
    schema["x-runtime-refinements"] = [
      "Asset-class and geography keys must be unique within their respective arrays.",
      "Each asset-class band must satisfy minimumBps <= targetBps <= maximumBps.",
    ];
  }

  if (name === "CioInvestmentProfileInputSchema") {
    addSchemaAllOf(schema, [{
      if: presentStringProperty("lockUntil"),
      then: { properties: { liquidityClass: { const: "LOCKED" } } },
    }]);
  }

  if (name === "CioExposuresInputSchema") {
    const item = schema.properties.exposures.items;
    addSchemaAllOf(item, [
      {
        if: { properties: { dimension: { const: "ASSET_CLASS" } }, required: ["dimension"] },
        then: { properties: { key: { enum: [...CIO_ASSET_CLASSES] } } },
      },
      {
        if: { properties: { dimension: { const: "GEOGRAPHY" } }, required: ["dimension"] },
        then: { properties: { key: { enum: [...CIO_GEOGRAPHIES] } } },
      },
      {
        if: { properties: { dimension: { const: "SECURITY" } }, required: ["dimension"] },
        then: { properties: { key: { maxLength: 32, pattern: "^[A-Z0-9][A-Z0-9._:-]{0,31}$" } } },
      },
    ]);
    schema["x-runtime-refinements"] = [
      "Dimension/key pairs must be unique.",
      "Weights for every represented dimension must total exactly 10000 basis points.",
    ];
  }

  if (name === "CioRecurringFlowCreateSchema" || name === "CioRecurringFlowUpdateSchema") {
    const financialSource = presentStringProperty("sourceFinancialAccountId");
    const investmentSource = presentStringProperty("sourceInvestmentAccountId");
    const anySource = { anyOf: [financialSource, investmentSource] };
    const destination = presentStringProperty("destinationInvestmentAccountId");
    addSchemaAllOf(schema, [
      { not: { allOf: [financialSource, investmentSource] } },
      { if: typeIs("EXTERNAL_CONTRIBUTION"), then: { not: anySource } },
      { if: typeIs("INTERNAL_REALLOCATION"), then: { allOf: [anySource, destination] } },
      { if: typeIs("EXTERNAL_WITHDRAWAL"), then: { not: { allOf: [anySource, destination] } } },
    ]);
    schema["x-runtime-refinements"] = [
      "endsOn cannot precede startsOn when both are supplied.",
      "An investment cannot be reallocated to itself.",
    ];
  }

  if (name === "CioRecurringFlowUpdateSchema" || name === "CioPlanningPositionUpdateSchema") {
    schema.minProperties = 1;
  }

  if (name === "CioPlanningPositionCreateSchema" || name === "CioPlanningPositionUpdateSchema") {
    addSchemaAllOf(schema, [{
      if: { properties: { side: { const: "LIABILITY" } }, required: ["side"] },
      then: {
        properties: {
          includeInInvestableAllocation: { const: false },
          includeInRetirementProjection: { const: false },
        },
      },
    }]);
  }

  if (name === "CioRetirementProjectionInputSchema") {
    schema.properties.asOfDate.format = "date";
    schema.not = { required: ["targetRetirementDate", "targetRetirementAge"] };
    schema["x-runtime-refinements"] = [
      "When all are supplied, bearReturnBps must not exceed baseReturnBps and baseReturnBps must not exceed bullReturnBps.",
    ];
  }

  if (name === "CioStrategyReportCreateInputSchema") {
    schema.properties.asOfDate.format = "date";
  }

  return schema;
}

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
  const operationKey = `${method} ${path}`;
  const cioContract = cioOperationContract[operationKey];
  const isAdminAgent = path.startsWith("/api/admin/agents");
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
  const successStatus = cioContract?.successStatus ?? (isAdminAgent && method === "DELETE" ? "204" :
    isAdminAgent && method === "POST" && (path.endsWith("/examples") || path.endsWith("/fine-tuning")) ? "201" : "200");
  const successResponse = { description: successStatus === "201" ? "Resource created" : "Successful response" };
  if (cioContract?.responseContentType) {
    successResponse.content = {
      [cioContract.responseContentType]: {
        schema: { type: "string", format: "binary" },
      },
    };
  }
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
      [successStatus]: successResponse,
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
  if (cioContract) {
    operation.summary = cioContract.summary;
    operation.description = cioContract.sameOrigin
      ? `Requires ${cioContract.role} access to the selected workspace and enforces the shared same-origin mutation check.`
      : `Requires ${cioContract.role} access to the selected workspace. This operation is read-only and does not require the mutation-only same-origin check.`;
    operation.parameters.push({ $ref: "#/components/parameters/WorkspaceIdHeader" });
    operation.responses["404"] = { $ref: "#/components/responses/NotFound" };
    operation["x-required-workspace-role"] = cioContract.role;
    operation["x-same-origin-required"] = cioContract.sameOrigin;
  }
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
  if (isAdminAgent) {
    operation.description = "Requires the configured platform administrator. Agent configuration and curated examples are global; workspace roles do not grant administrator access.";
    operation["x-required-admin"] = true;
    operation["x-same-origin-required"] = method !== "GET";
    operation.responses["404"] = { $ref: "#/components/responses/NotFound" };
    const agentParam = operation.parameters.find((parameter) => parameter.name === "agentId");
    if (agentParam) agentParam.schema.enum = ["ask-nest", "transaction-assistant", "smart-review"];
    if (path.endsWith("/dataset")) {
      operation.parameters.push({ name: "purpose", in: "query", required: false, schema: { type: "string", enum: ["TRAINING", "EVALUATION"], default: "TRAINING" } });
      successResponse.content = { "application/x-ndjson": { schema: { type: "string" } } };
    }
  }
  const acceptsJsonBody = method === "POST" || method === "PUT" || method === "PATCH" || (isAdminAgent && method === "DELETE");
  if ((acceptsJsonBody || !cioContract) && schemaNames.length) operation["x-request-schemas"] = schemaNames;
  const registeredSchema = requestSchemaByOperation[operationKey];
  if (path === "/api/ai/transactions") {
    operation.summary = method === "GET" ? "Restore a transaction draft" : "Draft, clarify, confirm, or cancel a transaction";
    operation["x-required-workspace-role"] = "EDITOR";
    operation["x-same-origin-required"] = method === "POST";
    operation.parameters.push({ $ref: "#/components/parameters/WorkspaceIdHeader" });
    if (method === "GET") {
      delete operation["x-request-schemas"];
      operation.parameters.push({ name: "draftId", in: "query", required: true, schema: { type: "string", maxLength: 191 } });
    }
  }
  if (registeredSchema && acceptsJsonBody) operation["x-request-schemas"] = [registeredSchema];
  if (acceptsJsonBody) {
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
    if (cioContract && registeredSchema) {
      operation.responses["413"] = { $ref: "#/components/responses/RequestTooLarge" };
      operation.responses["415"] = { $ref: "#/components/responses/UnsupportedMediaType" };
    }
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
    parameters: {
      WorkspaceIdHeader: {
        name: "X-Workspace-Id",
        in: "header",
        required: false,
        description: "Selects the active workspace for this request. Membership and the documented minimum role are always revalidated. When omitted, the authenticated user's active workspace fallback is used.",
        schema: { type: "string", minLength: 1, maxLength: 191 },
      },
    },
    schemas: {
      ApiError: errorSchema,
      ...Object.fromEntries(
        Object.entries(schemaRegistry).map(([name, schema]) => [name, openApiSchema(name, schema)]),
      ),
    },
    responses: {
      InvalidRequest: response("Invalid request"),
      Unauthenticated: response("A valid session is required"),
      Forbidden: response("The session lacks the required workspace role"),
      NotFound: response("The workspace-scoped resource was not found"),
      Conflict: response("The request conflicts with current state or idempotency history"),
      UnprocessableEntity: response("The JSON body or query failed schema validation"),
      RequestTooLarge: response("The request body exceeds the route-specific byte limit"),
      UnsupportedMediaType: response("The request body must use application/json or a +json media type"),
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
