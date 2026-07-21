"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/admin-auth";
import { requestBackgroundJobCancellation, retryBackgroundJob } from "@/lib/background-jobs";
import { prisma } from "@/lib/prisma";

function jobIdFrom(formData: FormData) {
  const value = formData.get("jobId");
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(value)) throw new Error("Invalid job id.");
  return value;
}

export async function retryJobAction(formData: FormData) {
  await requireAdminPage();
  const job = await retryBackgroundJob(jobIdFrom(formData));
  if (job?.type === "GMAIL_SYNC") {
    const { processGmailSyncQueue } = await import("@/lib/gmail-sync-runner");
    await processGmailSyncQueue({ jobId: job.id, maxSlices: 1 });
  } else if (job?.type === "CREDIT_CARD_PAYMENT_REMINDER_EMAIL") {
    const { processReminderEmailDeliveryJob } = await import("@/lib/credit-card-payment-reminders");
    await processReminderEmailDeliveryJob(job.id);
  } else if (job?.type === "CREDIT_CARD_PAYMENT_REMINDER_PUSH") {
    const { processReminderPushDeliveryJob } = await import("@/lib/in-app-notifications");
    await processReminderPushDeliveryJob(job.id);
  } else if (job?.type === "CREDIT_TXN_AUTO_ACCOUNT" && job.workspaceId) {
    const { runCreditTxnAutoAccounting } = await import("@/lib/credit-txn-auto-account-runner");
    await runCreditTxnAutoAccounting(prisma, { jobId: job.id, workspaceId: job.workspaceId });
  }
  revalidatePath("/admin");
}

export async function cancelJobAction(formData: FormData) {
  await requireAdminPage();
  await requestBackgroundJobCancellation(jobIdFrom(formData));
  revalidatePath("/admin");
}
