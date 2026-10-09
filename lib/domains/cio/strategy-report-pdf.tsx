import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type {
  CioStrategyReportModel,
} from "./report-types";
import type { Style } from "@react-pdf/types";
import type { CioStrategyRecommendation } from "./strategy-recommendations";

const colors = {
  navy: "#102A43",
  blue: "#1D5D79",
  teal: "#1E7A73",
  gold: "#C79A3B",
  ink: "#243B53",
  muted: "#627D98",
  line: "#D9E2EC",
  pale: "#F0F4F8",
  white: "#FFFFFF",
  danger: "#B42318",
  warning: "#9A6700",
  success: "#067647",
};

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 48, paddingHorizontal: 42, fontFamily: "Helvetica", fontSize: 8.5, color: colors.ink, lineHeight: 1.42 },
  cover: { padding: 48, fontFamily: "Helvetica", backgroundColor: colors.navy, color: colors.white },
  coverRule: { width: 54, height: 4, marginTop: 24, marginBottom: 24, backgroundColor: colors.gold },
  coverEyebrow: { fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#B8D8E8" },
  coverTitle: { marginTop: 92, fontSize: 29, lineHeight: 1.12, fontFamily: "Helvetica-Bold" },
  coverSubtitle: { width: "82%", fontSize: 13, lineHeight: 1.45, color: "#D9EAF2" },
  coverMeta: { position: "absolute", left: 48, right: 48, bottom: 52, borderTopWidth: 1, borderTopColor: "#365F75", paddingTop: 15 },
  coverMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  header: { position: "absolute", top: 20, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between", paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: colors.line, fontSize: 7, color: colors.muted },
  footer: { position: "absolute", bottom: 18, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between", paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.line, fontSize: 6.5, color: colors.muted },
  eyebrow: { marginBottom: 5, fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", color: colors.teal, fontFamily: "Helvetica-Bold" },
  pageTitle: { marginBottom: 5, fontSize: 20, color: colors.navy, fontFamily: "Helvetica-Bold" },
  lead: { marginBottom: 16, fontSize: 10, lineHeight: 1.5, color: colors.muted },
  status: { alignSelf: "flex-start", marginBottom: 12, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 3, backgroundColor: "#E8F3F3", color: colors.teal, fontSize: 7, fontFamily: "Helvetica-Bold" },
  verdict: { marginBottom: 14, padding: 14, borderLeftWidth: 4, borderLeftColor: colors.gold, backgroundColor: colors.pale, fontSize: 12, lineHeight: 1.45, color: colors.navy, fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 15 },
  sectionTitle: { marginBottom: 7, paddingBottom: 4, borderBottomWidth: 1.5, borderBottomColor: colors.navy, fontSize: 12, color: colors.navy, fontFamily: "Helvetica-Bold" },
  subheading: { marginTop: 7, marginBottom: 4, fontSize: 9, color: colors.navy, fontFamily: "Helvetica-Bold" },
  paragraph: { marginBottom: 6 },
  bulletRow: { flexDirection: "row", marginBottom: 5 },
  bullet: { width: 12, color: colors.gold, fontFamily: "Helvetica-Bold" },
  bulletText: { flex: 1 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4, marginBottom: 10 },
  metricCard: { width: "33.333%", paddingHorizontal: 4, marginBottom: 8 },
  metricInner: { minHeight: 54, padding: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 3, backgroundColor: colors.white },
  metricValue: { marginBottom: 3, fontSize: 13, color: colors.navy, fontFamily: "Helvetica-Bold" },
  metricLabel: { fontSize: 7, color: colors.muted },
  recommendation: { marginBottom: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: colors.teal, backgroundColor: colors.pale },
  recommendationCritical: { borderLeftColor: colors.danger },
  recommendationHigh: { borderLeftColor: colors.warning },
  recommendationHeading: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  recommendationTitle: { width: "78%", fontSize: 9, color: colors.navy, fontFamily: "Helvetica-Bold" },
  recommendationSeverity: { fontSize: 6.5, color: colors.muted, fontFamily: "Helvetica-Bold" },
  recommendationAction: { marginBottom: 4, fontSize: 8.5, fontFamily: "Helvetica-Bold" },
  recommendationRationale: { color: colors.muted },
  recommendationMetrics: { flexDirection: "row", marginTop: 6 },
  recommendationMetric: { marginRight: 20 },
  table: { width: "100%", marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  tableRow: { flexDirection: "row", minHeight: 23, borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: "center" },
  tableRowLast: { borderBottomWidth: 0 },
  tableHeader: { backgroundColor: colors.navy, color: colors.white, fontFamily: "Helvetica-Bold" },
  cell: { paddingVertical: 5, paddingHorizontal: 6 },
  cellGrow: { flex: 1 },
  cell20: { width: "20%" },
  cell24: { width: "24%" },
  cell28: { width: "28%" },
  cell32: { width: "32%" },
  cell40: { width: "40%" },
  cellRight: { textAlign: "right" },
  note: { padding: 8, backgroundColor: "#FFF8E8", color: colors.warning, fontSize: 7.5 },
  twoColumn: { flexDirection: "row", marginHorizontal: -6 },
  column: { width: "50%", paddingHorizontal: 6 },
  exception: { marginBottom: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  exceptionTitle: { marginBottom: 2, fontFamily: "Helvetica-Bold", color: colors.navy },
  small: { fontSize: 7, color: colors.muted },
});

function money(valueCents: number | null, currency: string) {
  if (valueCents === null) return "Not configured";
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  }).format(valueCents / 100).replace(/\u00a0/g, " ");
}

function percent(valueBps: number | null) {
  return valueBps === null ? "Not configured" : `${(valueBps / 100).toFixed(1)}%`;
}

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metricValue(metric: NonNullable<CioStrategyRecommendation["current"]>, currency: string) {
  if (metric.unit === "CENTS") return money(metric.value, currency);
  if (metric.unit === "BPS") return percent(metric.value);
  if (metric.unit === "MONTHS") return `${metric.value.toFixed(1)} months`;
  return String(metric.value);
}

function Header({ report }: Readonly<{ report: CioStrategyReportModel }>) {
  return (
    <View style={styles.header} fixed>
      <Text>{report.workspaceName.toUpperCase()} · HOUSEHOLD CIO STRATEGY</Text>
      <Text>DATA AS AT {report.asOfDate}</Text>
    </View>
  );
}

function Footer({ report }: Readonly<{ report: CioStrategyReportModel }>) {
  return (
    <View style={styles.footer} fixed>
      <Text>CONFIDENTIAL · DETERMINISTIC STRATEGY PLANNING</Text>
      <Text render={({ pageNumber, totalPages }) => `PAGE ${pageNumber} OF ${totalPages} · REVIEW BY ${report.reviewByDate}`} />
    </View>
  );
}

function ReportPage({ report, children }: Readonly<{ report: CioStrategyReportModel; children: React.ReactNode }>) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <Header report={report} />
      {children}
      <Footer report={report} />
    </Page>
  );
}

