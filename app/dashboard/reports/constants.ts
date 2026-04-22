export const REPORT_TYPES = [
  { id: "athletic-screen", label: "Athletic Screen" },
  { id: "pro-sup", label: "Pro-Sup" },
  { id: "arm-action", label: "Arm Action" },
  { id: "curveball", label: "Curveball" },
] as const;

export type ReportTypeId = (typeof REPORT_TYPES)[number]["id"];

export type AthleteOption = { athlete_uuid: string; name: string };
