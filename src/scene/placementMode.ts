/**
 * Debug switch for before/after comparisons of the placement rules (like ?pop=0 and ?ground=0): `?placement=legacy`
 * places houses, landmarks, trees and street surfaces as they were before every placed thing was made to suit the
 * ground of its whole life span (one representative year per zone or phase, centre-only dry test, no clearance of
 * streets, roads and landmark plans over a house's life, no overlap resolution). See docs/AUDIT.md.
 */
export const LEGACY_PLACEMENT = typeof location !== "undefined" && /[?&]placement=legacy/.test(location.search);
