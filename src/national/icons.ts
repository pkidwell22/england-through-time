import type { PlaceKind } from "./types";

/**
 * The national map's symbol family. Drawn by hand on a 64-unit grid in the manner of engraved map symbols:
 * a dark ink line, a paper ground and, where it helps, one accent colour per kind.
 *
 * Each symbol is written with three placeholder paints, so the same drawing serves the map and the key:
 *   PAPER  the light ground      (map: paper, or the evidence colour when the evidence tint is on)
 *   INK    the line work         (map: a warm near-black)
 *   ACCENT one colour per kind   (map: KIND_ACCENT)
 * For the WebGL atlas the paints are pure red, green and blue, so the marker shader can recombine them;
 * for the DOM key they are real colours (iconSvg()).
 */

export type IconId = PlaceKind | "gone" | "pip";

const P = "{P}", I = "{I}", A = "{A}";

/** SVG bodies (no <svg> wrapper), 64 x 64, centred on 32,32. */
const BODY: Record<IconId, string> = {
  // settlements: the classic dot, ringed; a city carries an inner ring and a centre
  town: `<circle cx="32" cy="32" r="15" fill="${P}" stroke="${I}" stroke-width="5"/>`,
  city: `<circle cx="32" cy="32" r="21" fill="${P}" stroke="${I}" stroke-width="5"/>
         <circle cx="32" cy="32" r="12.5" fill="none" stroke="${I}" stroke-width="2.6"/>
         <circle cx="32" cy="32" r="5.5" fill="${I}"/>`,
  port: `<circle cx="32" cy="32" r="19" fill="${A}" stroke="${I}" stroke-width="5"/>
         <g fill="none" stroke="${I}" stroke-width="3.4" stroke-linecap="round">
           <path d="M32 22v20"/><path d="M26.5 26h11"/><path d="M23 35c1.5 5 5 7.5 9 7.5s7.5-2.5 9-7.5"/>
         </g><circle cx="32" cy="20.5" r="2.6" fill="none" stroke="${I}" stroke-width="2.4"/>`,
  // a hill enclosed by ramparts: two rings with the hachures of a bank between them
  hillfort: `<ellipse cx="32" cy="33" rx="25" ry="19" fill="${A}" stroke="${I}" stroke-width="4.4"/>
         <ellipse cx="32" cy="33" rx="14" ry="9.5" fill="${P}" stroke="${I}" stroke-width="3.2"/>
         <g stroke="${I}" stroke-width="2.4" stroke-linecap="round">
           <path d="M32 17.5v5"/><path d="M32 43.5v5"/><path d="M10.5 33h5"/><path d="M48.5 33h5"/>
           <path d="M16.5 21.5l3.4 3.2"/><path d="M47.5 21.5l-3.4 3.2"/><path d="M16.5 44.5l3.4-3.2"/><path d="M47.5 44.5l-3.4-3.2"/>
         </g>`,
  // the playing-card plan of a Roman fort with its four gates and crossing streets
  fort: `<rect x="11" y="11" width="42" height="42" rx="10" fill="${P}" stroke="${I}" stroke-width="5"/>
         <path d="M32 13v38M13 32h38" stroke="${I}" stroke-width="3.2"/>
         <rect x="25.5" y="25.5" width="13" height="13" rx="1.5" fill="${A}" stroke="${I}" stroke-width="2.6"/>`,
  // a keep: battlements, a slit and a door
  castle: `<path d="M14 54V24h7v-7h7v7h8v-7h7v7h7v30z" fill="${A}" stroke="${I}" stroke-width="4.4" stroke-linejoin="round"/>
         <path d="M27 54V44a5 5 0 0110 0v10" fill="${I}"/>
         <path d="M32 29v7" stroke="${I}" stroke-width="3" stroke-linecap="round"/>`,
  // a cloister: the garth inside its walks, with a cross
  monastery: `<rect x="13" y="19" width="38" height="34" rx="2.5" fill="${P}" stroke="${I}" stroke-width="4.4"/>
         <rect x="23" y="29" width="18" height="14" rx="1.2" fill="${A}" stroke="${I}" stroke-width="2.8"/>
         <path d="M32 5v12M26.5 9.5h11" stroke="${I}" stroke-width="3.6" stroke-linecap="round"/>`,
  // a great church: nave, crossing tower and spire
  cathedral: `<path d="M10 54V35l11-8 11 8v19z" fill="${P}" stroke="${I}" stroke-width="4" stroke-linejoin="round"/>
         <path d="M32 54V28l9-15 9 15v26z" fill="${A}" stroke="${I}" stroke-width="4" stroke-linejoin="round"/>
         <path d="M41 4v8M37.5 7h7" stroke="${I}" stroke-width="3" stroke-linecap="round"/>
         <path d="M38 54v-9a3 3 0 016 0v9" fill="${I}"/>`,
  // a crown for a royal or great house
  palace: `<path d="M11 47l-2-26 12 11 11-17 11 17 12-11-2 26z" fill="${A}" stroke="${I}" stroke-width="4.2" stroke-linejoin="round"/>
         <path d="M12 47h40v6H12z" fill="${P}" stroke="${I}" stroke-width="4" stroke-linejoin="round"/>
         <circle cx="9" cy="20" r="3.4" fill="${P}" stroke="${I}" stroke-width="2.4"/><circle cx="32" cy="13" r="3.4" fill="${P}" stroke="${I}" stroke-width="2.4"/><circle cx="55" cy="20" r="3.4" fill="${P}" stroke="${I}" stroke-width="2.4"/>`,
  // standing stones: a trilithon
  monument: `<rect x="13" y="25" width="12" height="29" rx="2" fill="${A}" stroke="${I}" stroke-width="4"/>
         <rect x="39" y="25" width="12" height="29" rx="2" fill="${A}" stroke="${I}" stroke-width="4"/>
         <rect x="9" y="13" width="46" height="11" rx="2.5" fill="${P}" stroke="${I}" stroke-width="4"/>`,
  // crossed swords
  battle: `<g stroke-linecap="round" stroke-linejoin="round">
           <path d="M14 12l26 26" stroke="${I}" stroke-width="10"/><path d="M50 12L24 38" stroke="${I}" stroke-width="10"/>
           <path d="M14 12l26 26" stroke="${P}" stroke-width="4"/><path d="M50 12L24 38" stroke="${P}" stroke-width="4"/>
           <path d="M33 47l14-14M17 33l14 14" stroke="${I}" stroke-width="9"/><path d="M33 47l14-14M17 33l14 14" stroke="${A}" stroke-width="3.6"/>
           <path d="M45 45l8 8M19 45l-8 8" stroke="${I}" stroke-width="7.5"/>
         </g>`,
  // crossed pick and hammer
  mine: `<g stroke-linecap="round" stroke-linejoin="round">
           <path d="M18 50L44 20" stroke="${I}" stroke-width="9"/><path d="M18 50L44 20" stroke="${P}" stroke-width="3.4"/>
           <path d="M46 50L22 22" stroke="${I}" stroke-width="9"/><path d="M46 50L22 22" stroke="${P}" stroke-width="3.4"/>
           <path d="M30 14c8-4 17-2 22 5-7-2-13-2-19 1z" fill="${A}" stroke="${I}" stroke-width="3.6"/>
           <rect x="10" y="14" width="18" height="10" rx="2" transform="rotate(-40 19 19)" fill="${A}" stroke="${I}" stroke-width="3.6"/>
         </g>`,
  other: `<path d="M32 12l16 20-16 20-16-20z" fill="${P}" stroke="${I}" stroke-width="4.6" stroke-linejoin="round"/>`,
  // a known site with nothing standing: a broken ring
  gone: `<circle cx="32" cy="32" r="15" fill="none" stroke="${I}" stroke-width="8" stroke-dasharray="9.4 6.3"/>
         <circle cx="32" cy="32" r="15" fill="none" stroke="${P}" stroke-width="3.2" stroke-dasharray="9.4 6.3"/>`,
  // a place too crowded to draw at this distance
  pip: `<circle cx="32" cy="32" r="9" fill="${P}" stroke="${I}" stroke-width="5"/>`,
};

