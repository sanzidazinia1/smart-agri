// ESP32 firmware: reads soil probes, sends readings, and runs pumps on command.

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFiManager.h>
#include <esp_mac.h>
#include <esp_sleep.h>
#include <driver/gpio.h>
// Load this board's own settings and HTTPS certificates if config.h exists
#if __has_include("config.h")
#include "config.h"
#include "root_ca.h"
#endif

// ---- Hardware / calibration defaults (config.h can override) ----
#ifndef SOIL_RAW_DRY
#define SOIL_RAW_DRY 3200  // analogRead() with the probe in dry air/soil
#endif
#ifndef SOIL_RAW_WET
#define SOIL_RAW_WET 1200  // analogRead() with the probe in water
#endif
#ifndef RELAY_ON_LEVEL
#define RELAY_ON_LEVEL HIGH  // pin level that switches the pump ON
#endif
#ifndef RELAY_OFF_LEVEL
#define RELAY_OFF_LEVEL LOW  // pin level that switches the pump OFF
#endif
#ifndef DEFAULT_SERVER_URL
#define DEFAULT_SERVER_URL ""  // e.g. "https://your-app.vercel.app" — pre-fills the setup page
#endif
#ifndef HTTP_TIMEOUT_MS
#define HTTP_TIMEOUT_MS 10000  // HTTPS handshakes to a hosted server take longer
#endif
// Regular report interval; kept modest to stay inside the free Vercel plan
#ifndef TELEMETRY_INTERVAL_MS
#define TELEMETRY_INTERVAL_MS 20000UL
#endif
// Probes are checked this often between regular reports
#ifndef SAMPLE_INTERVAL_MS
#define SAMPLE_INTERVAL_MS 2000UL
#endif
// A moisture change this big (in %) is reported straight away
#ifndef REPORT_CHANGE_PERCENT
#define REPORT_CHANGE_PERCENT 2
#endif
// Shortest gap allowed between two early reports
#ifndef MIN_REPORT_GAP_MS
#define MIN_REPORT_GAP_MS 3000UL
#endif
// How often the board asks the server for pump commands
#ifndef COMMAND_POLL_INTERVAL_MS
#define COMMAND_POLL_INTERVAL_MS 10000UL
#endif
// Safety: pumps switch off if the server is silent this long
#ifndef COMMUNICATION_LOSS_FAILSAFE_MS
#define COMMUNICATION_LOSS_FAILSAFE_MS 60000UL
#endif

// Firmware version sent to the server, and the setup Wi-Fi name
#define FIRMWARE_VERSION "smartagri-2.11"
#define SETUP_AP_NAME "SmartAgri-Setup"

// ---- Ports: one soil probe + one pump relay per pot (max 6, ADC1 pins only) ----
#ifndef PORT_COUNT
#define PORT_COUNT 1
#endif
#ifndef SOIL_PINS
#define SOIL_PINS {36, 39, 34, 35, 32, 33}
#endif
#ifndef RELAY_PINS
#define RELAY_PINS {5, 18, 19, 21, 22, 23}
#endif
const int MAX_PORTS = 6;
static_assert(PORT_COUNT >= 1 && PORT_COUNT <= MAX_PORTS, "PORT_COUNT must be 1-6");
const int SOIL_PIN_LIST[MAX_PORTS] = SOIL_PINS;
const int RELAY_PIN_LIST[MAX_PORTS] = RELAY_PINS;
const int SETUP_BUTTON_PIN = 0;    // the board's BOOT button
const int LED_PIN = 2;     // on-board LED: blinks while waiting to be claimed

// ---- Pairing timings ----
const unsigned long PAIR_INTERVAL_MS = 2000;
const unsigned long CONFIRM_POLL_INTERVAL_MS = 1000;
// How long a BOOT press still counts as "yes, add me"
const unsigned long PRESS_LATCH_MS = 15000;
const unsigned long SETUP_HOLD_MS = 3000;  // hold BOOT this long to reopen setup

Preferences config;        // "cfg": server URL and device key
Preferences commandStore;  // "pumpcmd": de-duplication of pump commands

// ---- Board state kept in memory ----
String hardwareId;
String serverUrl;
String deviceKey;
String pairSecret;
String pairCode;

