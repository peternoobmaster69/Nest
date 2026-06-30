export type SendEmailParams = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
};

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to send email.`);
  }
  return value;
}

export async function sendEmail({ to, subject, text, html }: SendEmailParams) {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const from = getRequiredEnv("EMAIL_FROM");
  const recipients = [...new Set(to.map((email) => email.trim().toLowerCase()).filter(Boolean))];

  if (recipients.length === 0) {
    throw new Error("At least one email recipient is required.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Email send failed (${response.status})${details ? `: ${details}` : ""}`);
  }

  return response.json().catch(() => null);
}
