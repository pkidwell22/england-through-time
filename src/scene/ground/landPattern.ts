/**
 * The generic field layout shared by the baked land texture (./land.ts, GLSL) and the near-camera ground cover
 * (./cover.ts, JS), so that the furrows and straw rows drawn round the camera run the same way as the strips and
 * fields seen from above.
 *
 * Nothing here is a mapped field: the layout is a deterministic pattern, the same for every site, laid out in
 * blocks ("regions", about 0.9 x 0.8 km) that each take their own orientation, so it never reads as one grid.
 * Inside a block the fields stand in rows (brick fashion, each row with its own field width):
 *  - before c. 1000 CE: small fields of about 0.3-0.8 ha bounded by banks (the coaxial and "Celtic" field systems
 *    common in lowland England from the Middle Bronze Age);
 *  - from c. 1000 CE: furlongs of about 4 ha divided into long strips (selions), each furlong with its own strip
 *    direction, reverse-S curved, with headlands at the ends (the open-field system).
 * Which periods and how much of each site is arable is decided by the caller (land.ts) from the site's data.
 *
 * Hashes are integer (PCG 2D) so the GLSL and JS versions agree exactly; the value noise uses the same
 * interpolation in both (they differ only by float rounding, which matters only exactly on a boundary).
 */

export const PRE_CELL: [number, number] = [95, 60];
export const OPEN_CELL: [number, number] = [230, 170];
const REGION: [number, number] = [950, 780];

export const LAND_GLSL = /* glsl */ `
uvec2 ltPcg( uvec2 v ) {
	v = v * 1664525u + 1013904223u;
	v.x += v.y * 1664525u;
	v.y += v.x * 1664525u;
	v = v ^ ( v >> 16u );
	v.x += v.y * 1664525u;
	v.y += v.x * 1664525u;
	v = v ^ ( v >> 16u );
	return v;
}
float hsh( vec2 c, float s ) {
	uvec2 u = uvec2( ivec2( floor( c ) ) + 32768 );
	u.y += uint( s ) * 7919u;
	return float( ltPcg( u ).x ) * ( 1.0 / 4294967296.0 );
}
float vnz( vec2 p, float s ) {
	vec2 i = floor( p ), f = p - i;
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hsh( i, s ), hsh( i + vec2( 1.0, 0.0 ), s ), u.x ), mix( hsh( i + vec2( 0.0, 1.0 ), s ), hsh( i + vec2( 1.0, 1.0 ), s ), u.x ), u.y );
}
struct Fld {
	vec2 id;     // field (furlong) id, unique across regions
	vec2 rid;    // region id
	float ang;   // orientation of the region's rows (world, radians)
	vec2 lp;     // position in the region's rotated frame
	vec2 f;      // position inside the field, 0..1 (x along the row, y across)
	vec2 sz;     // field size (m)
	vec2 ed;     // distance (m) to the nearest cross boundary (x) and row boundary (y)
	float redge; // distance (m) to the region's edge (approximate)
};
uniform float uBaseAng;
Fld fieldsAt( vec2 p, vec2 cell ) {
	Fld F;
	vec2 rp = p + ( vec2( vnz( p / 420.0, 1.0 ), vnz( p / 420.0 + 7.3, 2.0 ) ) - 0.5 ) * 150.0;
	float ry = floor( rp.y / ${REGION[1].toFixed(1)} );
	float rox = hsh( vec2( ry, 3.0 ), 3.0 ) * ${REGION[0].toFixed(1)};
	float rx = floor( ( rp.x + rox ) / ${REGION[0].toFixed(1)} );
	vec2 rf = vec2( fract( ( rp.x + rox ) / ${REGION[0].toFixed(1)} ), fract( rp.y / ${REGION[1].toFixed(1)} ) );
	F.redge = min( min( rf.x, 1.0 - rf.x ) * ${REGION[0].toFixed(1)}, min( rf.y, 1.0 - rf.y ) * ${REGION[1].toFixed(1)} );
	F.rid = vec2( rx, ry );
	F.ang = uBaseAng + ( hsh( F.rid, 4.0 ) - 0.5 ) * 1.4;
	float c = cos( F.ang ), s = sin( F.ang );
	vec2 lp = vec2( c * p.x + s * p.y, - s * p.x + c * p.y );
	lp += ( vec2( vnz( p / 140.0, 5.0 ), vnz( p / 140.0 + 3.1, 6.0 ) ) - 0.5 ) * 10.0;
	float row = floor( lp.y / cell.y );
	vec2 ro = F.rid * 1013.0;
	float w = cell.x * ( 0.55 + 0.9 * hsh( vec2( row, 0.0 ) + ro, 7.0 ) );
	float ox = hsh( vec2( row, 1.0 ) + ro, 8.0 ) * w;
	float col = floor( ( lp.x + ox ) / w );
	F.id = vec2( col, row ) + ro;
	F.f = vec2( fract( ( lp.x + ox ) / w ), fract( lp.y / cell.y ) );
	F.sz = vec2( w, cell.y );
	F.lp = lp;
	F.ed = vec2( min( F.f.x, 1.0 - F.f.x ) * w, min( F.f.y, 1.0 - F.f.y ) * cell.y );
	return F;
}
`;

