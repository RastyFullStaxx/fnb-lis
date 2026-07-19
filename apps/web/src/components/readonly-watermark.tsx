import { useMemo } from "react";
import { useLocation } from "react-router";

/**
 * Faint tiled identity watermark over report pages for READONLY viewers
 * (3rd-party audit-service clients). This is a deterrent, not DRM — a browser
 * cannot block screenshots; what this does is make any leaked capture
 * attributable to the account that took it. The export footer carries the
 * same fact for downloaded files.
 */
export function ReadonlyWatermark({ role, name }: { role: string; name: string }) {
  const { pathname } = useLocation();
  const active = role === "READONLY" && pathname.includes("/reports");

  const tile = useMemo(() => {
    if (!active) return null;
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const label = `${name} · ${stamp}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="200">` +
      `<text x="210" y="100" text-anchor="middle" transform="rotate(-30 210 100)" ` +
      `font-family="system-ui, sans-serif" font-size="15" fill="#3a56e4" fill-opacity="0.4">` +
      label.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
      `</text></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }, [active, name]);

  if (!tile) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 opacity-[0.16] print:opacity-25"
      style={{ backgroundImage: tile, backgroundRepeat: "repeat" }}
    />
  );
}
