// Owned by Agent F. Fetch wrappers for SPEC §5.5 (+ the live board, §5.11). Errors come back as { code, message }.

/** Scenario ids the UI never offers (see `scenarios` below). */
const HIDDEN_SCENARIOS = new Set(["grandkid"]);

async function request(path, init) {
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw { code: "NETWORK", message: "We couldn't reach the Scam Drill server." };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON */
  }
  if (!res.ok) throw data?.error ?? { code: `HTTP_${res.status}`, message: "Something went wrong." };
  return data;
}

const post = (path, body) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  // Only unknown-caller scenarios are offered. "grandkid" impersonates a family member, so the UI hides it
  // everywhere (drill picker, phone dashboard). The server still serves it; this is a frontend choice.
  scenarios: async () => (await request("/api/scenarios")).filter((s) => !HIDDEN_SCENARIOS.has(s.id)),
  phoneNumbers: () => request("/api/phone/numbers"),
  phoneStart: (numberId, scenarioId, shareLive) => post("/api/phone/start", { numberId, scenarioId, shareLive }),
  liveBoard: () => request("/api/live"),
};

/** Friendly words for any error code. Never shows raw errors or stack traces. */
export function friendly(err) {
  switch (err?.code) {
    case "MIC_DENIED":
      return "We need your microphone for the drill. Please allow it in your browser and try again.";
    case "UPSTREAM_ERROR":
      return "The practice caller isn't available right now. You can still play the demo call.";
    case "CONNECTION_LOST":
      return "The practice call dropped. Please try again.";
    case "NETWORK":
      return "We couldn't reach the Scam Drill server. Check your connection and try again.";
    case "PHONE_DISABLED":
      return "Phone drills aren't set up on this server.";
    case "NUMBER_NOT_ALLOWED":
      return "That number hasn't agreed to phone drills.";
    default:
      return "Something went wrong starting the drill. Please try again.";
  }
}
