export const DEMO_HIVE_ID = "demo-hive";

export type DemoHive = {
  id: string;
  name: string;
  description: string;
};

export const DEMO_HIVES: DemoHive[] = [
  {
    id: DEMO_HIVE_ID,
    name: "Preview hive",
    description: "Local preview only — not saved to an account.",
  },
];

export function isKnownDemoHiveId(hiveId: string): boolean {
  return DEMO_HIVES.some((hive) => hive.id === hiveId);
}
