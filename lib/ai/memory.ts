import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const AskNestMemoryCandidateSchema = z.object({
  kind: z.enum(["PREFERENCE", "TERMINOLOGY", "INSTRUCTION"]),
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  content: z.string().trim().min(3).max(240),
}).strict();

export type AskNestMemoryCandidate = z.infer<typeof AskNestMemoryCandidateSchema>;

const EXPLICIT_MEMORY_PATTERN = /\b(?:remember|please remember|keep in mind|from now on|i prefer|my preference|(?:please )?call (?:it|them|this|that|my|the)\b|always show|use .+ by default)\b/i;
const UNSAFE_MEMORY_PATTERN = /\b(?:password|passcode|secret|api key|access token|refresh token|authentication|system prompt|developer message|ignore (?:all|previous)|bypass|jailbreak)\b/i;
const FINANCIAL_FACT_PATTERN = /(?:\b(?:SGD|USD|EUR|GBP|AUD|JPY)\s*-?[\d,]+|[$€£¥]\s*-?[\d,.]+|\b\d{7,}\b)/i;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getAskNestOwnerHash(workspaceId: string, userId: string) {
  return hash(`ask-nest-memory:${workspaceId}:${userId}`);
}

function normalizeTokens(value: string) {
  return new Set(
    value.toLocaleLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function acceptsExplicitMemory(question: string, candidate: AskNestMemoryCandidate) {
  if (!EXPLICIT_MEMORY_PATTERN.test(question)) return false;
  return isSafeAskNestMemoryContent(candidate.content);
}

export function isSafeAskNestMemoryContent(content: string) {
  if (UNSAFE_MEMORY_PATTERN.test(content)) return false;
  if (FINANCIAL_FACT_PATTERN.test(content)) return false;
  return true;
}

export async function saveAskNestMemories(params: {
  workspaceId: string;
  userId: string;
  sourceTurnId: string;
  question: string;
  candidates: AskNestMemoryCandidate[];
}) {
  const ownerHash = getAskNestOwnerHash(params.workspaceId, params.userId);
  const accepted = params.candidates.filter((candidate) => acceptsExplicitMemory(params.question, candidate));
  const saved: string[] = [];
  for (const candidate of accepted) {
    const keyHash = hash(candidate.key);
    await prisma.askNestMemory.upsert({
      where: { ownerHash_keyHash: { ownerHash, keyHash } },
      create: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        ownerHash,
        keyHash,
        kind: candidate.kind,
        key: candidate.key,
        content: candidate.content,
        sourceTurnId: params.sourceTurnId,
        confidence: 1,
        status: "ACTIVE",
        lastConfirmedAt: new Date(),
      },
      update: {
        kind: candidate.kind,
        content: candidate.content,
        sourceTurnId: params.sourceTurnId,
        confidence: 1,
        status: "ACTIVE",
        lastConfirmedAt: new Date(),
        expiresAt: null,
      },
    });
    saved.push(candidate.content);
  }
  return saved;
}

export async function loadRelevantAskNestMemories(params: {
  workspaceId: string;
  userId: string;
  question: string;
}) {
  const ownerHash = getAskNestOwnerHash(params.workspaceId, params.userId);
  const rows = await prisma.askNestMemory.findMany({
    where: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      ownerHash,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, kind: true, key: true, content: true, updatedAt: true },
  });
  const questionTokens = normalizeTokens(params.question);
  return rows
    .map((memory, index) => {
      const memoryTokens = normalizeTokens(`${memory.key} ${memory.content}`);
      const overlap = [...memoryTokens].filter((token) => questionTokens.has(token)).length;
      const baseline = memory.kind === "TERMINOLOGY" || memory.kind === "INSTRUCTION" ? 3 : 1;
      return { ...memory, score: overlap * 10 + baseline - index * 0.01 };
    })
    .filter((memory) => memory.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function loadRelevantAskNestTopics(params: {
  workspaceId: string;
  userId: string;
  question: string;
}) {
  const rows = await prisma.askNestTurn.findMany({
    where: { workspaceId: params.workspaceId, userId: params.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, question: true, pagePath: true, createdAt: true },
  });
  const questionTokens = normalizeTokens(params.question);
  return rows
    .map((turn, index) => {
      const overlap = [...normalizeTokens(turn.question)].filter((token) => questionTokens.has(token)).length;
      return { ...turn, score: overlap * 10 + Math.max(0, 2 - index * 0.1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
