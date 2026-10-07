import { runSecureApiRoute } from "@/lib/api-security";
import { CioBoundedIdSchema } from "@/lib/domains/cio/contracts";
import { getCioStrategyReport } from "@/lib/domains/cio/report-repository";
import { renderCioStrategyReportPdf } from "@/lib/domains/cio/strategy-report-pdf";
import { trimCharacters } from "@/lib/string-boundaries.mjs";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function downloadName(title: string, asOfDate: string) {
  const normalized = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-");
  const stem = trimCharacters(normalized, "-").slice(0, 80) || "CIO-Strategy";
  return `${stem}-${asOfDate}.pdf`;
}

export async function GET(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to render CIO strategy report",
  }, async ({ auth }) => {
    const id = CioBoundedIdSchema.parse((await params).id);
    const stored = await getCioStrategyReport(auth!.workspaceId, id);
    const pdf = await renderCioStrategyReportPdf(stored.report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName(stored.report.title, stored.report.asOfDate)}"`,
        "Content-Length": String(pdf.byteLength),
        ETag: `"${stored.contentHash}"`,
      },
    });
  });
}
