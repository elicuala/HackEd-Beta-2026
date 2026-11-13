// Owned by Agent L.
import { listScenarios } from "./index.js";

export default function register(app) {
  app.get("/api/scenarios", (req, res) => res.json(listScenarios()));
}
