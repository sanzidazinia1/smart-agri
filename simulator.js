// Fake ESP32 for testing without hardware: sends readings, obeys pump commands.
// Run: npm run simulate (needs DEVICE_ID, DEVICE_KEY, POT_IDS in .env.development)

const { loadEnvConfig } = require("@next/env");
const path = require("node:path");

// Load .env.development the same way Next.js does (shell values win)
loadEnvConfig(path.resolve(__dirname), true); // development mode → .env.development

// Settings: server address, device ID/key and the pots it sends for
const BACKEND_URL = process.env.API_URL || process.env.BASE_URL || "http://localhost:3000";
const DEVICE_ID = process.env.DEVICE_ID;
const DEVICE_KEY = process.env.DEVICE_KEY;
const POT_IDS = (process.env.POT_IDS || "")
  .split(",")
  .map((potId) => potId.trim())
  .filter(Boolean);

// Stop with a clear message if settings are missing
if (!DEVICE_ID || !DEVICE_KEY || POT_IDS.length === 0) {
  throw new Error(
    "DEVICE_ID (registered hardwareId), DEVICE_KEY, and POT_IDS (comma-separated database Pot IDs) are required.",
  );
}

// Pretend moisture + pump state for each pot
const potStates = Object.fromEntries(
  POT_IDS.map((potId, index) => [potId, {
    moisture: [42, 55, 31][index % 3],
    pump: false,
  }]),
);
const highestSequence = Object.fromEntries(POT_IDS.map((potId) => [potId, 0])); // newest command no. per pot
const commandResults = new Map(); // results of commands already run (avoid repeats)
let lastServerCommunicationAt = Date.now();
// Safety: pumps switch off if the server is silent this long
const FAILSAFE_MS = Number(process.env.DEVICE_COMMUNICATION_LOSS_FAILSAFE_SECONDS || 60) * 1000;

// Pretend garden weather
let temperature = 28.5;
let humidity = 65;

// Print what the simulator is connected to
console.log("----------------------------------------------------");
console.log(`SmartAgri ESP32 Simulator started [Device hardwareId: ${DEVICE_ID}]`);
console.log(`Mapped Pots: ${POT_IDS.join(", ")}`);
console.log(`Posting to: ${BACKEND_URL}/api/iot/ingest`);
console.log(`Polling:    ${BACKEND_URL}/api/iot/commands`);
console.log("----------------------------------------------------");

// Sends one set of readings to the server
async function postIngest(payload) {
  const res = await fetch(`${BACKEND_URL}/api/iot/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-key": DEVICE_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

// Asks the server for waiting pump commands
async function fetchCommands() {
  const res = await fetch(`${BACKEND_URL}/api/iot/commands?deviceId=${encodeURIComponent(DEVICE_ID)}`, {
    headers: {
      "x-device-key": DEVICE_KEY,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return data.commands || [];
}

// Tells the server a command was received or carried out
async function acknowledgeCommand(commandId, kind, success = true, error) {
  const res = await fetch(`${BACKEND_URL}/api/iot/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-key": DEVICE_KEY,
    },
    body: JSON.stringify({
      deviceId: DEVICE_ID,
      commandId,
      kind,
      success,
      error,
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

// Gets commands and runs them (skips repeats and old ones)
async function processCommands() {
  try {
    const commands = await fetchCommands();
    lastServerCommunicationAt = Date.now();
    for (const command of commands) {
      await acknowledgeCommand(command.id, "delivery");
      const previous = commandResults.get(command.id);
      if (previous) {
        await acknowledgeCommand(command.id, "execution", previous.success, previous.error);
        continue;
      }
      const state = potStates[command.potId];
      if (!state) {
        const result = { success: false, error: `Unknown pot ${command.potId}` };
        commandResults.set(command.id, result);
        await acknowledgeCommand(command.id, "execution", result.success, result.error);
        console.warn(`[COMMAND FAILED] pot=${command.potId} command=${command.id}: unmapped pot`);
        continue;
      }

      // Ignore commands older than the newest one already run
      if (command.sequence <= highestSequence[command.potId]) {
        const result = { success: false, error: "Stale command sequence" };
        commandResults.set(command.id, result);
        await acknowledgeCommand(command.id, "execution", result.success, result.error);
        continue;
      }
      state.pump = command.command === "PUMP_ON";
      highestSequence[command.potId] = command.sequence;
      const applied = { success: true };
      commandResults.set(command.id, applied);
      const result = await acknowledgeCommand(command.id, "execution", true);
      console.log(
        `[COMMAND ACK] device=${DEVICE_ID} pot=${command.potId} relay=${state.pump ? "ON" : "OFF"} mode=${command.mode} result=${result.success}`,
      );
    }
  } catch (err) {
    console.warn(`Command polling failed (${BACKEND_URL})... ${err.message}`);
  }
}

// Changes the fake values a little: pump ON makes soil wetter
function tickEnvironment() {
  if (Date.now() - lastServerCommunicationAt > FAILSAFE_MS) {
    for (const state of Object.values(potStates)) state.pump = false;
  }
  temperature = Math.round((temperature + (Math.random() - 0.45) * 0.4) * 10) / 10;

  for (const state of Object.values(potStates)) {
    if (state.pump) {
      state.moisture = Math.min(85, state.moisture + 4);
    } else if (Math.random() > 0.35) {
      state.moisture = Math.max(15, state.moisture - 1);
    }
  }
}

// Updates fake values, then sends them to the server
async function sendTelemetry() {
  tickEnvironment();
  humidity = Math.round(Math.min(95, Math.max(20, humidity + (Math.random() - 0.5) * 1.5)) * 10) / 10;

  try {
    const response = await postIngest({
      // Same board ID field the real ESP32 uses
      hardwareId: DEVICE_ID,
      temperature,
      humidity,
      readings: Object.entries(potStates).map(([potId, state]) => ({
        potId,
        soil_moisture: state.moisture,
        pump: state.pump,
      })),
    });
    lastServerCommunicationAt = Date.now();

    const summary = Object.entries(potStates)
      .map(([potId, state]) => `${potId}: ${state.moisture}%`)
      .join(" | ");
    console.log(
      `[TELEMETRY SENT] device=${DEVICE_ID} temp=${temperature}C humidity=${humidity}% | ${summary} | saved=${response.saved}`,
    );
  } catch (err) {
    console.warn(`[TELEMETRY ERROR] device=${DEVICE_ID} backend=${BACKEND_URL}: ${err.message}`);
  }
}

// Send readings every 5 s, check commands every 2 s
setInterval(sendTelemetry, 5000);
setInterval(processCommands, 2000);
sendTelemetry();
processCommands();
