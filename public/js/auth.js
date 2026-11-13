// Fetch wrappers for /api/auth/*. Errors come back as { code, message }, like api.js.
async function call(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw { code: "NETWORK", message: "We couldn't reach the Scam Drill server. Check your connection and try again." };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON */
  }
  if (!res.ok) throw data?.error ?? { code: `HTTP_${res.status}`, message: "Something went wrong. Please try again." };
  return data;
}

export const auth = {
  me: () => call("/api/auth/me").then((d) => d?.user ?? null),
  signUp: (email, password, phone) => call("/api/auth/signup", { email, password, phone }).then((d) => d.user),
  logIn: (email, password) => call("/api/auth/login", { email, password }).then((d) => d.user),
  logOut: () => call("/api/auth/logout", {}),
};
