"use client";

// Dashboard page: one garden at a glance — alerts, pots, weather and activity.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowRight,
  CircleCheck,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Cpu,
  Droplets,
  Flower2,
  Gauge,
  Microscope,
  Plus,
  Snowflake,
  Sun,
  TriangleAlert,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui";
import { GardenPicker } from "@/components/GardenPicker";
import { deviceStatus, timeAgo } from "@/components/device-ui";
import { getSelectedGardenId, setSelectedGardenId } from "@/lib/selected-garden";

// A garden in the garden picker.
interface Garden {
  id: string;
  name: string;
  location: string | null;
  type: string;
}

// A pot with its plant, sensors and recent moisture readings.
interface Pot {
  id: string;
  label: string;
  pumpState: string;
  irrigationMode: string;
  moistureOnThreshold: number;
  moistureOffThreshold: number;
  plant: { commonName: string; healthStatus: string } | null;
  currentMoisture: number | null;
  moistureRecordedAt: string | null;
  moistureHistory: { value: number; recordedAt: string }[];
  sensors: { id: string; name: string; status: string }[];
}

// Everything the dashboard API returns for one garden.
interface DashboardData {
  garden: { id: string; name: string; location: string | null; type: string };
  weather: {
    current: { temp: number; description: string; humidity: number; rainProb: number; windSpeed: number };
    forecast: { day: string; high: number; low: number; description: string; rainProb: number }[];
    isStale: boolean;
    fetchedAt: string;
  } | null;
  weatherUnavailable: boolean;
  devices: { id: string; name: string; status: string; lastSeenAt: string | null }[];
  pots: Pot[];
  pumpHistory: { id: string; potId: string | null; mode: string; status: string; reason: string | null; startedAt: string }[];
  diseaseHistory: { id: string; potId: string; predictedDisease: string; className: string | null; confidence: number; createdAt: string }[];
  alerts: { id: string; severity: string; title: string; message: string }[];
}

// Sensors send every 5 s; no reading for 60 s means "not live".
const PROBE_SILENT_MS = 60_000;

