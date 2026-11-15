/**
 * One small icon set for both viewers: 20-unit grid, 1.6 stroke, round joins, drawn in currentColor.
 * Icons are decorative (aria-hidden); the control that holds one carries the accessible name.
 * No <title> elements: several icons sit inside elements whose text the tests read.
 */
import type { ReactElement } from "react";

const P: Record<string, ReactElement> = {
  play: <path d="M7 4.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L7.9 4.3a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="5.5" y="4.5" width="3.2" height="11" rx="0.8" />
      <rect x="11.3" y="4.5" width="3.2" height="11" rx="0.8" />
    </g>
  ),
  backward: <path d="M10 5.5 4 10l6 4.5zM16.5 5.5 10.5 10l6 4.5z" fill="currentColor" stroke="none" />,
  forward: <path d="M10 5.5 16 10l-6 4.5zM3.5 5.5 9.5 10l-6 4.5z" fill="currentColor" stroke="none" />,
  reset: (
    <>
      <path d="M4.2 8.2A6.2 6.2 0 1 1 4 11.6" />
      <path d="M3.6 4.4v4h4" />
    </>
  ),
  orbit: (
    <>
      <ellipse cx="10" cy="10" rx="7.5" ry="3.2" />
      <circle cx="10" cy="10" r="2" fill="currentColor" stroke="none" />
      <path d="M15.6 6.4l1.4-.9.3 1.7" />
    </>
  ),
  walk: (
    <>
      <circle cx="11" cy="3.8" r="1.6" fill="currentColor" stroke="none" />
      <path d="M10.4 7.2 8.6 11l2.4 2 1 4.4M8.6 11l-1.8 1.6L5.2 17M10.4 7.2l2.8 2.4 2.4.6M10.4 7.2 7.8 8.2 6.6 10.4" />
    </>
  ),
  labels: (
    <>
      <path d="M3.5 5.5h9.2l3.8 4.5-3.8 4.5H3.5z" />
      <circle cx="12.2" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  evidence: (
    <>
      <rect x="3" y="3.5" width="6" height="6" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M11 3.5h6v6h-6z" />
      <path d="M11 3.5 17 9.5" />
      <rect x="3" y="11" width="6" height="6" strokeDasharray="1.6 1.4" />
      <path d="M11.5 14h5" opacity="0.6" />
    </>
  ),
  kingdoms: (
    <>
      <path d="M3.5 6.5 8 4l4.5 2.5L17 4v9.5L12.5 16 8 13.5 3.5 16z" />
      <path d="M8 4v9.5M12.5 6.5V16" strokeDasharray="1.6 1.6" />
    </>
  ),
  key: (
    <>
      <circle cx="5" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3.6 10h2.8M5 8.6v2.8" />
      <path d="M3.8 15.6 5 13.4l1.2 2.2z" fill="currentColor" />
      <path d="M9 5.5h8M9 10h8M9 14.8h8" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 9v5" />
      <circle cx="10" cy="6.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  back: <path d="M12 4.5 6.5 10l5.5 5.5" />,
  chevronUp: <path d="M5 12.5 10 7.5l5 5" />,
  external: (
    <>
      <path d="M11 4h5v5M16 4l-7 7" />
      <path d="M14 11.5V16H4V6h4.5" />
    </>
  ),
  frame: <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4M8 10h4M10 8v4" />,
  enter: (
    <>
      <path d="M9 3.5h6.5v13H9" />
      <path d="M3.5 10h8M8.5 6.8 11.7 10l-3.2 3.2" />
    </>
  ),
  sliders: <path d="M4 5.5h7M14 5.5h2M4 10h2M9 10h7M4 14.5h8M15 14.5h1M12.5 3.8v3.4M7.5 8.3v3.4M13.5 12.8v3.4" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.3l2.8 1.7" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={"icon" + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
    >
      {P[name]}
    </svg>
  );
}
