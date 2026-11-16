// Decides if a pot's pump should turn on or off, based on soil moisture

import type { IrrigationStatus, PotIrrigationMode } from "@prisma/client";

// A pot's watering settings and current pump state
export interface PotIrrigationConfigInput {
  irrigationMode: PotIrrigationMode;
  moistureOnThreshold: number;
  moistureOffThreshold: number;
  pumpState: IrrigationStatus;
}

// The pump decision and why it was made
export interface PotIrrigationDecision {
  pumpState: IrrigationStatus;
  changed: boolean;
  reason: PotIrrigationReason;
  message: string;
  mode: PotIrrigationMode;
}

// Possible reasons for a pump decision
export type PotIrrigationReason =
  | "MANUAL_MODE"
  | "SOIL_MOISTURE_UNAVAILABLE"
  | "SOIL_DRY"
  | "SOIL_MOISTURE_NORMAL";

// True if thresholds are 0–100 and "on" is below "off"
export function validatePotIrrigationThresholds(
  moistureOnThreshold: number,
  moistureOffThreshold: number,
) {
  return (
    Number.isFinite(moistureOnThreshold) &&
    Number.isFinite(moistureOffThreshold) &&
    moistureOnThreshold >= 0 &&
    moistureOffThreshold <= 100 &&
    moistureOnThreshold < moistureOffThreshold
  );
}

// Pump on when soil is dry, off when wet enough, else unchanged (auto mode only)
export function decidePotIrrigation(params: {
  moisture: number | undefined;
  config: PotIrrigationConfigInput;
}): PotIrrigationDecision {
  const { moisture, config } = params;

  if (
    !validatePotIrrigationThresholds(
      config.moistureOnThreshold,
      config.moistureOffThreshold,
    )
  ) {
    throw new Error("moistureOnThreshold must be less than moistureOffThreshold");
  }

  // Manual mode: the user controls the pump, so keep it as is
  if (config.irrigationMode === "MANUAL") {
    return {
      pumpState: config.pumpState,
      changed: false,
      reason: "MANUAL_MODE",
      message: "Manual mode uses the configured pump state.",
      mode: "MANUAL",
    };
  }

  // No reading: don't change the pump
  if (moisture === undefined) {
    return {
      pumpState: config.pumpState,
      changed: false,
      reason: "SOIL_MOISTURE_UNAVAILABLE",
      message: "No soil moisture reading is available, so the pump state is unchanged.",
      mode: "AUTO",
    };
  }

  // Between the two thresholds the pump stays as it is (avoids flicking on/off)
  let nextPumpState = config.pumpState;
  let reason: PotIrrigationReason = "SOIL_MOISTURE_NORMAL";
  let message = `Soil moisture is within the configured hysteresis band (${config.moistureOnThreshold}%-${config.moistureOffThreshold}%); the pump state is unchanged.`;
  if (moisture <= config.moistureOnThreshold) {
    nextPumpState = "on";
    reason = "SOIL_DRY";
    message = `Soil moisture ${moisture}% is at or below the ON threshold ${config.moistureOnThreshold}%.`;
  } else if (moisture >= config.moistureOffThreshold) {
    nextPumpState = "off";
    reason = "SOIL_MOISTURE_NORMAL";
    message = `Soil moisture ${moisture}% is at or above the OFF threshold ${config.moistureOffThreshold}%.`;
  }

  return {
    pumpState: nextPumpState,
    changed: config.pumpState !== nextPumpState,
    reason,
    message,
    mode: "AUTO",
  };
}