/** Order of cells in the atlas. */
export const ICON_IDS: IconId[] = ["town", "city", "port", "hillfort", "fort", "castle", "monastery", "cathedral", "palace", "monument", "battle", "mine", "other", "gone", "pip"];
export const ICON_INDEX: Record<IconId, number> = Object.fromEntries(ICON_IDS.map((k, i) => [k, i])) as Record<IconId, number>;
/** Atlas: ATLAS_COLS x ATLAS_COLS cells of ATLAS_CELL pixels. */
export const ATLAS_COLS = 4;
export const ATLAS_CELL = 128;

export const INK = "#1d1a15";
export const PAPER = "#f6f0e1";
/** One accent per kind. Gold is kept for the way into a detailed site and is not used here. */
export const KIND_ACCENT: Record<IconId, string> = {
  town: PAPER, city: PAPER, other: PAPER, gone: PAPER, pip: PAPER,
  port: "#9fcfdc", hillfort: "#c49a52", fort: "#b5543d", castle: "#a3acb8", monastery: "#b3a2d9", cathedral: "#d9cfb8",
  palace: "#a8566f", monument: "#cbc1a9", battle: "#d4483e", mine: "#94704e",
};

/** Settlements are dots that grow with size; everything else is a pictogram. */
export const IS_SETTLEMENT: Record<IconId, boolean> = {
  town: true, city: true, port: true, other: false, gone: false, pip: false, hillfort: false, fort: false, castle: false,
  monastery: false, cathedral: false, palace: false, monument: false, battle: false, mine: false,
};

/** The symbol as standalone SVG markup (for the key), in its map colours or with a replacement ground colour. */
export function iconSvg(id: IconId, size = 22, ground?: string): string {
  const body = BODY[id].replaceAll(P, ground ?? (id === "port" ? PAPER : PAPER)).replaceAll(I, INK).replaceAll(A, ground ?? KIND_ACCENT[id]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

function atlasSvg(id: IconId): string {
  const body = BODY[id].replaceAll(P, "#ff0000").replaceAll(I, "#00ff00").replaceAll(A, "#0000ff");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${ATLAS_CELL}" height="${ATLAS_CELL}"><g transform="translate(8.32 8.32) scale(0.74)">${body}</g></svg>`;
}

/**
 * Rasterise the family into an atlas canvas (never added to the page). Channels hold the coverage of each paint,
 * alpha the total coverage, so the marker shader can repaint each part and still antialias between them.
 */
export async function buildIconAtlas(): Promise<HTMLCanvasElement> {
  const cv = document.createElement("canvas");
  cv.width = cv.height = ATLAS_COLS * ATLAS_CELL;
  const ctx = cv.getContext("2d")!;
  await Promise.all(
    ICON_IDS.map(async (id, i) => {
      const img = new Image();
      img.decoding = "async";
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(atlasSvg(id));
      await img.decode();
      ctx.drawImage(img, (i % ATLAS_COLS) * ATLAS_CELL, Math.floor(i / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL);
    }),
  );
  return cv;
}
