import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateFrequentFlyerSchema = z.object({
  programName: z.string().min(1),
  airlineName: z.string().min(1),
  accountNumber: z.string().optional(),
  currentMiles: z.number().int().min(0).default(0),
  targetMiles: z.number().int().min(0).optional(),
  expiryWarning: z.number().int().min(1).max(24).default(6),
  mileNeverExpire: z.boolean().default(false),
  validityPeriodYears: z.number().int().min(1).default(3),
  notes: z.string().optional(),
});

const UpdateFrequentFlyerSchema = z.object({
  id: z.string(),
  programName: z.string().min(1).optional(),
  airlineName: z.string().min(1).optional(),
  accountNumber: z.string().optional(),
  currentMiles: z.number().int().min(0).optional(),
  targetMiles: z.number().int().min(0).optional().nullable(),
  expiryWarning: z.number().int().min(1).max(24).optional(),
  mileNeverExpire: z.boolean().optional(),
  validityPeriodYears: z.number().int().min(1).optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();

    const body = await request.json();
    const parsed = CreateFrequentFlyerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const {
      programName,
      airlineName,
      accountNumber,
      currentMiles,
      targetMiles,
      expiryWarning,
      mileNeverExpire,
      validityPeriodYears,
      notes,
    } = parsed.data;

    const existing = await prisma.frequentFlyerAccount.findFirst({
      where: { workspaceId, programName },
    });

    if (existing) {
      return NextResponse.json({ error: "Program with this name already exists" }, { status: 409 });
    }

    const account = await prisma.frequentFlyerAccount.create({
      data: {
        workspaceId,
        programName,
        airlineName,
        accountNumber,
        currentMiles,
        targetMiles,
        expiryWarning,
        mileNeverExpire,
        validityPeriodYears,
        notes,
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to create frequent flyer account" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();

    const body = await request.json();
    const parsed = UpdateFrequentFlyerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const { id, ...data } = parsed.data;

    const existing = await prisma.frequentFlyerAccount.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Frequent flyer account not found" }, { status: 404 });
    }

    const account = await prisma.frequentFlyerAccount.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to update frequent flyer account" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const existing = await prisma.frequentFlyerAccount.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Frequent flyer account not found" }, { status: 404 });
    }

    await prisma.frequentFlyerAccount.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to delete frequent flyer account" }, { status: 500 });
  }
}
