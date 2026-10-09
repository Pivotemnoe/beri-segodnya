import assert from "node:assert/strict";
import { Script } from "node:vm";

export function runClientWorkspaceChecks(appSource) {
  const source = appSource.match(/function setupTabs\([\s\S]*?(?=\nasync function setupAdmin)/)?.[0];
  assert.ok(source, "Workspace tab controller missing");
  const node = (key = "") => ({
    dataset: key ? { tabLink: key, tabPanel: key } : {}, hidden: false, events: {}, attributes: {},
    classList: { values: {}, toggle(name, state) { this.values[name] = state; } },
    addEventListener(name, handler) { this.events[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  });
  const links = ["offers", "bookings", "overview", "security", "help"].map(node);
  const panels = ["offers", "bookings", "overview", "security", "help"].map(node);
  const more = node(), close = node(), select = node(), root = node(), sheet = node();
  sheet.showModal = () => { sheet.open = true; };
  sheet.close = () => { sheet.open = false; sheet.events.close(); };
  sheet.querySelector = selector => [links[3], links[4]].find(link => selector.includes('"' + link.dataset.tabLink + '"')) || null;
  root.querySelector = selector => ({ "[data-workspace-sheet]": sheet, "[data-workspace-more]": more, "[data-workspace-close]": close }[selector]);
  root.querySelectorAll = selector => ({ "[data-tab-link]": links, "[data-tab-panel]": panels, "[data-tab-select]": [select] }[selector]);
  let scrolls = 0; root.scrollIntoView = () => scrolls++;
  const location = { pathname: "/partner/dashboard", search: "?tab=offers" }, events = {};
  const history = { pushState(_, __, url) { location.search = url.slice(url.indexOf("?")); }, replaceState(_, __, url) { location.search = url.slice(url.indexOf("?")); } };
  const setup = new Script(source + "; setupTabs;").runInNewContext({ document: { querySelector: () => root }, URLSearchParams, history, location, matchMedia: () => ({ matches: true }), window: { addEventListener(name, callback) { events[name] = callback; } } });
  const activate = setup("root", ["bookings", "security", "help"]);
  assert.equal(location.search, "?tab=bookings", "Seller invalid tab must fall back to codes");
  assert.ok(links[0].hidden && links[2].hidden, "Seller sees publication/overview links");
  assert.equal(links[1].attributes["aria-current"], "page");
  more.events.click(); assert.ok(sheet.open); assert.equal(more.attributes["aria-expanded"], "true");
  links[3].events.click({ preventDefault() {} });
  assert.equal(location.search, "?tab=security"); assert.equal(sheet.open, false);
  assert.equal(more.attributes["aria-expanded"], "false"); assert.ok(more.classList.values.active);
  assert.equal(scrolls, 1); assert.equal(select.value, "security");
  location.search = "?tab=bookings"; events.popstate();
  assert.ok(links[1].classList.values.active); assert.equal(more.classList.values.active, false);
  activate("does-not-exist"); assert.equal(select.value, "bookings");
  delete sheet.showModal; delete root.dataset.mobileNavigationReady;
  setup("root", ["bookings"]); assert.equal(root.dataset.mobileNavigationReady, undefined, "Old browsers must retain the select fallback");
  console.log("Client workspace checks passed: role links, modal close, aria state, history and old-browser fallback");
}
