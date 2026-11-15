// midsummer sunrise / midwinter sunset azimuths: cos A = (sin d - sin phi sin h)/(cos phi cos h)
const r = Math.PI / 180, phi = 51.179 * r;
function az(dDeg, hApparentLimb, setting) {
  const d = dDeg * r;
  const h = (hApparentLimb - 0.57 - 0.27) * r; // centre altitude when the upper limb is just on the apparent horizon
  const A = Math.acos((Math.sin(d) - Math.sin(phi) * Math.sin(h)) / (Math.cos(phi) * Math.cos(h))) / r;
  return setting ? 360 - A : A;
}
for (const [lab, obl] of [["2500 BCE", 23.97], ["today", 23.44]])
  for (const hh of [0, 0.6]) console.log(lab, "horizon", hh, "sunrise(+obl)", az(obl, hh, false).toFixed(2), "sunset(-obl)", az(-obl, hh, true).toFixed(2));
// geometric centre on geometric horizon, no refraction
for (const obl of [23.97, 23.44]) console.log("centre/geom", obl, (Math.acos(Math.sin(obl*r)/Math.cos(phi))/r).toFixed(2));