// The dashboard page: greeting, garden picker and the garden overview.
export default function DashboardPage() {
  // Load the user's gardens and profile (for the greeting name).
  const { data: gardens } = useSWR<Garden[]>("/api/gardens");
  const { data: profile } = useSWR<{ userName: string | null }>("/api/profile");
  // Use the picked garden, else the saved one, else the first garden.
  const [chosen, setChosen] = useState<string | null>(null);
  const saved = getSelectedGardenId();
  const gardenId =
    chosen ?? (gardens?.some((garden) => garden.id === saved) ? saved! : gardens?.[0]?.id ?? null);

  const firstName = profile?.userName?.trim().split(/\s+/)[0];

  if (!gardens) return <DashboardSkeleton />;

  // No gardens yet: show a "create your first garden" card.
  if (!gardenId) {
    return (
      <div className="mx-auto max-w-7xl">
        <Greeting name={firstName} />
        <Card className="mt-6 flex flex-col items-center py-14 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
            <Flower2 size={26} />
          </span>
          <h2 className="mt-4 text-lg font-black">Let&apos;s set up your first garden</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Create a garden, add a pot with its plant, then connect a device to see live moisture here.
          </p>
          <Link href="/gardens" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
            <Plus size={16} />
            Create a garden
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Greeting name={firstName} />
        <GardenPicker
          gardens={gardens}
          value={gardenId}
          label=""
          className="w-full sm:w-72"
          onChange={(id) => {
            setChosen(id);
            setSelectedGardenId(id);
          }}
        />
      </div>
      <GardenOverview key={gardenId} gardenId={gardenId} />
    </div>
  );
}

// "Good morning, Name" heading.
function Greeting({ name }: { name?: string }) {
  // Re-check every minute so the greeting changes if the page stays open.
  const hour = new Date(useNow(60_000)).getHours();
  const part = greetingFor(hour);
  return (
    <div>
      <h1 className="text-2xl font-black" suppressHydrationWarning>
        {part}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Here&apos;s how your garden is doing right now.</p>
    </div>
  );
}

// Picks the greeting from the hour (morning, afternoon, evening, night).
function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

// Gives the current time and updates it every few seconds.
function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// The main dashboard content for one garden.
function GardenOverview({ gardenId }: { gardenId: string }) {
  // Load the garden's dashboard data every 3 seconds.
  const { data, error } = useSWR<DashboardData>(`/api/gardens/${gardenId}/dashboard`, { refreshInterval: 3000 });
  const now = useNow();

  if (error) return <Card className="py-10 text-center text-sm text-rose-600">Couldn&apos;t load this garden. It will retry automatically.</Card>;
  if (!data) return <DashboardSkeleton bare />;

  // A pot's moisture, but only if the reading is recent (live).
  const live = (pot: Pot) =>
    pot.sensors.length > 0 && pot.moistureRecordedAt && now - new Date(pot.moistureRecordedAt).getTime() <= PROBE_SILENT_MS
      ? pot.currentMoisture
      : null;
  // Numbers for the summary cards.
  const liveValues = data.pots.map(live).filter((value): value is number => value != null);
  const average = liveValues.length ? Math.round(liveValues.reduce((sum, value) => sum + value, 0) / liveValues.length) : null;
  const dry = data.pots.filter((pot) => {
    const value = live(pot);
    return value != null && value < pot.moistureOnThreshold;
  }).length;
  const online = data.devices.filter((device) => device.status === "ONLINE").length;
  const pumpsOn = data.pots.filter((pot) => pot.pumpState === "on").length;
  // Finds a pot's name from its id (for the activity list).
  const potLabel = (potId: string | null) => data.pots.find((pot) => pot.id === potId)?.label ?? "Garden";

  return (
    <div className="space-y-6">
      <HealthBanner alerts={data.alerts} gardenId={gardenId} gardenName={data.garden.name} />

      {/* Summary number cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Gauge} label="Average soil moisture" value={average == null ? "--" : `${average}%`} hint={liveValues.length ? `${liveValues.length} live device${liveValues.length > 1 ? "s" : ""}` : "No live readings"} />
        <Kpi icon={Droplets} label="Pots needing water" value={String(dry)} hint={`of ${data.pots.length} ${data.pots.length === 1 ? "pot" : "pots"}`} tone={dry ? "amber" : undefined} />
        <Kpi icon={Cpu} label="Devices online" value={`${online}`} hint={`of ${data.devices.length} ${data.devices.length === 1 ? "device" : "devices"}`} tone={data.devices.length && online < data.devices.length ? "rose" : undefined} />
        <Kpi icon={Droplets} label="Pumps running" value={`${pumpsOn}`} hint={pumpsOn ? "Watering now" : "All idle"} tone={pumpsOn ? "sky" : undefined} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        {/* Pot tiles */}
        <section className="min-w-0 xl:col-span-2">
          <SectionHeader title="Pots" action={<Link href={`/gardens/${gardenId}?tab=pots`} className="text-sm font-semibold text-emerald-600 hover:underline dark:text-emerald-400">Manage pots →</Link>} />
          {data.pots.length === 0 ? (
            <Card className="py-10 text-center">
              <p className="font-semibold">No pots in this garden yet</p>
              <Link href={`/gardens/${gardenId}?tab=pots`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                <Plus size={15} />
                Add pot & plant
              </Link>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.pots.map((pot) => (
                <PotTile key={pot.id} pot={pot} value={live(pot)} gardenId={gardenId} />
              ))}
            </div>
          )}
        </section>

        {/* Weather and quick actions */}
        <aside className="min-w-0 space-y-6">
          <WeatherCard data={data} />
          <QuickActions gardenId={gardenId} />
        </aside>
      </div>

      {/* Recent watering and disease checks */}
      <section>
        <SectionHeader title="Recent activity" action={<Link href={`/gardens/${gardenId}?tab=activity`} className="text-sm font-semibold text-emerald-600 hover:underline dark:text-emerald-400">See all →</Link>} />
        <Card>
          <ActivityList data={data} potLabel={potLabel} />
        </Card>
      </section>
    </div>
  );
}

// Green "all good" bar, or a list of alerts that need attention.
function HealthBanner({ alerts, gardenId, gardenName }: { alerts: DashboardData["alerts"]; gardenId: string; gardenName: string }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
        <CircleCheck size={20} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">All good in {gardenName} — nothing needs your attention.</p>
      </div>
    );
  }
  const severe = alerts.some((alert) => alert.severity === "critical" || alert.severity === "high");
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        severe
          ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold">
          <TriangleAlert size={18} className="shrink-0" />
          {alerts.length === 1 ? "1 thing needs your attention" : `${alerts.length} things need your attention`}
        </p>
        <Link href={`/gardens/${gardenId}?tab=activity`} className="shrink-0 text-xs font-semibold underline">
          Review
        </Link>
      </div>
      <ul className="mt-1.5 space-y-0.5 pl-7 text-sm">
        {alerts.slice(0, 3).map((alert) => (
          <li key={alert.id}>
            <span className="font-semibold">{alert.title}</span>
            <span className="opacity-80"> — {alert.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Icon colours for the summary cards.
const KPI_TONE: Record<string, string> = {
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
  default: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
};

// One summary card: label, big number and a small hint.
function Kpi({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${KPI_TONE[tone ?? "default"]}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-2 text-3xl font-black leading-none">{value}</p>
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

// Section title with an optional link on the right.
function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-black">{title}</h2>
      {action}
    </div>
  );
}

// One pot tile: moisture, status, trend line, device and pump.
function PotTile({ pot, value, gardenId }: { pot: Pot; value: number | null; gardenId: string }) {
  const low = pot.moistureOnThreshold;
  const high = Math.max(pot.moistureOffThreshold, low);
  const noSensor = pot.sensors.length === 0;
  // Status text and colour from the moisture vs. the target range.
  const state =
    noSensor
      ? { text: "No device", tone: "text-slate-400", stroke: "#94a3b8" }
      : value == null
        ? { text: "Probe not reading", tone: "text-rose-600 dark:text-rose-400", stroke: "#94a3b8" }
        : value < low
          ? { text: "Too dry", tone: "text-amber-600 dark:text-amber-400", stroke: "#f59e0b" }
          : value > high
            ? { text: "Very wet", tone: "text-sky-600 dark:text-sky-400", stroke: "#0ea5e9" }
            : { text: "Just right", tone: "text-emerald-600 dark:text-emerald-400", stroke: "#10b981" };
  const sensor = pot.sensors[0];

  return (
    <Link
      href={`/gardens/${gardenId}?tab=pots&pot=${pot.id}`}
      className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold">{pot.label}</p>
          <p className="truncate text-xs capitalize text-slate-500 dark:text-slate-400">{pot.plant?.commonName ?? "No plant"}</p>
        </div>
        <span className={`shrink-0 text-xs font-bold ${state.tone}`}>{state.text}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-4xl font-black leading-none">
          {value == null ? <span className="text-slate-300 dark:text-slate-600">--</span> : value}
          {value == null ? null : <span className="ml-0.5 text-lg font-bold text-slate-400">%</span>}
        </p>
        {noSensor ? (
          <span className="text-right text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Connect a device →</span>
        ) : (
          <Sparkline points={pot.moistureHistory.map((point) => point.value)} low={low} high={high} stroke={state.stroke} />
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        Target {low}–{high}%{pot.moistureRecordedAt && !noSensor ? ` · ${timeAgo(pot.moistureRecordedAt)}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[11px] dark:border-slate-800">
        <span className="inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300">
          <span className={`h-1.5 w-1.5 rounded-full ${sensor ? deviceStatus(sensor.status).dot : "bg-slate-300 dark:bg-slate-600"}`} />
          {sensor ? sensor.name : "No device"}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
            pot.pumpState === "on" ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          <Droplets size={11} />
          Pump {pot.pumpState}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {pot.irrigationMode === "AUTO" ? "Auto" : "Manual"}
        </span>
        <ArrowRight size={14} className="ml-auto text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500 dark:text-slate-600" />
      </div>
    </Link>
  );
}

// Small moisture trend line with the target range shaded.
function Sparkline({ points, low, high, stroke }: { points: number[]; low: number; high: number; stroke: string }) {
  const width = 120;
  const height = 40;
  if (points.length < 2) {
    return <span className="text-[10px] text-slate-400">Not enough data</span>;
  }
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - (Math.min(100, Math.max(0, v)) / 100) * height;
  const path = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0 overflow-visible">
      <rect x="0" y={y(high)} width={width} height={Math.max(1, y(low) - y(high))} className="fill-emerald-500/10" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2.5" fill={stroke} />
    </svg>
  );
}

// Which icon to show for each weather description.
const WEATHER_ICON: Record<string, LucideIcon> = {
  Clear: Sun,
  "Partly cloudy": CloudSun,
  Foggy: CloudFog,
  Drizzle: CloudDrizzle,
  Rain: CloudRain,
  Snow: Snowflake,
  Thunderstorm: CloudLightning,
};

// Current weather and a 3-day forecast for the garden's location.
function WeatherCard({ data }: { data: DashboardData }) {
  const weather = data.weather;
  const location = data.garden.location || data.garden.name;
  if (!weather) {
    return (
      <Card>
        <p className="text-sm font-bold">Weather</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {data.weatherUnavailable ? "Weather is temporarily unavailable." : "Set this garden's location to see local weather."}
        </p>
      </Card>
    );
  }
  const Icon = WEATHER_ICON[weather.current.description] ?? Cloud;
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm dark:border-slate-800 dark:from-sky-500/10 dark:to-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Weather · {location}</p>
          <p className="mt-2 text-5xl font-black leading-none">{weather.current.temp}°</p>
          <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{weather.current.description}</p>
        </div>
        <Icon size={44} className="text-amber-500" strokeWidth={1.5} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <Fact icon={CloudRain} value={`${weather.current.rainProb}%`} label="Rain" />
        <Fact icon={Droplets} value={`${weather.current.humidity}%`} label="Humidity" />
        <Fact icon={Wind} value={`${weather.current.windSpeed}`} label="km/h" />
      </div>
      {weather.forecast.length ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {weather.forecast.slice(0, 3).map((day) => {
            const DayIcon = WEATHER_ICON[day.description] ?? Cloud;
            return (
              <div key={day.day} className="rounded-xl bg-white/70 py-2 text-center dark:bg-slate-950/50">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{day.day}</p>
                <DayIcon size={16} className="mx-auto mt-1 text-slate-400" />
                <p className="mt-1 text-xs font-bold">
                  {day.high}° <span className="font-normal text-slate-400">{day.low}°</span>
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-slate-400">
        {weather.current.rainProb >= 70 ? "Rain likely — automatic watering may wait. " : ""}
        Updated {timeAgo(weather.fetchedAt)}
        {weather.isStale ? " · last known" : ""}
      </p>
    </div>
  );
}

// One small weather fact (rain, humidity, wind).
function Fact({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/70 px-2 py-2 dark:bg-slate-950/50">
      <Icon size={14} className="mx-auto text-slate-400" />
      <p className="mt-1 font-bold">{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

// Shortcut buttons to common tasks.
function QuickActions({ gardenId }: { gardenId: string }) {
  const actions: { href: string; icon: LucideIcon; title: string; text: string }[] = [
    { href: `/gardens/${gardenId}?tab=pots`, icon: Plus, title: "Add pot & plant", text: "Grow something new" },
    { href: "/irrigation", icon: Droplets, title: "Water a pot", text: "Pump & watering levels" },
    { href: "/disease-detection", icon: Microscope, title: "Check a leaf", text: "Disease AI scan" },
    { href: "/sensors", icon: Cpu, title: "Add a device", text: "Connect it to a pot" },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="mb-3 text-sm font-bold">Quick actions</p>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            className="rounded-xl border border-slate-200 p-3 transition hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-slate-800 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/5"
          >
            <action.icon size={16} className="text-emerald-600 dark:text-emerald-400" />
            <p className="mt-2 text-sm font-semibold leading-tight">{action.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{action.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Readable disease name: "Tomato___Early_blight" -> "Early blight (Tomato)".
function prettyDisease(label: string) {
  const [crop, condition] = label.includes("___") ? label.split("___") : [null, label];
  const clean = (text: string) => text.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const name = clean(condition ?? label);
  const pretty = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return crop ? `${pretty} (${clean(crop)})` : pretty;
}

// Latest pump and disease events, newest first.
function ActivityList({ data, potLabel }: { data: DashboardData; potLabel: (potId: string | null) => string }) {
  const items = [
    ...data.pumpHistory.slice(0, 8).map((event) => ({
      id: event.id,
      at: event.startedAt,
      icon: Droplets,
      dot: event.status === "on" ? "bg-sky-500" : "bg-slate-400",
      title: `${potLabel(event.potId)} · pump turned ${event.status}`,
      detail: event.mode === "automatic" ? "Automatic" : "Manual",
    })),
    ...data.diseaseHistory.slice(0, 4).map((prediction) => ({
      id: prediction.id,
      at: prediction.createdAt,
      icon: Microscope,
      dot: "bg-violet-500",
      title: `${potLabel(prediction.potId)} · ${prettyDisease(prediction.className ?? prediction.predictedDisease)}`,
      detail: `Disease AI · ${Math.round(prediction.confidence * 100)}%`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  if (!items.length) return <p className="py-4 text-center text-sm text-slate-400">No watering or disease checks yet.</p>;

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 py-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
          <item.icon size={15} className="shrink-0 text-slate-400" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</p>
          <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
            {item.detail} · {timeAgo(item.at)}
          </p>
        </li>
      ))}
    </ul>
  );
}

// Grey placeholder boxes shown while data loads.
function DashboardSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div className={bare ? "space-y-6" : "mx-auto max-w-7xl space-y-6"} aria-hidden="true">
      {bare ? null : <div className="h-14 w-72 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-900" />}
      <div className="h-12 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-900" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-900" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-900 xl:col-span-2" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-900" />
      </div>
    </div>
  );
}