bool pumpOn[MAX_PORTS] = {false};  // index = port - 1
int portCount = PORT_COUNT;  // ports in use; the app can change this
// Last reported % per port (-1 = no probe reading)
int reportedPercent[MAX_PORTS] = {-2, -2, -2, -2, -2, -2};
int probeStreak[MAX_PORTS] = {0};  // good probe readings in a row, per port
bool reportNow = false;  // something changed: send a report right away
unsigned long lastSampleAt = 0;
unsigned long lastTelemetryAt = 0;
unsigned long lastCommandPollAt = 0;
unsigned long lastPairAt = 0;
unsigned long lastCodePrintAt = 0;
unsigned long lastServerCommunicationAt = 0;
unsigned long bootPressedAt = 0;
unsigned long confirmUntil = 0;  // the app is waiting for a BOOT press
unsigned long pressLatchedUntil = 0;
bool bootWasDown = false;

// ---- Identity and pairing ----

// Builds a unique board ID from the chip's MAC, e.g. ESP32-D299AC
String makeHardwareId() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char id[16];
  snprintf(id, sizeof(id), "ESP32-%02X%02X%02X", mac[3], mac[4], mac[5]);
  return String(id);
}

// Shows the pairing code as "123 456"
String formattedCode() {
  return pairCode.substring(0, 3) + " " + pairCode.substring(3);
}

// Makes a new pairing secret + code and saves them so restarts keep them
void newPairingIdentity() {
  char secret[33];
  for (int i = 0; i < 16; i++) sprintf(secret + i * 2, "%02x", (uint8_t)(esp_random() & 0xFF));
  pairSecret = String(secret);
  char code[7];
  sprintf(code, "%06lu", (unsigned long)(esp_random() % 1000000UL));
  pairCode = String(code);
  config.putString("pairSecret", pairSecret);
  config.putString("pairCode", pairCode);
}

// Loads the saved pairing secret + code, or makes new ones
void loadPairingIdentity() {
  pairSecret = config.getString("pairSecret", "");
  pairCode = config.getString("pairCode", "");
  if (pairSecret.length() != 32 || pairCode.length() != 6) newPairingIdentity();
}

// Prints pairing instructions to the Serial Monitor
void printPairingHelp() {
  Serial.println();
  Serial.println("==============================================");
  Serial.printf(" Waiting to be claimed as %s\n", hardwareId.c_str());
  Serial.printf(" Pairing code: %s\n", formattedCode().c_str());
  Serial.println(" In SmartAgri: Devices -> Add device, then press BOOT");
  Serial.println("==============================================");
}

// Drops a rejected device key and starts pairing again
void forgetKey(const char *reason) {
  Serial.printf("Device key rejected (%s) - pairing again.\n", reason);
  deviceKey = "";
  config.remove("deviceKey");
  newPairingIdentity();
  confirmUntil = 0;
  printPairingHelp();
}

// ---- Wi-Fi + server address setup page ----

// Cleans up and saves the server address typed on the setup page
void saveServerUrl(String value) {
  value.trim();
  if (!value.length()) return;
  if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
  while (value.endsWith("/")) value.remove(value.length() - 1);
  serverUrl = value;
  config.putString("server", serverUrl);
}

