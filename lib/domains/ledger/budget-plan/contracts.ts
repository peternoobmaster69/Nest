import { z } from "zod";

const WorkspaceActionSchema = z.object({ workspaceId: z.string().trim().min(1).max(191) });
const TemplateItemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(0).max(2_147_483_647),
  isMonthly: z.boolean().default(true),
  destinationSubAccountId: z.string().trim().min(1).max(191).nullable().optional(),
});
const TemplateSourceFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerId: z.string().trim().min(1, "Owner is required").max(191),
  amountCents: z.number().int().min(0).max(2_147_483_647),
});
const MonthlyItemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(0).max(2_147_483_647),
  destinationSubAccountId: z.string().trim().min(1).max(191).nullable().optional(),
});
const MonthlySourceFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerId: z.string().trim().min(1, "Owner is required").max(191),
  amountCents: z.number().int().min(0).max(2_147_483_647),
});

export const PeriodSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  month: z.number().int().min(1).max(12),
});
export const CreateTemplateItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("createTemplateItem"),
}).and(TemplateItemFieldsSchema);
export const CreateTemplateSourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("createTemplateSource"),
}).and(TemplateSourceFieldsSchema);
export const StartBlankSchema = WorkspaceActionSchema.extend({ action: z.literal("startBlank") }).and(PeriodSchema);
export const StartFromSetupSchema = WorkspaceActionSchema.extend({ action: z.literal("startFromSetup") }).and(PeriodSchema);
export const CreateMonthlyItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("createMonthlyItem"),
  planId: z.string().trim().min(1).max(191),
}).and(MonthlyItemFieldsSchema);
export const CreateMonthlySourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("createMonthlySource"),
  planId: z.string().trim().min(1).max(191),
}).and(MonthlySourceFieldsSchema);
export const DiscardMonthlyDraftSchema = WorkspaceActionSchema.extend({
  action: z.literal("discardMonthlyDraft"),
  planId: z.string().trim().min(1).max(191),
});
export const ConfirmMonthlySchema = WorkspaceActionSchema.extend({
  action: z.literal("confirmMonthly"),
  planId: z.string().trim().min(1).max(191),
  applyToSubAccounts: z.boolean().default(false),
});
export const UpdateTemplateItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateTemplateItem"),
  id: z.string().trim().min(1).max(191),
}).and(TemplateItemFieldsSchema);
export const UpdateTemplateSourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateTemplateSource"),
  id: z.string().trim().min(1).max(191),
}).and(TemplateSourceFieldsSchema);
export const UpdateMonthlyItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateMonthlyItem"),
  id: z.string().trim().min(1).max(191),
  planId: z.string().trim().min(1).max(191),
}).and(MonthlyItemFieldsSchema);
export const UpdateMonthlySourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateMonthlySource"),
  id: z.string().trim().min(1).max(191),
  planId: z.string().trim().min(1).max(191),
}).and(MonthlySourceFieldsSchema);
export const DeleteSchema = z.object({
  workspaceId: z.string().trim().min(1).max(191),
  id: z.string().trim().min(1).max(191),
  type: z.enum(["templateItem", "templateSource", "monthlyItem", "monthlySource"]),
});

export const BudgetPlanPostSchema = z.union([
  CreateTemplateItemSchema,
  CreateTemplateSourceSchema,
  StartBlankSchema,
  StartFromSetupSchema,
  CreateMonthlyItemSchema,
  CreateMonthlySourceSchema,
  DiscardMonthlyDraftSchema,
  ConfirmMonthlySchema,
]);
export const BudgetPlanPatchSchema = z.union([
  UpdateTemplateItemSchema,
  UpdateTemplateSourceSchema,
  UpdateMonthlyItemSchema,
  UpdateMonthlySourceSchema,
]);
