/** Higher-detail replacements for landmark builders (churches, keeps, halls…). Called once by the engine after the base builders are registered. */
import { registerEcclesiastical } from "./detail/ecclesiastical";
import { registerSecular } from "./detail/secular";

export function registerLandmarkDetail() {
  registerEcclesiastical();
  registerSecular();
}
