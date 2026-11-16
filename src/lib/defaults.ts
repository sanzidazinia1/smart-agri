// Default values used when a plant or pot has no settings of its own

// Default watering state (pump off, start below 30% moisture)
export const defaultIrrigation = {
  status: "off" as const,
  manualOverride: false,
  threshold: 30,
};

// Default comfort ranges for moisture, temperature and humidity
export const defaultThreshold = {
  soilMoistureMin: 30,
  soilMoistureMax: 70,
  tempDayMin: 18,
  tempDayMax: 32,
  humidityMin: 40,
  humidityMax: 80,
};
