"use client";

// Draws text as a QR code; always dark-on-white so phone cameras can read it
import { useEffect, useState } from "react";
import QRCode from "qrcode";

// QR code box; `value` is the text to encode, `label` is for screen readers
export function QrCode({ value, size = 144, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  // Build the QR SVG whenever the text changes (ignore it if unmounted first)
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      role="img"
      aria-label={label}
      className="overflow-hidden rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
      style={{ width: size, height: size }}
    >
      {svg ? (
        // QRCode.toString returns a self-contained SVG built from `value` only.
        <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />
      )}
    </div>
  );
}
