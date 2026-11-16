// Optional per-board settings: copy to config.h (not in Git) to override main.ino.

// Soil probe calibration: raw reading in dry air, and in water
#define SOIL_RAW_DRY 3200
#define SOIL_RAW_WET 1200

// Relay level that turns the pump ON (many relay boards are active-LOW; test first)
#define RELAY_ON_LEVEL HIGH
#define RELAY_OFF_LEVEL LOW

// Reporting rate (defaults suit a free Vercel plan); faster for a local server:
// #define TELEMETRY_INTERVAL_MS 5000UL
// #define COMMAND_POLL_INTERVAL_MS 2000UL
// How quickly a moisture change is reported between regular reports:
// #define SAMPLE_INTERVAL_MS 2000UL
// #define REPORT_CHANGE_PERCENT 2
// #define MIN_REPORT_GAP_MS 3000UL

// Server address pre-filled on the setup page:
// #define DEFAULT_SERVER_URL "https://your-app.vercel.app"

// Pots this board serves at first (1-6); ports can also be added later in the app
// #define PORT_COUNT 3
// Different wiring? List the pins in port order (soil probes: ADC1 pins only):
// #define SOIL_PINS {36, 39, 34, 35, 32, 33}
// #define RELAY_PINS {5, 18, 19, 21, 22, 23}
