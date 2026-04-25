import { PrismaClient } from "@prisma/client";
import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import {
  CreditTxnAutoRule,
  CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS,
  findFirstMatchingCreditTxnRule,
  parseCreditTxnAutoRules,
} from "@/lib/credit-txn-auto-rules";
import { prisma } from "@/lib/prisma";

declare global {
  // eslint-disable-next-line no-var
  var __nestCreditTxnAutoAccountRunning: boolean | undefined;
}

type RunnerSummary = {
  scanned: number;
  matched: number;
  accounted: number;
  skipped: number;
};

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
  const account = await db.financialAccount.findFirst({
    where: {
      id: rule.destinationAccountId,
      workspaceId: transaction.workspaceId,
      kind: "BANK",
      isActive: true,
    },
    select: { id: true },
  });
  if (!account) return false;

  const budget = await db.budgetEnvelope.findFirst({
    where: {
      id: rule.destinationBudgetId,
      workspaceId: transaction.workspaceId,
      accountId: account.id,
      isActive: true,
    },
    select: { id: true },
  });
  if (!budget) return false;

  await db.$transaction(async (tx) => {
    const posted = await tx.transaction.create({
      data: {
        workspaceId: transaction.workspaceId,
        accountId: account.id,
        budgetId: budget.id,
        kind: "CREDIT_CARD_PAYMENT",
        direction: "DEBIT",
        date: transaction.transactionDate,
        amountCents: transaction.amountCents,
        subject: transaction.subject,
        details: `Auto-accounted by rule "${rule.name}" from ${transaction.creditCard.cardName} ••${transaction.creditCard.last4Digit}`,
        isSynced: false,
        isFromFamily: false,
      },
      select: { id: true },
    });

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

    await recalculateBudgetAvailableCents(tx, transaction.workspaceId, budget.id);
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

export async function runCreditTxnAutoAccounting(db: PrismaClient = prisma): Promise<RunnerSummary> {
  if (globalThis.__nestCreditTxnAutoAccountRunning) {
    return { scanned: 0, matched: 0, accounted: 0, skipped: 0 };
  }

  globalThis.__nestCreditTxnAutoAccountRunning = true;

  try {
    const workspaces = await db.workspace.findMany({
      where: { creditCardAutoRules: { not: null } },
      select: { id: true, creditCardAutoRules: true },
    });

    const summary: RunnerSummary = { scanned: 0, matched: 0, accounted: 0, skipped: 0 };

    for (const workspace of workspaces) {
      const rules = parseCreditTxnAutoRules(workspace.creditCardAutoRules).filter((rule) => rule.enabled);
      if (rules.length === 0) continue;

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
    }

    return summary;
  } finally {
    globalThis.__nestCreditTxnAutoAccountRunning = false;
  }
}

export function getCreditTxnAutoAccountIntervalMs() {
  return CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS;
}
