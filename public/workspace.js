// Workspace routing keeps credentials entirely out of the address bar.
const landing = document.getElementById("landing-screen");
const hero = document.getElementById("landing-hero");
const docs = document.getElementById("docs");
const auth = document.getElementById("auth-screen");
const workspace = document.getElementById("workspace-screen");
const screens = [...document.querySelectorAll("[data-screen]")];
const links = [...document.querySelectorAll(".sidebar nav a")];
const titles = new Map([
  ["overview", "Overview"],
  ["account", "Balance details"],
  ["downloads", "Connect"],
  ["models", "Preset lab"],
]);
let visibleRoute;

function showScreen({ focus = false } = {}) {
  const requested = location.hash.slice(1);
  const downloadAnchor = requested === "connector-downloads";
  const route = downloadAnchor ? "downloads" : requested;
  const current = titles.has(route) ? route : "overview";

  if (workspace.hidden) {
    const signIn = route === "signin" || titles.has(route);
    auth.hidden = !signIn;
    landing.hidden = signIn;
    hero.hidden = route === "docs";
    docs.hidden = route !== "docs";
    visibleRoute = undefined;
    const title = signIn ? "Sign in" : docs.hidden ? "Build with more freedom" : "Docs";
    document.title = `${title} · Workspace`;
    if (focus) {
      window.scrollTo(0, 0);
      if (signIn) document.getElementById("key").focus();
      else if (!docs.hidden) document.getElementById("docs-heading").focus();
      else document.getElementById("landing-heading").focus();
    }
    return;
  }

  landing.hidden = true;
  auth.hidden = true;
  for (const screen of screens) screen.hidden = screen.id !== current;
  for (const link of links) {
    if (link.getAttribute("href") === `#${current}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.getElementById("section-name").textContent = titles.get(current);
  document.title = `${titles.get(current)} · Workspace`;
  if (visibleRoute !== requested && !downloadAnchor) window.scrollTo(0, 0);
  visibleRoute = requested;
  if (downloadAnchor) document.getElementById("connector-downloads").scrollIntoView({block:"start"});
  if (focus) {
    const heading = downloadAnchor ? document.getElementById("connector-heading") :
      document.getElementById(current).querySelector("h1");
    heading?.focus({preventScroll:true});
  }
}

window.addEventListener("hashchange", () => showScreen({focus:true}));
document.addEventListener("apiduck:session", () => showScreen({focus:true}));
document.getElementById("logout").addEventListener("click", () => {
  if (location.hash !== "#signin") location.hash = "#signin";
  showScreen({focus:true});
});
showScreen();

const platformButtons = document.querySelectorAll("[data-install]");
const commands = document.querySelectorAll("[data-command]");
const copyStatus = document.getElementById("copy-status");

for (const button of platformButtons) {
  button.addEventListener("click", () => {
    const platform = button.dataset.install;
    for (const option of platformButtons) option.setAttribute("aria-pressed", String(option === button));
    for (const command of commands) command.hidden = command.dataset.command !== platform;
    copyStatus.textContent = "";
  });
}
for (const button of document.querySelectorAll(".copy-command")) {
  button.addEventListener("click", async () => {
    const command = button.parentElement.querySelector("code")?.textContent;
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      copyStatus.textContent = "Install command copied.";
    } catch {
      copyStatus.textContent = "Clipboard unavailable. Select and copy the command.";
    }
  });
}

// Keep the arrow independent of pointer coordinates. The CTA zone triggers its
// approach, and only activating the main link sends it across the button.
const openWorkspace = document.getElementById("open-workspace");
const workspaceCta = openWorkspace.parentElement;
const workspaceArrow = workspaceCta.querySelector(".workspace-arrow");
const reduceWorkspaceMotion = matchMedia("(prefers-reduced-motion: reduce)");

openWorkspace.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey || reduceWorkspaceMotion.matches) return;

  event.preventDefault();
  if (workspaceCta.classList.contains("is-opening")) return;
  const proceed = () => {
    clearTimeout(fallback);
    workspaceArrow.removeEventListener("animationend", proceed);
    workspaceCta.classList.remove("is-opening");
    location.hash = openWorkspace.hash;
  };
  const fallback = setTimeout(proceed, 540);
  workspaceArrow.addEventListener("animationend", proceed);
  workspaceCta.classList.add("is-opening");
});
