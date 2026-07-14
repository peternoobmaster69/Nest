import { PrismaClient } from "@prisma/client";
import { applyBudgetAvailableDelta } from "@/lib/budget-ledger";
import {
  completeBackgroundJob,
  createBackgroundJob,
  failBackgroundJob,
  findActiveBackgroundJob,
  updateBackgroundJobProgress,
} from "@/lib/background-jobs";
import {
  CreditTxnAutoRule,
  CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS,
  findFirstMatchingCreditTxnRule,
  parseCreditTxnAutoRules,
} from "@/lib/credit-txn-auto-rules";
import { prisma } from "@/lib/prisma";

declare global {
  var __nestCreditTxnAutoAccountRunning: boolean | undefined;
}

type RunnerSummary = {
  scanned: number;
  matched: number;
  accounted: number;
  skipped: number;
  jobId?: string;
  alreadyRunning?: boolean;
};

type RunnerOptions = {
  jobId?: string;
  workspaceId?: string;
};

export const CREDIT_TXN_AUTO_ACCOUNT_JOB_TYPE = "CREDIT_TXN_AUTO_ACCOUNT";
export const CREDIT_TXN_AUTO_ACCOUNT_JOB_KEY = "global";

function formatAutoReceivableGroupTitle(ruleName: string, transactionDate: Date) {
  const monthLabel = transactionDate.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${ruleName} (${monthLabel})`;
}

async function applyDeductRule(
  db: PrismaClient,
  transaction: {
    id: string;
    workspaceId: string;
    creditCardId: string;
    transactionDate: Date;
    amountCents: number;
    subject: string;
    creditCard: { cardName: string; last4Digit: string };
  },
  rule: Extract<CreditTxnAutoRule, { action: "DEDUCT_SAME_WORKSPACE" }>,
) {
  const sameWorkspaceBudgets = await db.budgetEnvelope.findMany({
    where: {
      workspaceId: transaction.workspaceId,
      id: { in: [rule.sourceBudgetId, rule.destinationBudgetId] },
      isActive: true,
      account: {
        kind: "BANK",
        isActive: true,
      },
    },
    select: { id: true, name: true, accountId: true },
  });

  const sourceBudget = sameWorkspaceBudgets.find((budget) => budget.id === rule.sourceBudgetId);
  const destinationBudget = sameWorkspaceBudgets.find((budget) => budget.id === rule.destinationBudgetId);
  if (!sourceBudget || !destinationBudget) return false;

  const shouldCreateDestinationCredit = sourceBudget.id !== destinationBudget.id;
  const externalRef = `credit-auto:${transaction.id}:${rule.id}`;

  await db.$transaction(async (tx) => {
    const posted = await tx.transaction.create({
      data: {
        workspaceId: transaction.workspaceId,
        accountId: sourceBudget.accountId,
        budgetId: sourceBudget.id,
        kind: "CREDIT_CARD_PAYMENT",
        direction: "DEBIT",
        date: transaction.transactionDate,
        amountCents: transaction.amountCents,
        subject: transaction.subject,
        details: `Auto-accounted by rule "${rule.name}" from ${transaction.creditCard.cardName} ending ${transaction.creditCard.last4Digit}`,
        externalRef,
        isSynced: false,
        isFromFamily: false,
      },
      select: { id: true },
    });

    if (shouldCreateDestinationCredit) {
      await tx.transaction.create({
        data: {
          workspaceId: transaction.workspaceId,
          accountId: destinationBudget.accountId,
          budgetId: destinationBudget.id,
          kind: "CREDIT_CARD_PAYMENT",
          direction: "CREDIT",
          date: transaction.transactionDate,
          amountCents: transaction.amountCents,
          subject: transaction.subject,
          details: `Auto-accounted by rule "${rule.name}" to ${destinationBudget.name}`,
          externalRef,
          isSynced: false,
          isFromFamily: false,
        },
      });
    }

    await tx.creditCardTxnLink.create({
      data: {
        creditCardId: transaction.creditCardId,
        transactionId: posted.id,
        cardNameSnapshot: transaction.creditCard.cardName,
        cardNoEnding: transaction.creditCard.last4Digit,
        txDate: transaction.transactionDate,
        isProcessed: true,
        interfacedAt: new Date(),
      },
    });

    await tx.creditCardTransaction.update({
      where: { id: transaction.id },
      data: { isAllocated: true },
    });

    await applyBudgetAvailableDelta(tx, sourceBudget.id, -transaction.amountCents);
    if (shouldCreateDestinationCredit) {
      await applyBudgetAvailableDelta(tx, destinationBudget.id, transaction.amountCents);
    }
  });

  return true;
}

async function applyReceivableRule(
  db: PrismaClient,
  transaction: {
    id: string;
    workspaceId: string;
    creditCardId: string;
    transactionDate: Date;
    amountCents: number;
    subject: string;
    creditCard: { cardName: string; last4Digit: string };
  },
  rule: Extract<CreditTxnAutoRule, { action: "RECEIVABLE_OTHER_WORKSPACE" }>,
) {
  const account = await db.financialAccount.findFirst({
    where: {
      id: rule.sourceAccountId,
      workspaceId: rule.sourceWorkspaceId,
      kind: "BANK",
      isActive: true,
    },
    select: { id: true },
  });
  if (!account) return false;

  const budget = await db.budgetEnvelope.findFirst({
    where: {
      id: rule.sourceBudgetId,
      workspaceId: rule.sourceWorkspaceId,
      accountId: account.id,
      isActive: true,
    },
    select: { id: true },
  });
  if (!budget) return false;

  await db.$transaction(async (tx) => {
    const groupTitle = formatAutoReceivableGroupTitle(rule.name, transaction.transactionDate);
    const monthStart = new Date(
      Date.UTC(transaction.transactionDate.getUTCFullYear(), transaction.transactionDate.getUTCMonth(), 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(transaction.transactionDate.getUTCFullYear(), transaction.transactionDate.getUTCMonth() + 1, 1),
    );
    const noteLine = `${transaction.transactionDate.toISOString().slice(0, 10)} - ${transaction.creditCard.cardName} ending ${transaction.creditCard.last4Digit} - ${transaction.subject} - ${(transaction.amountCents / 100).toFixed(2)}`;

    const existingReceivable = await tx.receivable.findFirst({
      where: {
        workspaceId: transaction.workspaceId,
        title: groupTitle,
        sourceWorkspaceId: rule.sourceWorkspaceId,
        sourceAccountId: rule.sourceAccountId,
        sourceBudgetId: rule.sourceBudgetId,
        status: { in: ["OPEN", "PARTIAL"] },
        date: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, notes: true },
    });

    if (existingReceivable) {
      await tx.receivable.update({
        where: { id: existingReceivable.id },
        data: {
          amountCents: { increment: transaction.amountCents },
          transactionDate: transaction.transactionDate,
          remarkTogether: `Auto-accounted by rule "${rule.name}"`,
          notes: existingReceivable.notes?.trim()
            ? `${existingReceivable.notes.trim()}
${noteLine}`
            : noteLine,
        },
        select: { id: true },
      });
    } else {
      await tx.receivable.create({
        data: {
          workspaceId: transaction.workspaceId,
          title: groupTitle,
          amountCents: transaction.amountCents,
          date: transaction.transactionDate,
          transactionDate: transaction.transactionDate,
          remarkTogether: `Auto-accounted by rule "${rule.name}"`,
          notes: noteLine,
          sourceWorkspaceId: rule.sourceWorkspaceId,
          sourceAccountId: rule.sourceAccountId,
          sourceBudgetId: rule.sourceBudgetId,
          status: "OPEN",
        },
        select: { id: true },
      });
    }

    await tx.creditCardTransaction.update({
      where: { id: transaction.id },
      data: { isAllocated: true },
    });
  });

  return true;
}

async function applyRuleToTransaction(
  db: PrismaClient,
  transaction: {
    id: string;
    workspaceId: string;
    creditCardId: string;
    transactionDate: Date;
    amountCents: number;
    subject: string;
    creditCard: { cardName: string; last4Digit: string };
  },
  rule: CreditTxnAutoRule,
) {
  if (rule.action === "DEDUCT_SAME_WORKSPACE") {
    return applyDeductRule(db, transaction, rule);
  }
  return applyReceivableRule(db, transaction, rule);
}

export async function runCreditTxnAutoAccounting(
  db: PrismaClient = prisma,
  options: RunnerOptions = {},
): Promise<RunnerSummary> {
  const { jobId, workspaceId } = options;
  const jobKey = workspaceId ? `workspace:${workspaceId}` : CREDIT_TXN_AUTO_ACCOUNT_JOB_KEY;
  if (globalThis.__nestCreditTxnAutoAccountRunning) {
    return { scanned: 0, matched: 0, accounted: 0, skipped: 0, jobId, alreadyRunning: true };
  }

  let persistedJobId = jobId;
  if (!persistedJobId) {
    const activeJob = await findActiveBackgroundJob(CREDIT_TXN_AUTO_ACCOUNT_JOB_TYPE, jobKey);
    if (activeJob) {
      return { scanned: 0, matched: 0, accounted: 0, skipped: 0, jobId: activeJob.id, alreadyRunning: true };
    }

    const job = await createBackgroundJob({
      type: CREDIT_TXN_AUTO_ACCOUNT_JOB_TYPE,
      key: jobKey,
      workspaceId,
      message: "Credit transaction auto-accounting started.",
    });
    persistedJobId = job.id;
  }

  globalThis.__nestCreditTxnAutoAccountRunning = true;

  try {
    await updateBackgroundJobProgress(persistedJobId, {
      progress: 5,
      message: "Loading workspaces with auto-accounting rules...",
    });

    const workspaces = await db.workspace.findMany({
      where: {
        creditCardAutoRules: { not: null },
        ...(workspaceId ? { id: workspaceId } : {}),
      },
      select: { id: true, creditCardAutoRules: true },
    });

    const summary: RunnerSummary = { scanned: 0, matched: 0, accounted: 0, skipped: 0 };
    let processedWorkspaces = 0;

    for (const workspace of workspaces) {
      const rules = parseCreditTxnAutoRules(workspace.creditCardAutoRules).filter((rule) => rule.enabled);
      if (rules.length === 0) {
        processedWorkspaces += 1;
        continue;
      }

      const creditTransactions = await db.creditCardTransaction.findMany({
        where: {
          workspaceId: workspace.id,
          isAllocated: false,
        },
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
        include: {
          creditCard: {
            select: {
              cardName: true,
              last4Digit: true,
            },
          },
        },
      });

      for (const creditTransaction of creditTransactions) {
        summary.scanned += 1;
        const rule = findFirstMatchingCreditTxnRule(creditTransaction.subject, rules);
        if (!rule) continue;

        summary.matched += 1;
        const accounted = await applyRuleToTransaction(db, creditTransaction, rule);
        if (accounted) summary.accounted += 1;
        else summary.skipped += 1;
      }

      processedWorkspaces += 1;
      await updateBackgroundJobProgress(persistedJobId, {
        progress: 5 + (processedWorkspaces / Math.max(workspaces.length, 1)) * 90,
        message: `Processed ${processedWorkspaces}/${workspaces.length} workspaces.`,
        total: workspaces.length,
        current: processedWorkspaces,
      });
    }

    const result = { ...summary, jobId: persistedJobId };
    await completeBackgroundJob(persistedJobId, {
      message: `Auto-accounting complete: ${summary.accounted} accounted, ${summary.skipped} skipped.`,
      result,
    });
    return result;
  } catch (error) {
    await failBackgroundJob(persistedJobId, error);
    throw error;
  } finally {
    globalThis.__nestCreditTxnAutoAccountRunning = false;
  }
}

export function getCreditTxnAutoAccountIntervalMs() {
  return CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS;
}
