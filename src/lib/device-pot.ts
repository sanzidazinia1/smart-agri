// Links pots to a board's ports (each port has one soil probe and one pump)

// Most pots one board can serve
export const MAX_PORTS = 6;

// A pot connected to a board port
type PortLink = { potId: string; port: number };

// Finds which pot a reading belongs to by port (or the only pot), else null
export function pickPotForReading({ links, port }: { links: PortLink[]; port?: number }): string | null {
  if (port !== undefined) return links.find((link) => link.port === port)?.potId ?? null;
  return links.length === 1 ? links[0].potId : null;
}

// Lowest free port on a board, or null when every port is in use
export function firstFreePort(usedPorts: number[], portCount: number): number | null {
  const used = new Set(usedPorts);
  for (let port = 1; port <= Math.min(Math.max(portCount, 1), MAX_PORTS); port++) if (!used.has(port)) return port;
  return null;
}

// True for firmware 2.9+, which lets the app set the number of ports
export function supportsRemotePorts(firmware: string | null | undefined) {
  const m = firmware?.match(/(\d+)\.(\d+)/);
  return !!m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 9));
}
