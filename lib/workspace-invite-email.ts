import { EmailClient, KnownEmailSendStatus } from "@azure/communication-email";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

export async function sendWorkspaceInviteEmail(input: {
  to: string;
  workspaceName: string;
  role: "EDITOR" | "VIEWER";
  inviteUrl: string;
  expiresAt: Date;
}) {
  const connectionString = process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;
  const senderAddress = process.env.AZURE_EMAIL_SENDER;
  if (!connectionString || !senderAddress) return false;

  const expiry = input.expiresAt.toISOString();
  const text = `You were invited to ${input.workspaceName} in Nest as ${input.role}. Review the invitation: ${input.inviteUrl}. This one-time invitation expires ${expiry}.`;
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    recipients: { to: [{ address: input.to }] },
    content: {
      subject: `Invitation to ${input.workspaceName} in Nest`,
      plainText: text,
      html: `<p>You were invited to <strong>${escapeHtml(input.workspaceName)}</strong> in Nest as <strong>${input.role}</strong>.</p><p><a href="${escapeHtml(input.inviteUrl)}">Review invitation</a></p><p>This one-time invitation expires ${escapeHtml(expiry)}.</p>`,
    },
  });
  const response = await poller.pollUntilDone();
  if (response.status !== KnownEmailSendStatus.Succeeded) {
    throw new Error("Workspace invitation email delivery failed");
  }
  return true;
}