function pcgX(x: number, y: number): number {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  y = (y + Math.imul(x, 1664525)) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Same as the GLSL `hsh`: a uniform value in [0, 1) for an integer cell and a seed. */
export function hsh(cx: number, cy: number, s: number): number {
  const x = (Math.floor(cx) + 32768) >>> 0;
  const y = ((Math.floor(cy) + 32768) + Math.imul(s >>> 0, 7919)) >>> 0;
  return pcgX(x, y) / 4294967296;
}

export function vnz(px: number, py: number, s: number): number {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hsh(ix, iy, s), b = hsh(ix + 1, iy, s), c = hsh(ix, iy + 1, s), d = hsh(ix + 1, iy + 1, s);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

export interface FieldAt {
  rx: number;
  ry: number;
  idx: number;
  idy: number;
  ang: number;
  fx: number;
  fy: number;
  w: number;
  h: number;
}

/** JS mirror of `fieldsAt` (the parts the ground cover needs). */
export function fieldsAt(x: number, z: number, cell: [number, number], baseAng: number): FieldAt {
  const rpx = x + (vnz(x / 420, z / 420, 1) - 0.5) * 150;
  const rpy = z + (vnz(x / 420 + 7.3, z / 420 + 7.3, 2) - 0.5) * 150;
  const ry = Math.floor(rpy / REGION[1]);
  const rox = hsh(ry, 3, 3) * REGION[0];
  const rx = Math.floor((rpx + rox) / REGION[0]);
  const ang = baseAng + (hsh(rx, ry, 4) - 0.5) * 1.4;
  const c = Math.cos(ang), s = Math.sin(ang);
  const lx = c * x + s * z + (vnz(x / 140, z / 140, 5) - 0.5) * 10;
  const ly = -s * x + c * z + (vnz(x / 140 + 3.1, z / 140 + 3.1, 6) - 0.5) * 10;
  const row = Math.floor(ly / cell[1]);
  const rox2 = rx * 1013, roy2 = ry * 1013;
  const w = cell[0] * (0.55 + 0.9 * hsh(row + rox2, roy2, 7));
  const ox = hsh(row + rox2, 1 + roy2, 8) * w;
  const col = Math.floor((lx + ox) / w);
  const fxv = (lx + ox) / w;
  const fyv = ly / cell[1];
  return { rx, ry, idx: col + rox2, idy: row + roy2, ang, fx: fxv - Math.floor(fxv), fy: fyv - Math.floor(fyv), w, h: cell[1] };
}
