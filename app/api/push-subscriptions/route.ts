import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPushConfiguration } from "@/lib/web-push";

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(1000), auth: z.string().min(1).max(1000) }),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = getPushConfiguration();
  const count = await prisma.pushSubscription.count({ where: { userId: session.user.id } });
  return NextResponse.json({ configured: config.configured, publicKey: config.publicKey, subscribed: count > 0 });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = SubscriptionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  if (!parsed.data.endpoint.startsWith("https://")) return NextResponse.json({ error: "Push endpoint must use HTTPS" }, { status: 400 });
  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      userId: session.user.id,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      expirationTime: parsed.data.expirationTime == null ? null : BigInt(parsed.data.expirationTime),
    },
    create: {
      userId: session.user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      expirationTime: parsed.data.expirationTime == null ? null : BigInt(parsed.data.expirationTime),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { endpoint } = await request.json().catch(() => ({}));
  if (typeof endpoint === "string" && endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { userId: session.user.id, endpoint } });
  } else {
    await prisma.pushSubscription.deleteMany({ where: { userId: session.user.id } });
  }
  return NextResponse.json({ ok: true });
}
