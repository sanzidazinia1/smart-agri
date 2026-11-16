// Builds the text of pump, disease and device notifications
import type { DeviceCommandType, PotIrrigationMode } from "@prisma/client";

// Formats a date as an ISO time string
function timestamp(value: Date) {
  return value.toISOString();
}

// Readable name for a watering mode
function modeLabel(mode: PotIrrigationMode) {
  return mode === "AUTO" ? "Automatic" : "Manual";
}

// Message when the board confirms the pump started or stopped
export function formatPumpAcknowledgementNotification(input: {
  gardenName: string;
  potLabel: string;
  command: DeviceCommandType;
  mode: PotIrrigationMode;
  occurredAt: Date;
  decisionMoisture?: number | null;
}) {
  const action = input.command === "PUMP_ON" ? "started" : "stopped";
  const moisture =
    typeof input.decisionMoisture === "number" && Number.isFinite(input.decisionMoisture)
      ? ` Soil moisture at the automatic decision: ${input.decisionMoisture}%.`
      : "";

  return `Pump ${action}: ${input.gardenName} / ${input.potLabel}. ${modeLabel(input.mode)} mode. Confirmed by device at ${timestamp(input.occurredAt)}.${moisture}`;
}

// Message when the board failed to start or stop the pump
export function formatPumpFailureNotification(input: {
  gardenName: string;
  potLabel: string;
  command: DeviceCommandType;
  occurredAt: Date;
  error?: string | null;
}) {
  const action = input.command === "PUMP_ON" ? "start" : "stop";
  const detail = input.error ? ` Detail: ${input.error}.` : "";
  return `Pump command failed: device reported failure to ${action} the pump for ${input.gardenName} / ${input.potLabel} at ${timestamp(input.occurredAt)}.${detail}`;
}

// Message when a leaf disease scan finishes
export function formatDiseaseAnalysisNotification(input: {
  gardenName: string;
  potLabel: string;
  predictedDisease: string;
  confidence: number;
  occurredAt: Date;
}) {
  const confidence = Number.isFinite(input.confidence) && input.confidence >= 0 && input.confidence <= 1
    ? ` Prediction: ${input.predictedDisease} (${Math.round(input.confidence * 100)}% confidence).`
    : "";
  return `Plant disease analysis completed: ${input.gardenName} / ${input.potLabel}.${confidence} Completed at ${timestamp(input.occurredAt)}.`;
}

// Message when a board stops sending data
export function formatDeviceOfflineNotification(input: {
  deviceName: string;
  gardenName: string;
  lastSeenAt: Date;
  thresholdSeconds: number;
}) {
  return `Device telemetry appears offline: ${input.gardenName} / ${input.deviceName}. Last successful backend receipt was ${timestamp(input.lastSeenAt)} (offline threshold: ${input.thresholdSeconds}s).`;
}

// Message when a board comes back online
export function formatDeviceRecoveredNotification(input: {
  deviceName: string;
  gardenName: string;
  receivedAt: Date;
}) {
  return `Device telemetry recovered: ${input.gardenName} / ${input.deviceName} sent a valid reading received at ${timestamp(input.receivedAt)}.`;
}

