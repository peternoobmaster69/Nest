import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { deleteWorkspaceReward, rewardFailureResponse } from "@/lib/domains/rewards/api";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateHotelRewardSchema = z.object({
  programName: z.string().min(1),
  hotelBrand: z.string().min(1),
  accountNumber: z.string().optional(),
  currentPoints: z.number().int().min(0).default(0),
  targetPoints: z.number().int().min(1).optional().nullable(),
  centsPerPoint: z.number().min(0).default(0),
  notes: z.string().optional(),
});

const UpdateHotelRewardSchema = z.object({
  id: z.string(),
  programName: z.string().min(1).optional(),
  hotelBrand: z.string().min(1).optional(),
  accountNumber: z.string().optional(),
  currentPoints: z.number().int().min(0).optional(),
  targetPoints: z.number().int().min(1).optional().nullable(),
  centsPerPoint: z.number().min(0).optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");

    const body = await request.json();
    const parsed = CreateHotelRewardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: z.flattenError(parsed.error) }, { status: 400 });
    }

    const { programName, hotelBrand, accountNumber, currentPoints, targetPoints, centsPerPoint, notes } = parsed.data;

    const existing = await prisma.hotelRewardAccount.findFirst({
      where: { workspaceId, programName },
    });

    if (existing) {
      return NextResponse.json({ error: "Hotel rewards program with this name already exists" }, { status: 409 });
    }

    const account = await prisma.hotelRewardAccount.create({
      data: {
        workspaceId,
        programName,
        hotelBrand,
        accountNumber,
        currentPoints,
        targetPoints,
        centsPerPoint,
        notes,
      },
    });

    return NextResponse.json({ ...account, centsPerPoint: Number(account.centsPerPoint) }, { status: 201 });
  } catch (error) {
    return rewardFailureResponse(error, "Failed to create hotel rewards account");
  }
}

export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");

    const body = await request.json();
    const parsed = UpdateHotelRewardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: z.flattenError(parsed.error) }, { status: 400 });
    }

    const { id, ...data } = parsed.data;

    const existing = await prisma.hotelRewardAccount.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Hotel rewards account not found" }, { status: 404 });
    }

    const account = await prisma.hotelRewardAccount.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ...account, centsPerPoint: Number(account.centsPerPoint) });
  } catch (error) {
    return rewardFailureResponse(error, "Failed to update hotel rewards account");
  }
}

export async function DELETE(request: Request) {
  return deleteWorkspaceReward(request, prisma.hotelRewardAccount, "Hotel rewards account");
}
