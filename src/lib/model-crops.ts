// Crops the local disease model knows, and other names people use for them

// Each model crop and the words that mean it (e.g. "alu" = potato)
export const MODEL_CROPS: Record<string, string[]> = {
  apple: ["apple"],
  blueberry: ["blueberry"],
  cherry: ["cherry"],
  corn: ["corn", "maize", "bhutta"],
  grape: ["grape"],
  orange: ["orange", "lemon", "lime", "citrus", "malta", "lebu"],
  peach: ["peach"],
  pepper: ["pepper", "capsicum", "chili", "chilli", "morich"],
  potato: ["potato", "alu"],
  raspberry: ["raspberry"],
  soybean: ["soybean", "soya"],
  squash: ["squash", "pumpkin", "kumra", "gourd"],
  strawberry: ["strawberry"],
  tomato: ["tomato"],
};

// Which model crop a plant is (e.g. "tomato"), or null if the model doesn't know it
export function modelCropFor(plantName: string | null | undefined) {
  const name = (plantName ?? "").toLowerCase();
  if (!name) return null;
  return Object.entries(MODEL_CROPS).find(([, words]) => words.some((word) => name.includes(word)))?.[0] ?? null;
}
