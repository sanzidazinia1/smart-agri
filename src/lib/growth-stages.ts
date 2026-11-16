// Growth stages a plant can be in (same as the GrowthStage enum in Prisma)

// All growth stages, used by forms, API checks and labels
export const GROWTH_STAGES = [
  "seedling",
  "stem_cutting",
  "vegetative",
  "flowering",
  "fruiting",
  "mature",
  "harvested",
] as const;

// One growth stage value, e.g. "seedling"
export type GrowthStageValue = (typeof GROWTH_STAGES)[number];

// Stages offered for a new plant ("harvested" only makes sense later)
export const NEW_PLANT_STAGES = GROWTH_STAGES.filter((stage) => stage !== "harvested") as Exclude<
  GrowthStageValue,
  "harvested"
>[];

// Readable name for each stage
const LABELS: Record<GrowthStageValue, string> = {
  seedling: "Seedling",
  stem_cutting: "Stem cutting",
  vegetative: "Vegetative",
  flowering: "Flowering",
  fruiting: "Fruiting",
  mature: "Mature",
  harvested: "Harvested",
};

// Readable name for a stage, e.g. "stem_cutting" -> "Stem cutting"
export function growthStageLabel(stage: string) {
  return LABELS[stage as GrowthStageValue] ?? stage.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
