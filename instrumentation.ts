import { assertProductionConfig } from "@/lib/production-config";

export async function register() {
  assertProductionConfig();
}
