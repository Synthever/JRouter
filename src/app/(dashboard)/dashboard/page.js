import { getMachineId } from "@/shared/utils/machine";
import DashboardOverviewClient from "./DashboardOverviewClient";

export default async function DashboardPage() {
  const machineId = await getMachineId();
  return <DashboardOverviewClient machineId={machineId} />;
}