function PageHeading({ eyebrow, title, lead }: Readonly<{ eyebrow: string; title: string; lead: string }>) {
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.lead}>{lead}</Text>
    </View>
  );
}

function MetricCard({ value, label: itemLabel }: Readonly<{ value: string; label: string }>) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricInner}>
        <Text style={styles.metricValue}>{value}</Text>
        <Text style={styles.metricLabel}>{itemLabel}</Text>
      </View>
    </View>
  );
}

function RecommendationCard({ item, currency }: Readonly<{ item: CioStrategyRecommendation; currency: string }>) {
  let severityStyle: Style | undefined;
  if (item.severity === "CRITICAL") severityStyle = styles.recommendationCritical;
  else if (item.severity === "HIGH") severityStyle = styles.recommendationHigh;
  return (
    <View style={severityStyle ? [styles.recommendation, severityStyle] : styles.recommendation} wrap={false}>
      <View style={styles.recommendationHeading}>
        <Text style={styles.recommendationTitle}>{item.title}</Text>
        <Text style={styles.recommendationSeverity}>{item.severity}</Text>
      </View>
      <Text style={styles.recommendationAction}>{item.action}</Text>
      <Text style={styles.recommendationRationale}>{item.rationale}</Text>
      {item.current || item.target ? (
        <View style={styles.recommendationMetrics}>
          {item.current ? <Text style={styles.recommendationMetric}>{item.current.label}: {metricValue(item.current, currency)}</Text> : null}
          {item.target ? <Text style={styles.recommendationMetric}>{item.target.label}: {metricValue(item.target, currency)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function TableHeader({ cells }: Readonly<{ cells: Array<{ label: string; style: Style }> }>) {
  return (
    <View style={[styles.tableRow, styles.tableHeader]} fixed>
      {cells.map((cell) => <Text key={cell.label} style={[styles.cell, cell.style]}>{cell.label}</Text>)}
    </View>
  );
}

function AllocationTable({ report }: Readonly<{ report: CioStrategyReportModel }>) {
  const targetByAsset = new Map(report.policy.assetClassBands.map((band) => [band.assetClass, band]));
  return (
    <View style={styles.table}>
      <TableHeader cells={[
        { label: "Asset class", style: styles.cell40 },
        { label: "Current value", style: styles.cell24 },
        { label: "Allocation", style: styles.cell20 },
        { label: "Policy band", style: styles.cellGrow },
      ]} />
      {report.allocation.assetClasses.map((item, index) => {
        const band = targetByAsset.get(item.key);
        return (
          <View key={item.key} style={index === report.allocation.assetClasses.length - 1 ? [styles.tableRow, styles.tableRowLast] : styles.tableRow} wrap={false}>
            <Text style={[styles.cell, styles.cell40]}>{label(item.key)}{item.isUnknown ? " (incomplete)" : ""}</Text>
            <Text style={[styles.cell, styles.cell24, styles.cellRight]}>{money(item.valueCents, report.baseCurrency)}</Text>
            <Text style={[styles.cell, styles.cell20, styles.cellRight]}>{percent(item.allocationBps)}</Text>
            <Text style={[styles.cell, styles.cellGrow, styles.cellRight]}>{band ? `${percent(band.minimumBps)}–${percent(band.maximumBps)}` : "Not set"}</Text>
          </View>
        );
      })}
    </View>
  );
}

function InvestmentsTable({ report }: Readonly<{ report: CioStrategyReportModel }>) {
  return (
    <View style={styles.table}>
      <TableHeader cells={[
        { label: "Account / product", style: styles.cell40 },
        { label: "Current value", style: styles.cell24 },
        { label: "Role", style: styles.cell20 },
        { label: "Liquidity", style: styles.cellGrow },
      ]} />
      {report.investments.map((item, index) => (
        <View key={item.id} style={index === report.investments.length - 1 ? [styles.tableRow, styles.tableRowLast] : styles.tableRow} wrap={false}>
          <View style={[styles.cell, styles.cell40]}>
            <Text>{item.label}</Text>
            <Text style={styles.small}>{item.institutionName}</Text>
          </View>
          <Text style={[styles.cell, styles.cell24, styles.cellRight]}>{money(item.currentValueCents, report.baseCurrency)}</Text>
          <Text style={[styles.cell, styles.cell20, styles.cellRight]}>{item.portfolioRole ? label(item.portfolioRole) : "Not set"}</Text>
          <Text style={[styles.cell, styles.cellGrow, styles.cellRight]}>{label(item.liquidityClass)}</Text>
        </View>
      ))}
    </View>
  );
}

function RetirementTable({ report }: Readonly<{ report: CioStrategyReportModel }>) {
  return (
    <View style={styles.table}>
      <TableHeader cells={[
        { label: "Scenario", style: styles.cell20 },
        { label: "Return", style: styles.cell20 },
        { label: "Fund (today’s money)", style: styles.cell24 },
        { label: "Monthly income", style: styles.cell20 },
        { label: "Gap / surplus", style: styles.cellGrow },
      ]} />
      {report.retirement.scenarios.map((item, index) => (
        <View key={item.scenario} style={index === report.retirement.scenarios.length - 1 ? [styles.tableRow, styles.tableRowLast] : styles.tableRow}>
          <Text style={[styles.cell, styles.cell20]}>{label(item.scenario)}</Text>
          <Text style={[styles.cell, styles.cell20, styles.cellRight]}>{percent(item.nominalReturnBps)}</Text>
          <Text style={[styles.cell, styles.cell24, styles.cellRight]}>{money(item.fundAtRetirementRealCents, report.baseCurrency)}</Text>
          <Text style={[styles.cell, styles.cell20, styles.cellRight]}>{money(item.sustainableMonthlyIncomeRealCents, report.baseCurrency)}</Text>
          <Text style={[styles.cell, styles.cellGrow, styles.cellRight]}>{money(item.targetGapOrSurplusRealCents, report.baseCurrency)}</Text>
        </View>
      ))}
    </View>
  );
}

export function CioStrategyReportDocument({ report }: Readonly<{ report: CioStrategyReportModel }>) {
  return (
    <Document title={report.title} author="Nest CIO" subject="Household investment and retirement strategy">
      <Page size="A4" style={styles.cover}>
        <Text style={styles.coverEyebrow}>Confidential · Household planning report</Text>
        <Text style={styles.coverTitle}>{report.title}</Text>
        <View style={styles.coverRule} />
        <Text style={styles.coverSubtitle}>Deterministic investment policy, liquidity, contribution, and retirement recommendations generated from the household’s Nest records.</Text>
        <View style={styles.coverMeta}>
          <View style={styles.coverMetaRow}><Text>Financial data as at</Text><Text>{report.asOfDate}</Text></View>
          <View style={styles.coverMetaRow}><Text>Report generated</Text><Text>{report.generatedAt.slice(0, 10)}</Text></View>
          <View style={styles.coverMetaRow}><Text>Recommended review</Text><Text>{report.reviewByDate}</Text></View>
          <View style={styles.coverMetaRow}><Text>Report version</Text><Text>{report.schemaVersion}</Text></View>
        </View>
      </Page>

      <ReportPage report={report}>
        <PageHeading eyebrow="CIO assessment" title="Executive strategy" lead="The conclusions below are ordered by financial resilience first, then long-term optimization." />
        <Text style={styles.status}>{report.strategyStatus.replaceAll("_", " ")}</Text>
        <Text style={styles.verdict}>{report.executiveStance}</Text>
        <View style={styles.metricGrid}>
          <MetricCard value={money(report.totals.financialAssetsCents, report.baseCurrency)} label="Financial assets" />
          <MetricCard value={money(report.totals.planningNetWorthCents, report.baseCurrency)} label="Planning net worth" />
          <MetricCard value={money(report.totals.retirementIncludedAssetsCents, report.baseCurrency)} label="Retirement-included assets" />
          <MetricCard value={percent(report.dataQuality.completenessBps)} label="Data completeness" />
          <MetricCard value={report.liquidity.emergencyRunwayMonths === null ? "Not configured" : `${report.liquidity.emergencyRunwayMonths.toFixed(1)} months`} label="Emergency runway" />
          <MetricCard value={money(report.contributions.retirementContributionAnnualCents, report.baseCurrency)} label="Annual retirement contribution" />
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Priority actions</Text>
          {report.recommendations.slice(0, 6).map((item) => <RecommendationCard key={item.id} item={item} currency={report.baseCurrency} />)}
        </View>
      </ReportPage>

      <ReportPage report={report}>
        <PageHeading eyebrow="Balance sheet" title="What the household owns" lead="Planning assets and liabilities are shown separately from Nest's existing dashboard net-worth semantics." />
        <View style={styles.metricGrid}>
          <MetricCard value={money(report.totals.investableAssetsCents, report.baseCurrency)} label="Investable assets" />
          <MetricCard value={money(report.totals.planningAssetsCents, report.baseCurrency)} label="Other planning assets" />
          <MetricCard value={money(report.totals.planningLiabilitiesCents, report.baseCurrency)} label="Planning liabilities" />
        </View>
        <Text style={styles.sectionTitle}>Investment accounts</Text>
        {report.investments.length ? <InvestmentsTable report={report} /> : <Text style={styles.note}>No investment accounts are available for this report.</Text>}
        <Text style={styles.sectionTitle}>Asset allocation versus policy</Text>
        <AllocationTable report={report} />
        {!report.policy.confirmed ? <Text style={styles.note}>The investment policy is not confirmed. Allocation routing recommendations remain limited until household guardrails are adopted.</Text> : null}
      </ReportPage>

      <ReportPage report={report}>
        <PageHeading eyebrow="Household operating system" title="Liquidity and contribution discipline" lead="A transfer between recorded accounts is not income, saving, or investment return." />
        <View style={styles.metricGrid}>
          <MetricCard value={money(report.liquidity.immediateCents, report.baseCurrency)} label="Immediate cash" />
          <MetricCard value={money(report.liquidity.liquidCents, report.baseCurrency)} label="Liquid investments" />
          <MetricCard value={money(report.liquidity.readilyAvailableCents, report.baseCurrency)} label="Readily available" />
          <MetricCard value={money(report.liquidity.restrictedCents, report.baseCurrency)} label="Restricted" />
          <MetricCard value={money(report.liquidity.lockedCents, report.baseCurrency)} label="Locked" />
          <MetricCard value={money(report.liquidity.essentialMonthlyExpenseCents, report.baseCurrency)} label="Essential monthly spending" />
        </View>
        <View style={styles.twoColumn}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Annual flows</Text>
            <Text style={styles.paragraph}>External contributions: {money(report.contributions.externalContributionAnnualCents, report.baseCurrency)}</Text>
            <Text style={styles.paragraph}>External withdrawals: {money(report.contributions.externalWithdrawalAnnualCents, report.baseCurrency)}</Text>
            <Text style={styles.paragraph}>Net external contributions: {money(report.contributions.netExternalContributionAnnualCents, report.baseCurrency)}</Text>
            <Text style={styles.paragraph}>Internal reallocations: {money(report.contributions.internalReallocationAnnualCents, report.baseCurrency)}</Text>
          </View>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Confirmed policy</Text>
            <Text style={styles.paragraph}>Liquidity reserve: {money(report.policy.minimumLiquidityReserveCents, report.baseCurrency)}</Text>
            <Text style={styles.paragraph}>Liquidity months: {report.policy.minimumLiquidityMonths ?? "Not configured"}</Text>
            <Text style={styles.paragraph}>Account concentration cap: {percent(report.policy.maximumAccountConcentrationBps)}</Text>
            <Text style={styles.paragraph}>Single-security cap: {percent(report.policy.maximumSingleSecurityConcentrationBps)}</Text>
            <Text style={styles.paragraph}>Satellite cap: {percent(report.policy.maximumSatelliteAllocationBps)}</Text>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Liquidity and allocation actions</Text>
          {report.recommendations.filter((item) => item.category === "LIQUIDITY" || item.category === "ALLOCATION" || item.category === "CONCENTRATION").map((item) => (
            <RecommendationCard key={item.id} item={item} currency={report.baseCurrency} />
          ))}
        </View>
      </ReportPage>

      <ReportPage report={report}>
        <PageHeading eyebrow="Retirement readiness" title="Deterministic funding scenarios" lead="Values are shown in today’s purchasing power and use the household’s configured assumptions." />
        {report.retirement.status === "READY" ? (
          <>
            <View style={styles.metricGrid}>
              <MetricCard value={report.retirement.retirementDate ?? "Not configured"} label="Target retirement date" />
              <MetricCard value={money(report.retirement.targetMonthlySpendingCents, report.baseCurrency)} label="Target monthly spending" />
              <MetricCard value={money(report.retirement.currentAnnualContributionCents, report.baseCurrency)} label="Current annual contribution" />
              <MetricCard value={money(report.retirement.requiredAnnualContributionCents, report.baseCurrency)} label="Base-case required contribution" />
              <MetricCard value={percent(report.retirement.inflationRateBps)} label="Inflation assumption" />
              <MetricCard value={percent(report.retirement.sustainableWithdrawalRateBps)} label="Withdrawal-rate assumption" />
            </View>
            <RetirementTable report={report} />
            {report.recommendations.filter((item) => item.category === "RETIREMENT").map((item) => (
              <RecommendationCard key={item.id} item={item} currency={report.baseCurrency} />
            ))}
          </>
        ) : (
          <View>
            <Text style={styles.note}>The retirement projection is not ready. Missing inputs: {report.retirement.missingFields.join(", ")}.</Text>
            {report.recommendations.filter((item) => item.category === "RETIREMENT").map((item) => (
              <RecommendationCard key={item.id} item={item} currency={report.baseCurrency} />
            ))}
          </View>
        )}
      </ReportPage>

      <ReportPage report={report}>
        <PageHeading eyebrow="Execution" title="Prioritized household action plan" lead="Recommendations require household confirmation and do not create orders or move money." />
        {report.recommendations.map((item) => <RecommendationCard key={item.id} item={item} currency={report.baseCurrency} />)}
        <Text style={styles.sectionTitle}>Policy exceptions</Text>
        {report.policyExceptions.length ? report.policyExceptions.map((item) => (
          <View key={`${item.code}:${item.title}`} style={styles.exception} wrap={false}>
            <Text style={styles.exceptionTitle}>{item.severity} · {item.title}</Text>
            <Text>{item.reviewAction}</Text>
          </View>
        )) : <Text style={styles.paragraph}>No policy exceptions were produced from the configured inputs.</Text>}
      </ReportPage>

      <ReportPage report={report}>
        <PageHeading eyebrow="Appendix" title="Evidence, methodology, and limitations" lead="This section makes the report's data lineage and decision boundaries explicit." />
        <Text style={styles.sectionTitle}>Data quality</Text>
        <Text style={styles.paragraph}>Completeness: {percent(report.dataQuality.completenessBps)} · Latest valuation: {report.dataQuality.latestValuationDate ?? "Not available"} · Oldest valuation: {report.dataQuality.oldestValuationDate ?? "Not available"}</Text>
        {report.dataQuality.warnings.map((item) => (
          <View key={`${item.code}:${item.message}`} style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text><Text style={styles.bulletText}>{item.severity}: {item.message}</Text>
          </View>
        ))}
        <Text style={styles.sectionTitle}>Evidence</Text>
        {report.evidence.map((item, index) => (
          <View key={item.id} style={styles.bulletRow}>
            <Text style={styles.bullet}>{index + 1}.</Text>
            <Text style={styles.bulletText}>{item.label} · {label(item.kind)} · data as at {item.asOfDate}</Text>
          </View>
        ))}
        <Text style={styles.sectionTitle}>Methodology</Text>
        {report.methodology.map((item) => <View key={item} style={styles.bulletRow}><Text style={styles.bullet}>•</Text><Text style={styles.bulletText}>{item}</Text></View>)}
        <Text style={styles.sectionTitle}>Important limitations</Text>
        {report.limitations.map((item) => <View key={item} style={styles.bulletRow}><Text style={styles.bullet}>•</Text><Text style={styles.bulletText}>{item}</Text></View>)}
      </ReportPage>
    </Document>
  );
}

export async function renderCioStrategyReportPdf(report: CioStrategyReportModel) {
  return renderToBuffer(<CioStrategyReportDocument report={report} />);
}
