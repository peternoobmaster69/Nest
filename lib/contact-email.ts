import { EmailClient, KnownEmailSendStatus } from "@azure/communication-email";
import { CONTACT_TOPIC_LABELS, type ContactRequest } from "@/lib/domains/contact/contracts";

export class ContactDeliveryUnavailableError extends Error {}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

/** Strips CR/LF so user input can never inject extra email headers via the subject. */
function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Sends a landing-page contact message to the ADMIN address. Reply-To is the visitor,
 * so the admin can answer straight from their inbox.
 */
export async function sendContactEmail(input: ContactRequest & { receivedAt: Date; ipCountry?: string | null }) {
  const connectionString = process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;
  const senderAddress = process.env.AZURE_EMAIL_SENDER;
  const adminAddress = process.env.ADMIN?.trim();
  if (!connectionString || !senderAddress || !adminAddress) {
    throw new ContactDeliveryUnavailableError("Contact email is not configured");
  }

  const topic = CONTACT_TOPIC_LABELS[input.topic];
  const name = singleLine(input.name);
  const email = singleLine(input.email);
  const received = input.receivedAt.toISOString();
  const origin = input.ipCountry ? ` · ${input.ipCountry}` : "";

  const plainText = [
    `New message from the Nest contact form.`,
    ``,
    `From: ${name} <${email}>`,
    `Topic: ${topic}`,
    `Received: ${received}${origin}`,
    ``,
    input.message,
    ``,
    `Reply to this email to respond to ${name}.`,
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1c1916">
      <p style="margin:0 0 4px;color:#147349;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Nest contact form</p>
      <h2 style="margin:0 0 16px;font-size:20px">${escapeHtml(topic)}</h2>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:2px 12px 2px 0;color:#5c564e">From</td><td><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5c564e">Received</td><td>${escapeHtml(received)}${escapeHtml(origin)}</td></tr>
      </table>
      <div style="padding:14px 16px;border-radius:12px;background:#f5f2ed;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(input.message)}</div>
      <p style="margin:16px 0 0;color:#5c564e;font-size:12px">Reply to this email to respond to ${escapeHtml(name)}.</p>
    </div>`;

  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    recipients: { to: [{ address: adminAddress }] },
    replyTo: [{ address: email, displayName: name }],
    content: {
      subject: `[Nest contact] ${topic} from ${name}`.slice(0, 200),
      plainText,
      html,
    },
  });
  const response = await poller.pollUntilDone();
  if (response.status !== KnownEmailSendStatus.Succeeded) {
    throw new Error("Contact email delivery failed");
  }
}
