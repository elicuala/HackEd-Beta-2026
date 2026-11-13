// Owned by Agent B. Phone (Twilio) configuration, read lazily so a blank .env never crashes the server.
const env = (name) => (process.env[name] ?? "").trim();
const E164 = /^\+[1-9]\d{7,14}$/;

export function phoneConfig() {
  const cfg = {
    accountSid: env("TWILIO_ACCOUNT_SID"),
    authToken: env("TWILIO_AUTH_TOKEN"),
    fromNumber: env("TWILIO_FROM_NUMBER"),
    publicUrl: env("PUBLIC_URL").replace(/\/+$/, ""),
    allowed: env("ALLOWED_NUMBERS")
      .split(",")
      .map((n) => n.trim())
      .filter((n) => E164.test(n)),
  };
  cfg.enabled = Boolean(cfg.accountSid && cfg.authToken && cfg.fromNumber && cfg.publicUrl && cfg.allowed.length);
  return cfg;
}

/** [{ id: "n1", label: "•••• 1234", number }]. The number itself never leaves the server. */
export function allowedNumbers(cfg = phoneConfig()) {
  return cfg.allowed.map((number, i) => ({ id: `n${i + 1}`, label: `•••• ${number.slice(-4)}`, number }));
}

/** https://x.ngrok.app → wss://x.ngrok.app/twilio/stream */
export function streamUrl(publicUrl) {
  return publicUrl.replace(/^http/i, "ws") + "/twilio/stream";
}
