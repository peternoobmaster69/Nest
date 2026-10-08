import { prisma } from "../lib/prisma.ts";
import { isAdminEmail } from "../lib/admin-auth.ts";
import { upgradeLegacyAgentInstructions } from "../lib/ai/agent-prompt-upgrade.ts";

async function main() {
  if (process.argv.slice(2).some(arg => arg !== "--apply")) throw new Error("Use --apply to update untouched stock prompts; omit it to preview.");
  const email = process.env.ADMIN?.trim().toLowerCase();
  if (!email) throw new Error("Configure ADMIN before upgrading saved agent instructions.");
  const actor = await prisma.user.findFirst({ where: { email }, select: { id: true, email: true } });
  if (!actor || !isAdminEmail(actor.email)) throw new Error("The configured administrator must have a Nest user account.");
  const applied = process.argv.includes("--apply");
  const results = await upgradeLegacyAgentInstructions(actor.id, applied);
  console.log(JSON.stringify({ applied, results }, null, 2));
  if (results.some(result => result.status === "conflict")) process.exitCode = 1;
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Prompt upgrade failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
