import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";

// JRouter has one administrator dashboard, rather than per-user key owners.
// Gateway bearer credentials never authorize dashboard settings operations.
export async function canManageApiKeys(request) {
  const cliToken = request.headers.get("x-9r-cli-token");
  if (cliToken && cliToken === await getConsistentMachineId("9r-cli-auth")) return true;
  const token = request.cookies?.get("auth_token")?.value || (request.headers.get("cookie") || "").split(";").map((v) => v.trim()).find((v) => v.startsWith("auth_token="))?.slice(11);
  if (token && await verifyDashboardAuthToken(token)) return true;
  const settings = await getSettings();
  return settings.requireLogin === false;
}
