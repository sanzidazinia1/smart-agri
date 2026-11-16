// Works out a plant's 0–100 health score from sensor readings and disease result

// Latest readings used for the score (missing ones get defaults)
export interface HealthInputs {
  moisture?: number | null;
  temperature?: number | null;
  humidity?: number | null;
  diseaseScore?: number | null; // 0–100, 100 == healthy
}

// The final score and the parts it was made from
export interface HealthScoreResult {
  healthScore: number;
  factors: {
    moisture: number;
    temperature: number;
    humidity: number;
    diseaseScore: number;
  };
}

// Keeps a number between min and max
function clamp(value: number, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

// Averages moisture, temperature, humidity and disease scores into one score
export function computeHealthScore(inputs: HealthInputs): HealthScoreResult {
  const moistureScore = clamp(Number(inputs.moisture ?? 0));
  const humidityScore = clamp(Number(inputs.humidity ?? 65));

  const temp = Number(inputs.temperature ?? 25);
  // Temperature: 20–30°C is best, 15–40°C is OK, otherwise poor
  let tempScore = 100;
  if (temp < 15 || temp > 40) tempScore = 50;
  else if (temp < 20 || temp > 30) tempScore = 80;

  const diseaseScore = clamp(Number(inputs.diseaseScore ?? 100));

  const finalScore =
    (moistureScore + tempScore + humidityScore + diseaseScore) / 4;

  return {
    healthScore: Number(finalScore.toFixed(2)),
    factors: {
      moisture: moistureScore,
      temperature: temp,
      humidity: humidityScore,
      diseaseScore,
    },
  };
}
