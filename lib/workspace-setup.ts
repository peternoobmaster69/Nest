export type WorkspaceSetupProgress = {
  bankAccountCount: number;
  subAccountCount: number;
  creditCardCount: number;
};

export type WorkspaceSetupStep = "welcome" | "bank" | "subaccount" | "card" | "complete";
export type WorkspaceSetupPreference = "loading" | "unseen" | "started" | "complete";

export function getRequiredWorkspaceSetupStep(
  progress: WorkspaceSetupProgress,
): "bank" | "subaccount" | null {
  if (progress.bankAccountCount === 0) return "bank";
  if (progress.subAccountCount === 0) return "subaccount";
  return null;
}

export function getWorkspaceSetupStep(
  progress: WorkspaceSetupProgress,
  preference: WorkspaceSetupPreference,
): WorkspaceSetupStep {
  if (preference === "loading") return "complete";
  const requiredStep = getRequiredWorkspaceSetupStep(progress);
  if (requiredStep && preference === "unseen") return "welcome";
  if (requiredStep) return requiredStep;
  if (preference === "started" && progress.creditCardCount === 0) return "card";
  return "complete";
}

export function countCompletedWorkspaceSetupSteps(progress: WorkspaceSetupProgress) {
  return Number(progress.bankAccountCount > 0)
    + Number(progress.subAccountCount > 0)
    + Number(progress.creditCardCount > 0);
}