// Styling for the board's setup page, to match the SmartAgri app.
static const char PORTAL_STYLE[] PROGMEM =
  "<meta name='theme-color' content='#0b1220'><style>"
  "body{background:#0b1220;color:#e2e8f0;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;margin:0}"
  ".wrap{max-width:440px;padding:14px 16px 24px;text-align:left}"
  "h1{color:#34d399;font-size:1.4em;margin:.2em 0}h3{color:#94a3b8;font-weight:500;margin:0 0 .8em}br{display:none}"
  // Network list: compact rows with CSS signal bars
  "div:has(>a[data-ssid]){display:flex;align-items:center;justify-content:space-between;background:#111827;"
  "border:1px solid #1f2937;border-top:0;padding:0 14px;margin:0}"
  "div:has(>a[data-ssid]):first-of-type{border-top:1px solid #1f2937;border-radius:12px 12px 0 0}"
  "div:has(>a[data-ssid]):last-of-type{border-radius:0 0 12px 12px}"
  "a[data-ssid]{flex:1;color:#f1f5f9;text-decoration:none;font-weight:600;padding:12px 0}"
  ".q{float:none;min-width:0;padding:0;width:17px;height:13px;margin-left:8px;--a:#334155;--b:#334155;--c:#334155;--d:#334155;"
  "background:linear-gradient(var(--a),var(--a)) 0 100%/3px 4px no-repeat,linear-gradient(var(--b),var(--b)) 4.5px 100%/3px 7px no-repeat,"
  "linear-gradient(var(--c),var(--c)) 9px 100%/3px 10px no-repeat,linear-gradient(var(--d),var(--d)) 13.5px 100%/3px 13px no-repeat!important}"
  ".q:after,.q:before{display:none!important}"
  ".q-1{--a:#34d399}.q-2{--a:#34d399;--b:#34d399}.q-3{--a:#34d399;--b:#34d399;--c:#34d399}"
  ".q-4{--a:#34d399;--b:#34d399;--c:#34d399;--d:#34d399}"
  // Form
  "form{margin-top:14px}label{display:block;color:#94a3b8;font-weight:600;font-size:13px;margin:10px 0 4px}"
  "label[for=s]{font-size:0}label[for=s]:after{content:'Wi-Fi name';font-size:13px}"
  "label[for=showpass]{display:inline;margin:0 0 0 6px;font-weight:500}#showpass{width:auto;margin:6px 0 0}"
  "input{width:100%;box-sizing:border-box;background:#0f172a;color:#f8fafc;border:1px solid #334155;border-radius:10px;"
  "padding:12px;font-size:16px;margin:0}input:focus{outline:2px solid #10b981;border-color:#10b981}"
  "button,.btn{display:block;width:100%;box-sizing:border-box;background:#059669;color:#fff;border:0;border-radius:12px;"
  "font-size:16px;font-weight:700;padding:13px;margin:14px 0 0;text-align:center;text-decoration:none}"
  "button:active,.btn:active{background:#047857}"
  "form[action*=refresh] button{background:none;color:#34d399;font-size:14px;font-weight:600;padding:8px;margin:4px 0 0}"
  ".wrap:has(a[data-ssid]):before{content:'Choose your Wi-Fi';display:block;color:#f1f5f9;font-weight:700;font-size:18px;margin:2px 0 10px}"
  ".next{display:block;margin-top:4px}"
  ".tip{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px 12px;margin:14px 0 0;font-size:13px;color:#94a3b8;line-height:1.5}"
  ".code{color:#34d399;font-weight:800;font-size:18px;letter-spacing:2px;white-space:nowrap}"
  "details{margin:12px 0 0}summary{color:#94a3b8;font-size:13px;cursor:pointer}.msg{border-radius:12px}"
  "</style>";

// Connects to Wi-Fi, or opens the setup page when needed or forced
void runWiFiSetup(bool forcePortal) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);  // 5 minutes, then restart and try again
  wm.setConnectTimeout(20);
  wm.setTitle("SmartAgri");
  wm.setCustomHeadElement(PORTAL_STYLE);
  // Only what's needed: set up Wi-Fi (no Info / Update / Erase buttons).
  std::vector<const char *> menu = {"wifi", "exit"};
  wm.setMenu(menu);
  wm.setShowInfoUpdate(false);
  wm.setShowInfoErase(false);
  wm.setMinimumSignalQuality(20);  // hide networks too weak to use
  wm.setRemoveDuplicateAPs(true);

  if (!serverUrl.length() && strlen(DEFAULT_SERVER_URL)) serverUrl = DEFAULT_SERVER_URL;

  // Extra HTML on the setup page: pairing code, or "already added"
  String info;
  if (!deviceKey.length()) {
    info += "<div class='tip'>Pairing code <span class='code'>" + formattedCode() + "</span>"
            "<span class='next'>After <b>Save</b>: SmartAgri → <b>Sensors → Add device</b>, then press <b>BOOT</b> on the board.</span>"
            "<a class='btn' id='sa' href='#' style='display:none'>Open SmartAgri</a></div>"
            // Button that opens the app's Add device guide for this board
            "<script>function sa(){var s=document.getElementById('server');var a=document.getElementById('sa');"
            "if(!s||!a)return;var v=s.value.trim().replace(/\\/+$/,'');if(v&&v.indexOf('http')!==0)v='http://'+v;"
            "a.href=v+'/sensors?claim=" + hardwareId + "&code=" + pairCode + "';a.style.display=v?'block':'none';}"
            "document.addEventListener('input',sa);window.addEventListener('load',sa);setTimeout(sa,300);</script>";
  } else {
    info += "<div class='tip'>Sensor " + hardwareId + " is already in your SmartAgri account.</div>";
  }
  // Fills in the server address from the app's QR link (?server=...)
  info += "<script>(function(){var q=new URLSearchParams(location.search).get('server');if(!q)return;"
          "function f(){var s=document.getElementById('server');if(s){s.value=q;if(window.sa)sa();}}"
          "document.addEventListener('DOMContentLoaded',f);setTimeout(f,200);})();</script>";
  // Server address box: folded away unless it's still empty
  String advancedOpen = serverUrl.length() ? "<details>" : "<details open>";
  advancedOpen += "<summary>Server address</summary>";
  WiFiManagerParameter infoParam(info.c_str());
  WiFiManagerParameter advancedStart(advancedOpen.c_str());
  WiFiManagerParameter serverParam("server", "SmartAgri address", serverUrl.c_str(), 100, "placeholder='https://your-app.vercel.app' autocomplete='off'");
  WiFiManagerParameter advancedEnd("</details>");
  wm.addParameter(&infoParam);
  wm.addParameter(&advancedStart);
  wm.addParameter(&serverParam);
  wm.addParameter(&advancedEnd);

  // Open the setup page, or just join the saved Wi-Fi
  bool needPortal = forcePortal || !serverUrl.length();
  Serial.println(needPortal ? "Opening Wi-Fi setup: connect to \"" SETUP_AP_NAME "\" from your phone."
                            : "Connecting to saved Wi-Fi...");
  bool connected = needPortal ? wm.startConfigPortal(SETUP_AP_NAME) : wm.autoConnect(SETUP_AP_NAME);
  saveServerUrl(String(serverParam.getValue()));

  if (!connected) {
    Serial.println("Wi-Fi setup timed out - restarting.");
    delay(1000);
    ESP.restart();
  }
  Serial.printf("Wi-Fi connected (%s). Server: %s\n", WiFi.localIP().toString().c_str(), serverUrl.c_str());
  syncClock();
}

