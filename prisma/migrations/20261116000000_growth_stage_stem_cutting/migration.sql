-- New growth stage for plants started from a stem cutting.
ALTER TYPE "GrowthStage" ADD VALUE IF NOT EXISTS 'stem_cutting' AFTER 'seedling';
