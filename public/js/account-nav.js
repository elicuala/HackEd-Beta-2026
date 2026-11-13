// Shows "Log in" or "Account" on the nav's account tab, depending on whether you're logged in.
import { auth } from "./auth.js";

const link = document.querySelector("[data-account]");
if (link) {
  auth
    .me()
    .then((user) => {
      link.textContent = user ? "Account" : "Log in";
    })
    .catch(() => {
      link.textContent = "Log in";
    });
}