// Gets the real time from the internet (needed for HTTPS certificate checks)
void syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  const unsigned long startedAt = millis();
  while (time(nullptr) < 1700000000 && millis() - startedAt < 10000) delay(200);
  Serial.println(time(nullptr) >= 1700000000 ? "Clock synced." : "Clock not synced yet - HTTPS may fail until it is.");
}

// ---- HTTP helpers ----

// Sends one GET/POST to the server; returns the HTTP status code (-1 = offline)
int request(const char *method, const String &path, const String &body, String *response, bool authenticated) {
  if (!serverUrl.length() || WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  // https is checked against root_ca.h; plain http is for a local server
  static WiFiClientSecure secureClient;
  static WiFiClient plainClient;
  if (serverUrl.startsWith("https://")) {
    secureClient.setCACert(ROOT_CA_BUNDLE);
    http.begin(secureClient, serverUrl + path);
  } else {
    http.begin(plainClient, serverUrl + path);
  }
  if (body.length()) http.addHeader("Content-Type", "application/json");
  if (authenticated) http.addHeader("x-device-key", deviceKey);
  int code = String(method) == "GET" ? http.GET() : http.POST(body);
  if (response && code > 0) *response = http.getString();
  http.end();
  if (code >= 200 && code < 300) lastServerCommunicationAt = millis();
  return code;
}

// ---- Pump ----

// Turns the pump on/off for one port
void setPump(int port, bool on) {
  if (port < 1 || port > portCount) return;
  digitalWrite(RELAY_PIN_LIST[port - 1], on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
  if (pumpOn[port - 1] != on) reportNow = true;
  pumpOn[port - 1] = on;
  Serial.printf("Port %d pump %s\n", port, on ? "ON" : "OFF");
}

// Switches every pump off (safety)
void allPumpsOff() {
  for (int port = 1; port <= portCount; port++) {
    digitalWrite(RELAY_PIN_LIST[port - 1], RELAY_OFF_LEVEL);
    pumpOn[port - 1] = false;
  }
}

// True if at least one pump is running
bool anyPumpOn() {
  for (int i = 0; i < portCount; i++) if (pumpOn[i]) return true;
  return false;
}

// Finds a command we already ran (last 8 kept), or -1
int savedCommandSlot(const char *commandId) {
  for (int slot = 0; slot < 8; slot++) {
    if (commandStore.getString((String("id") + slot).c_str()) == commandId) return slot;
  }
  return -1;
}

// Remembers a command's result so a repeat isn't run twice
void saveCommandResult(const char *commandId, bool success) {
  int slot = commandStore.getUInt("nextSlot", 0) % 8;
  commandStore.putString((String("id") + slot).c_str(), commandId);
  commandStore.putBool((String("ok") + slot).c_str(), success);
  commandStore.putUInt("nextSlot", (slot + 1) % 8);
}

// Tells the server a command was received or carried out
void acknowledgeCommand(const char *commandId, const char *kind, bool success = true, const char *error = nullptr) {
  JsonDocument body;
  body["hardwareId"] = hardwareId;
  body["commandId"] = commandId;
  body["kind"] = kind;
  body["success"] = success;
  if (error != nullptr) body["error"] = error;
  String payload;
  serializeJson(body, payload);
  int code = request("POST", "/api/iot/commands", payload, nullptr, true);
  if (code == 401) forgetKey("command acknowledgement");
  else if (code < 200 || code >= 300) Serial.printf("Command acknowledgement failed: %d\n", code);
}

// ---- Remote actions from the app (restart, reset Wi-Fi, sleep, factory reset) ----

// Tells the server we got the action; true if it heard us
bool confirmAction(const char *action) {
  JsonDocument body;
  body["hardwareId"] = hardwareId;
  body["action"] = action;
  body["kind"] = "action";
  String payload;
  serializeJson(body, payload);
  int code = request("POST", "/api/iot/commands", payload, nullptr, true);
  if (code < 200 || code >= 300) Serial.printf("Action confirmation failed: %d\n", code);
  return code >= 200 && code < 300;
}

// Carries out a remote action after switching all pumps off
void runAction(const String &action) {
  if (!confirmAction(action.c_str())) return;  // retried on the next poll
  allPumpsOff();
  digitalWrite(LED_PIN, LOW);
  Serial.printf("Remote action: %s\n", action.c_str());
  delay(300);

  if (action == "RESTART") {
    ESP.restart();
  } else if (action == "RESET_WIFI") {
    // Keeps the device key: after choosing a new Wi-Fi it's still in your account.
    WiFiManager wm;
    wm.resetSettings();
    ESP.restart();
  } else if (action == "FACTORY_RESET") {
    WiFiManager wm;
    wm.resetSettings();
    config.clear();
    commandStore.clear();
    ESP.restart();
  } else if (action == "SLEEP") {
    // "Turn off": deep sleep with every relay held OFF. Press BOOT (or EN) to wake.
    for (int i = 0; i < portCount; i++) {
      digitalWrite(RELAY_PIN_LIST[i], RELAY_OFF_LEVEL);
      gpio_hold_en((gpio_num_t)RELAY_PIN_LIST[i]);
    }
    gpio_deep_sleep_hold_en();
    WiFi.disconnect(true);
    esp_sleep_enable_ext0_wakeup((gpio_num_t)SETUP_BUTTON_PIN, 0);
    Serial.println("Sleeping - press BOOT or EN to wake.");
    Serial.flush();
    esp_deep_sleep_start();
  }
}

// Changes the number of ports (1-6) as chosen in the app; pumps start OFF
void setPortCount(int n) {
  if (n < 1 || n > MAX_PORTS || n == portCount) return;
  for (int i = n; i < portCount; i++) {
    digitalWrite(RELAY_PIN_LIST[i], RELAY_OFF_LEVEL);
    pumpOn[i] = false;
  }
  for (int i = portCount; i < n; i++) {
    digitalWrite(RELAY_PIN_LIST[i], RELAY_OFF_LEVEL);
    pinMode(RELAY_PIN_LIST[i], OUTPUT);
    reportedPercent[i] = -2;
    probeStreak[i] = 0;
  }
  Serial.printf("Ports: %d -> %d (set in the app)\n", portCount, n);
  portCount = n;
  config.putInt("ports", n);
  reportNow = true;
}

// Asks the server for new commands and runs them
void processPendingCommands() {
  String response;
  int code = request("GET", "/api/iot/commands?deviceId=" + hardwareId, "", &response, true);
  if (code == 401) return forgetKey("command poll");
  if (code != 200) {
    Serial.printf("Command poll failed: %d\n", code);
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, response)) {
    Serial.println("Invalid command response");
    return;
  }

  setPortCount(doc["ports"] | portCount);

  const char *action = doc["action"] | "";
  if (action[0]) {
    runAction(String(action));
    return;
  }

  for (JsonObject command : doc["commands"].as<JsonArray>()) {
    const char *commandId = command["id"] | "";
    const char *type = command["command"] | "";
    const char *potId = command["potId"] | "";
    int port = command["port"] | 1;
    long sequence = command["sequence"] | 0;
    if (!commandId[0]) continue;
    acknowledgeCommand(commandId, "delivery");
    if (!deviceKey.length()) return;  // key was rejected mid-way

    // Already ran this command: just report the old result again
    int previousSlot = savedCommandSlot(commandId);
    if (previousSlot >= 0) {
      bool priorSuccess = commandStore.getBool((String("ok") + previousSlot).c_str(), false);
      acknowledgeCommand(commandId, "execution", priorSuccess, priorSuccess ? nullptr : "Previously rejected command");
      continue;
    }

    // Command numbers count per pot; a new pot on this port restarts the count
    String seqPotKey = String("seqPot") + port, seqKey = String("hiSeq") + port;
    if (commandStore.getString(seqPotKey.c_str(), "") != potId) {
      commandStore.putString(seqPotKey.c_str(), potId);
      commandStore.putLong(seqKey.c_str(), 0);
    }

    // Safety checks: reject bad ports and old (out-of-order) commands
    if (port < 1 || port > portCount) {
      saveCommandResult(commandId, false);
      acknowledgeCommand(commandId, "execution", false, "This board has no such port");
    } else if (sequence <= commandStore.getLong(seqKey.c_str(), 0)) {
      saveCommandResult(commandId, false);
      acknowledgeCommand(commandId, "execution", false, "Stale command sequence");
    } else if (String(type) == "PUMP_ON" || String(type) == "PUMP_OFF") {
      // Continuous: the server sends PUMP_OFF when watering should stop.
      setPump(port, String(type) == "PUMP_ON");
      commandStore.putLong(seqKey.c_str(), sequence);
      saveCommandResult(commandId, true);
      acknowledgeCommand(commandId, "execution", true);
    } else {
      saveCommandResult(commandId, false);
      acknowledgeCommand(commandId, "execution", false, "Unsupported command");
    }
  }
}

// ---- Telemetry (soil readings) ----

// Reads the probe 15 times and returns the middle value (ignores spikes)
int readSoilRaw(int pin, int *spread = nullptr) {
  const int n = 15;
  int samples[n];
  for (int i = 0; i < n; i++) {
    samples[i] = analogRead(pin);
    delay(4);
  }
  // Sort the samples (insertion sort) to find the middle one
  for (int i = 1; i < n; i++) {
    int v = samples[i], j = i - 1;
    while (j >= 0 && samples[j] > v) { samples[j + 1] = samples[j]; j--; }
    samples[j + 1] = v;
  }
  if (spread) *spread = samples[n - 3] - samples[2];  // ignore the 2 lowest / highest
  return samples[n / 2];
}

// Allowed slack around the wet/dry calibration values
#ifndef PROBE_RAW_MARGIN
#define PROBE_RAW_MARGIN 500
#endif
// True if a raw value looks like real soil (not a loose or missing wire)
bool soilRawLooksValid(int raw) {
  const int wetEnd = min(SOIL_RAW_WET, SOIL_RAW_DRY) - PROBE_RAW_MARGIN;
  const int dryEnd = max(SOIL_RAW_WET, SOIL_RAW_DRY) + PROBE_RAW_MARGIN;
  return raw > 50 && raw < 4080 && raw >= wetEnd && raw <= dryEnd;
}

// Converts a raw probe value to moisture 0-100%
int moisturePercent(int raw) {
  int percentage = map(raw, SOIL_RAW_DRY, SOIL_RAW_WET, 0, 100);
  return constrain(percentage, 0, 100);
}

// Max jumpiness of a real probe's readings (empty pins drift around)
#ifndef PROBE_NOISE_LIMIT
#define PROBE_NOISE_LIMIT 250  // raw ADC units between the middle samples
#endif
const int PROBE_STREAK_NEEDED = 3;  // good readings in a row before it counts

// True if a real probe seems connected (steady, sensible readings)
bool probeAttached(int pin, int raw, int spread) {
  if (!soilRawLooksValid(raw) || spread > PROBE_NOISE_LIMIT) return false;
  // GPIO 32/33: an empty pin collapses when the pull-down is switched on
  if (pin == 32 || pin == 33) {
    pinMode(pin, INPUT_PULLDOWN);
    delay(2);
    int pulled = analogRead(pin);
    pinMode(pin, INPUT);
    delay(2);
    if (pulled < 100 && raw > 300) return false;  // collapsed: nothing driving it
  }
  return true;
}

// Moisture % for a port, or -1 until the probe reads well 3 times in a row
int readProbe(int port, int *rawOut = nullptr) {
  int pin = SOIL_PIN_LIST[port - 1], spread = 0;
  int raw = readSoilRaw(pin, &spread);
  if (rawOut) *rawOut = raw;
  if (probeAttached(pin, raw, spread)) {
    if (probeStreak[port - 1] < PROBE_STREAK_NEEDED) probeStreak[port - 1]++;
  } else {
    probeStreak[port - 1] = 0;
  }
  return probeStreak[port - 1] >= PROBE_STREAK_NEEDED ? moisturePercent(raw) : -1;
}

// True if any probe changed enough (or started/stopped) since the last report
bool probesChanged() {
  bool changed = false;
  for (int port = 1; port <= portCount; port++) {
    int now = readProbe(port);
    int last = reportedPercent[port - 1];
    if ((now < 0) != (last < 0)) changed = true;
    if (now >= 0 && last >= 0 && abs(now - last) >= REPORT_CHANGE_PERCENT) changed = true;
  }
  return changed;
}

// Sends one reading per port; a faulty probe sends only its pump state
void sendTelemetry() {
  JsonDocument doc;
  doc["hardwareId"] = hardwareId;
  doc["ports"] = portCount;
  doc["firmware"] = FIRMWARE_VERSION;
  JsonArray readings = doc["readings"].to<JsonArray>();
  int raws[MAX_PORTS], percents[MAX_PORTS];
  for (int port = 1; port <= portCount; port++) {
    int percent = readProbe(port, &raws[port - 1]);
    percents[port - 1] = percent;
    JsonObject reading = readings.add<JsonObject>();
    reading["port"] = port;
    if (percent >= 0) reading["soil_moisture"] = percent;
    reading["pump"] = pumpOn[port - 1];
    reportedPercent[port - 1] = percent;
  }
  String body;
  serializeJson(doc, body);

  String response;
  int code = request("POST", "/api/iot/ingest", body, &response, true);
  if (code == 401) return forgetKey("telemetry");
  // Print the result to the Serial Monitor
  if (code >= 200 && code < 300) {
    for (int port = 1; port <= portCount; port++) {
      int raw = raws[port - 1];
      if (percents[port - 1] >= 0) Serial.printf("Port %d: moisture=%d%% (raw %d) pump=%s\n", port, percents[port - 1], raw, pumpOn[port - 1] ? "ON" : "OFF");
      else Serial.printf("Port %d: no probe reading (raw %d) - nothing wired, or check the AO/VCC/GND wires.\n", port, raw);
    }
    if (response.indexOf("unconnectedPorts") >= 0) Serial.println("Some ports aren't connected to a pot yet - connect them in the app (Sensors).");
  } else if (code == 400 && response.indexOf("potId") >= 0) {
    Serial.println("Not connected to a pot yet - choose one for this device in the app.");
  } else {
    Serial.printf("Telemetry failed: %d %s\n", code, response.c_str());
  }
}

// ---- Pairing loop ----

// Asks the server if someone is adding this board; saves the key once claimed
void pairStep() {
  JsonDocument doc;
  doc["hardwareId"] = hardwareId;
  doc["secret"] = pairSecret;
  doc["pairingCode"] = pairCode;
  doc["firmware"] = FIRMWARE_VERSION;
  if (millis() < pressLatchedUntil) doc["confirm"] = true;
  String body;
  serializeJson(doc, body);

  String response;
  int code = request("POST", "/api/iot/pair", body, &response, false);
  if (code != 200) {
    Serial.printf("Pairing: server not reachable at %s (%d). Hold BOOT 3 s to change it.\n", serverUrl.c_str(), code);
    return;
  }
  JsonDocument reply;
  if (deserializeJson(reply, response)) return;
  String status = String((const char *)(reply["status"] | ""));
  // The app is waiting for a BOOT press
  if (status == "confirm") {
    if (!confirmUntil) Serial.println(">>> Someone is adding this board in the app: press BOOT to confirm.");
    confirmUntil = millis() + (unsigned long)(reply["msLeft"] | 30000);
    if (millis() < pressLatchedUntil) lastPairAt = 0;  // already pressed: confirm right away
    return;
  }
  confirmUntil = 0;
  if (reply["error"].is<const char *>()) Serial.printf("Pairing: %s\n", (const char *)reply["error"]);
  // Added to an account: save the device key and start normal work
  if (status == "claimed") {
    deviceKey = String((const char *)(reply["deviceKey"] | ""));
    if (deviceKey.length()) {
      config.putString("deviceKey", deviceKey);
      config.remove("pairSecret");
      config.remove("pairCode");
      pressLatchedUntil = 0;
      digitalWrite(LED_PIN, LOW);
      Serial.println("Claimed! Device key saved - starting normal operation.");
      lastTelemetryAt = 0;
      lastCommandPollAt = 0;
    }
  }
}

// ---- Button, Wi-Fi watchdog, setup and main loop ----

// True once the BOOT button has been held down for ms milliseconds
bool bootHeldFor(unsigned long ms) {
  if (digitalRead(SETUP_BUTTON_PIN) == LOW) {
    if (!bootPressedAt) bootPressedAt = millis();
    return millis() - bootPressedAt >= ms;
  }
  bootPressedAt = 0;
  return false;
}

// Wi-Fi lost: retry every 15 s, restart the board (pumps off) after 3 min
const unsigned long WIFI_RETRY_MS = 15000;
const unsigned long WIFI_RESTART_AFTER_MS = 180000;
unsigned long wifiLostAt = 0;
unsigned long lastWifiTryAt = 0;

// Keeps the Wi-Fi connected (called on every loop)
void keepWiFi(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiLostAt) Serial.printf("Wi-Fi back after %lu s\n", (now - wifiLostAt) / 1000);
    wifiLostAt = 0;
    return;
  }
  if (!wifiLostAt) {
    wifiLostAt = now;
    lastWifiTryAt = 0;
    Serial.println("Wi-Fi lost - reconnecting...");
  }
  if (lastWifiTryAt == 0 || now - lastWifiTryAt >= WIFI_RETRY_MS) {
    lastWifiTryAt = now;
    WiFi.disconnect();
    WiFi.begin();  // the saved network and password
  }
  if (now - wifiLostAt >= WIFI_RESTART_AFTER_MS) {
    Serial.println("Wi-Fi down for 3 minutes - restarting the board");
    allPumpsOff();
    delay(200);
    ESP.restart();
  }
}

