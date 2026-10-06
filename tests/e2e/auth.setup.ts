import { test as setup } from "@playwright/test";
import { prisma } from "../../lib/prisma";
import { authenticateBrowserContext } from "./session";

setup("create isolated browser session", async ({ context, baseURL }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "owner@nest.local" } });
  let secondary = await prisma.workspace.findFirst({ where: { name: "E2E Secondary" } });
  secondary ??= await prisma.workspace.create({
    data: { name: "E2E Secondary", baseCurrency: "SGD" },
  });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: secondary.id, userId: user.id } },
    create: { workspaceId: secondary.id, userId: user.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  await authenticateBrowserContext(context, baseURL);
  await context.storageState({ path: ".auth/user.json" });
});
