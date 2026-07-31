import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

async function openApi() {
  return JSON.parse(await readFile(new URL("generated/openapi.json", root), "utf8"));
}

const CIO_OPERATIONS = [
  ["get", "/api/cio/overview", "VIEWER", false, null, "200"],
  ["get", "/api/cio/profile", "VIEWER", false, null, "200"],
  ["patch", "/api/cio/profile", "EDITOR", true, "CioProfileInputSchema", "200"],
  ["get", "/api/cio/policy", "VIEWER", false, null, "200"],
  ["patch", "/api/cio/policy", "EDITOR", true, "CioPolicyInputSchema", "200"],
  ["get", "/api/cio/investments/{investmentId}/profile", "VIEWER", false, null, "200"],
  ["put", "/api/cio/investments/{investmentId}/profile", "EDITOR", true, "CioInvestmentProfileInputSchema", "200"],
  ["get", "/api/cio/investments/{investmentId}/exposures", "VIEWER", false, null, "200"],
  ["put", "/api/cio/investments/{investmentId}/exposures", "EDITOR", true, "CioExposuresInputSchema", "200"],
  ["get", "/api/cio/recurring-flows", "VIEWER", false, null, "200"],
  ["post", "/api/cio/recurring-flows", "EDITOR", true, "CioRecurringFlowCreateSchema", "201"],
  ["patch", "/api/cio/recurring-flows/{id}", "EDITOR", true, "CioRecurringFlowUpdateSchema", "200"],
  ["delete", "/api/cio/recurring-flows/{id}", "EDITOR", true, null, "200"],
  ["get", "/api/cio/planning-positions", "VIEWER", false, null, "200"],
  ["post", "/api/cio/planning-positions", "EDITOR", true, "CioPlanningPositionCreateSchema", "201"],
  ["patch", "/api/cio/planning-positions/{id}", "EDITOR", true, "CioPlanningPositionUpdateSchema", "200"],
  ["delete", "/api/cio/planning-positions/{id}", "EDITOR", true, null, "200"],
  ["post", "/api/cio/retirement-projection", "VIEWER", false, "CioRetirementProjectionInputSchema", "200"],
  ["get", "/api/cio/reports", "VIEWER", false, null, "200"],
  ["post", "/api/cio/reports", "EDITOR", true, "CioStrategyReportCreateInputSchema", "201"],
  ["get", "/api/cio/reports/{id}", "VIEWER", false, null, "200"],
  ["get", "/api/cio/reports/{id}/pdf", "VIEWER", false, null, "200"],
];

test("CIO OpenAPI operations document exact bodies, success statuses, and security", async () => {
  const spec = await openApi();
  const cioPaths = Object.keys(spec.paths).filter((path) => path.startsWith("/api/cio/"));
  assert.equal(cioPaths.length, 13);

  assert.equal(spec.components.parameters.WorkspaceIdHeader.name, "X-Workspace-Id");
  assert.equal(spec.components.parameters.WorkspaceIdHeader.required, false);

  for (const [method, path, role, sameOrigin, schemaName, successStatus] of CIO_OPERATIONS) {
    const operation = spec.paths[path]?.[method];
    assert.ok(operation, `${method.toUpperCase()} ${path} must be documented`);
    assert.deepEqual(operation.security, [{ sessionCookie: [] }, { secureSessionCookie: [] }]);
    assert.ok(
      operation.parameters.some((parameter) => parameter.$ref === "#/components/parameters/WorkspaceIdHeader"),
      `${method.toUpperCase()} ${path} must document optional workspace selection`,
    );
    assert.equal(operation["x-required-workspace-role"], role);
    assert.equal(operation["x-same-origin-required"], sameOrigin);
    assert.ok(operation.responses[successStatus]);

    if (schemaName) {
      assert.equal(
        operation.requestBody.content["application/json"].schema.$ref,
        `#/components/schemas/${schemaName}`,
      );
      assert.deepEqual(operation["x-request-schemas"], [schemaName]);
    } else {
      assert.equal(operation.requestBody, undefined);
      assert.equal(operation["x-request-schemas"], undefined);
    }
  }

  assert.equal(spec.paths["/api/cio/recurring-flows"].post.responses["200"], undefined);
  assert.equal(spec.paths["/api/cio/planning-positions"].post.responses["200"], undefined);
  assert.equal(spec.paths["/api/cio/reports"].post.responses["200"], undefined);
  assert.equal(
    spec.paths["/api/cio/reports/{id}/pdf"].get.responses["200"].content["application/pdf"].schema.format,
    "binary",
  );
});

test("CIO OpenAPI schemas retain representable runtime refinements", async () => {
  const { schemas } = (await openApi()).components;

  assert.equal(schemas.CioRecurringFlowUpdateSchema.minProperties, 1);
  assert.equal(schemas.CioPlanningPositionUpdateSchema.minProperties, 1);
  assert.deepEqual(schemas.CioProfileInputSchema.properties.planningScope.enum, ["INDIVIDUAL", "HOUSEHOLD"]);
  assert.equal(schemas.CioProfileInputSchema.properties.essentialMonthlySpendingCents.anyOf[0].minimum, 0);
  assert.equal(schemas.CioRetirementProjectionInputSchema.properties.asOfDate.format, "date");
  assert.equal(schemas.CioStrategyReportCreateInputSchema.properties.asOfDate.format, "date");
  assert.deepEqual(
    schemas.CioRetirementProjectionInputSchema.not.required,
    ["targetRetirementDate", "targetRetirementAge"],
  );
  assert.ok(schemas.CioInvestmentProfileInputSchema.allOf.length > 0);
  assert.ok(schemas.CioExposuresInputSchema.properties.exposures.items.allOf.length > 0);
  assert.ok(schemas.CioExposuresInputSchema["x-runtime-refinements"].length > 0);
});