// Runs once at power-on: pumps off, load settings, join Wi-Fi
void setup() {
  gpio_deep_sleep_hold_dis();  // after sleep: release relay pins held OFF
  // Load the saved port count so only those relay pins are driven
  config.begin("cfg", false);
  portCount = config.isKey("ports") ? constrain(config.getInt("ports", PORT_COUNT), 1, MAX_PORTS) : PORT_COUNT;
  // Set OFF before enabling each pin so the pump never twitches on boot
  for (int i = 0; i < portCount; i++) {
    gpio_hold_dis((gpio_num_t)RELAY_PIN_LIST[i]);
    digitalWrite(RELAY_PIN_LIST[i], RELAY_OFF_LEVEL);
    pinMode(RELAY_PIN_LIST[i], OUTPUT);
  }
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  delay(200);
  allPumpsOff();

  WiFi.mode(WIFI_STA);
  hardwareId = makeHardwareId();
  commandStore.begin("pumpcmd", false);
  serverUrl = config.getString("server", "");
  deviceKey = config.getString("deviceKey", "");
  if (!deviceKey.length()) loadPairingIdentity();

  Serial.printf("\nSmartAgri node %s (%s), %d port%s\n", hardwareId.c_str(), FIRMWARE_VERSION, portCount, portCount == 1 ? "" : "s");
  runWiFiSetup(false);
  lastServerCommunicationAt = millis();
  if (!deviceKey.length()) printPairingHelp();
}

