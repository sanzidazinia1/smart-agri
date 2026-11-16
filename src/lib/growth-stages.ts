// Growth stages a plant can be in (matches the GrowthStage enum in prisma/schema.prisma).
// One list for the forms, the API validation and the labels shown in the app.

export const GROWTH_STAGES = [
  "seedling",
  "stem_cutting",
  "vegetative",
  "flowering",
  "fruiting",
  "mature",
  "harvested",
] as const;

export type GrowthStageValue = (typeof GROWTH_STAGES)[number];

/** Stages offered when adding a new plant ("harvested" only makes sense later). */
export const NEW_PLANT_STAGES = GROWTH_STAGES.filter((stage) => stage !== "harvested") as Exclude<
  GrowthStageValue,
  "harvested"
>[];

const LABELS: Record<GrowthStageValue, string> = {
  seedling: "Seedling",
  stem_cutting: "Stem cutting",
  vegetative: "Vegetative",
  flowering: "Flowering",
  fruiting: "Fruiting",
  mature: "Mature",
  harvested: "Harvested",
};

export function growthStageLabel(stage: string) {
  return LABELS[stage as GrowthStageValue] ?? stage.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
