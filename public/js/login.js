// The account page: log in, sign up, and log out.
import { auth } from "./auth.js";

const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel");
const accountPanel = $("accountPanel");
const form = $("authForm");
const tabs = { login: $("tabLogin"), signup: $("tabSignup") };
const navLink = document.querySelector("[data-account]");
let mode = "login";
let busy = false;

function showError(message) {
  $("errorText").textContent = message;
  $("errorBox").hidden = !message;
}

function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  tabs.login.setAttribute("aria-selected", String(!signup));
  tabs.signup.setAttribute("aria-selected", String(signup));
  $("authTabPanel").setAttribute("aria-labelledby", signup ? "tabSignup" : "tabLogin");
  $("phoneField").hidden = !signup;
  $("phone").required = signup;
  $("pwHint").hidden = !signup;
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("submit").textContent = signup ? "Create account" : "Log in";
  $("stageTitle").textContent = signup ? "Make an account in a minute." : "Log in to keep your number handy.";
  showError("");
}

function render(user) {
  authPanel.hidden = Boolean(user);
  accountPanel.hidden = !user;
  if (user) $("accPhone").textContent = user.phone;
  if (navLink) navLink.textContent = user ? "Account" : "Log in";
  if (user) $("stageTitle").textContent = "You're all set.";
  else setMode(mode);
}

/** Check the fields before sending, so mistakes are explained in plain words. */
function check() {
  const email = $("email").value.trim();
  const password = $("password").value;
  for (const id of ["email", "password", "phone"]) $(id).removeAttribute("aria-invalid");
  const fail = (id, message) => {
    $(id).setAttribute("aria-invalid", "true");
    $(id).focus();
    return message;
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("email", "Please enter a valid email address.");
  if (mode === "signup" && password.length < 8) return fail("password", "Your password needs at least 8 characters.");
  if (!password) return fail("password", "Please enter your password.");
  if (mode === "signup" && $("phone").value.replace(/\D/g, "").length < 10)
    return fail("phone", "Please enter a valid phone number, like 780 555 1234.");
  return "";
}

tabs.login.addEventListener("click", () => setMode("login"));
tabs.signup.addEventListener("click", () => setMode("signup"));
for (const tab of Object.values(tabs)) {
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = mode === "login" ? "signup" : "login";
    setMode(next);
    tabs[next].focus();
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const problem = check();
  showError(problem);
  if (problem) return;
  busy = true;
  $("submit").disabled = true;
  try {
    const email = $("email").value.trim();
    const password = $("password").value;
    const user = mode === "signup" ? await auth.signUp(email, password, $("phone").value) : await auth.logIn(email, password);
    form.reset();
    render(user);
  } catch (err) {
    showError(err?.message || "Something went wrong. Please try again.");
  } finally {
    busy = false;
    $("submit").disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await auth.logOut();
  } catch {
    /* the cookie still expires; show logged out either way */
  } finally {
    setMode("login");
    render(null);
  }
});

setMode(location.hash === "#signup" ? "signup" : "login");
auth
  .me()
  .then(render)
  .catch(() => render(null));