// Runs over and over: buttons, Wi-Fi, safety, pairing, readings, commands
void loop() {
  const unsigned long now = millis();

  const bool confirming = !deviceKey.length() && confirmUntil && now < confirmUntil;

  // While unclaimed, a BOOT press means "yes, add me" (remembered for a while)
  bool bootDown = digitalRead(SETUP_BUTTON_PIN) == LOW;
  if (!deviceKey.length() && bootDown && !bootWasDown) {
    pressLatchedUntil = now + PRESS_LATCH_MS;
    lastPairAt = 0;  // tell the server right away
    Serial.println("BOOT pressed - confirming...");
  }
  bootWasDown = bootDown;

  // Hold BOOT for 3 s: reopen the Wi-Fi / server setup page.
  if (!confirming && bootHeldFor(SETUP_HOLD_MS)) {
    bootPressedAt = 0;
    allPumpsOff();
    runWiFiSetup(true);
  }
  keepWiFi(now);

  // Safety: never leave a pump running without hearing from the server.
  if (anyPumpOn() && now - lastServerCommunicationAt >= COMMUNICATION_LOSS_FAILSAFE_MS) {
    allPumpsOff();
    Serial.println("Communication-loss fail-safe switched all pumps OFF");
  }

  // Not added to an account yet: blink and keep trying to pair
  if (!deviceKey.length()) {
    // Slow blink: waiting to be added. Fast blink: press BOOT to confirm.
    digitalWrite(LED_PIN, (now / (confirming ? 100 : 500)) % 2);
    if (lastPairAt == 0 || now - lastPairAt >= (confirming ? CONFIRM_POLL_INTERVAL_MS : PAIR_INTERVAL_MS)) {
      lastPairAt = now;
      pairStep();
    }
    if (!deviceKey.length() && now - lastCodePrintAt >= 30000) {
      lastCodePrintAt = now;
      printPairingHelp();
    }
    return;
  }

  // Quick check of the probes between regular reports.
  if (!reportNow && now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    reportNow = probesChanged();
  }
  // Send a report when it's time, or early if something changed
  const bool due = now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS;
  const bool early = reportNow && now - lastTelemetryAt >= MIN_REPORT_GAP_MS;
  if (due || early) {
    lastTelemetryAt = now;
    reportNow = false;
    sendTelemetry();
  }
  // Check for pump commands from the app
  if (deviceKey.length() && now - lastCommandPollAt >= COMMAND_POLL_INTERVAL_MS) {
    lastCommandPollAt = now;
    processPendingCommands();
  }
}
