import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Script, createContext } from "node:vm";

export function runClientPwaChecks(root) {
  const source = fs.readFileSync(path.join(root, "public/pwa-shell.js"), "utf8");
  const stored = new Map();
  const window = {};
  const context = createContext({ window, URL, location: { origin: "https://example.test" }, localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } });
  const helpers = source.slice(source.indexOf('  const guestKey ='), source.indexOf('  document.addEventListener("click"'));
  const { bookingPath, guestLinks, appHref } = new Script(`${helpers}\n({bookingPath,guestLinks,appHref})`).runInContext(context);
  const token = "booking-view-" + "a".repeat(40), link = `/booking/${token}`;
  assert.equal(bookingPath(link + "?app=1"), link);
  for (const invalid of ["https://evil.test" + link, "javascript:alert(1)", "/booking/BS-1234", "/api/customer/bookings", null, {}, "x".repeat(301)]) assert.equal(bookingPath(invalid), "");
  window.bsRememberGuestBooking(link); window.bsRememberGuestBooking(link);
  assert.equal(guestLinks().length, 1, "Guest bookmark duplicates were stored");
  window.bsRememberGuestBooking("https://evil.test" + link);
  assert.equal(guestLinks().length, 1, "External guest bookmark was accepted");
  for (let i = 0; i < 30; i++) window.bsRememberGuestBooking(`/booking/booking-view-${String(i).padStart(40, "0")}`);
  assert.equal(guestLinks().length, 20, "Guest bookmark storage is unbounded");
  assert.ok([...stored.values()].every(value => !value.includes('"code"') && !value.includes('"phone"') && !value.includes('"email"')), "Private booking/account data was stored");
  stored.set("bs_pwa_guest_links_v1", "{bad json"); assert.equal(guestLinks().length, 0);
  stored.set("bs_pwa_guest_links_v1", JSON.stringify([link, link, {}, "https://evil.test" + link])); assert.equal(guestLinks().length, 1);
  assert.equal(appHref("https://example.test/#offers"), "/app");
  assert.equal(appHref("/customer"), "/app/profile");
  assert.equal(appHref("/partner/dashboard?tab=codes"), "/partner/dashboard?tab=codes&app=1");
  assert.equal(appHref("/partners#partner-application"), "/partners?app=1#partner-application");
  assert.equal(appHref("https://evil.test/customer"), "https://evil.test/customer");
  assert.equal(appHref("/downloads/app.apk"), "/downloads/app.apk");
  assert.ok(source.includes('cache: "no-store"') && source.includes('Promise.allSettled') && source.includes('AbortController'), "PWA history does not use bounded fresh server requests");
  assert.ok(source.includes('Не все брони загрузились') && !source.includes('localStorage.removeItem'), "Temporary network failures erase guest bookmarks");
  assert.ok(source.includes('if (!authenticated || tourSeen()') && source.includes('dialog.showModal()') && source.includes('dialog.addEventListener("close"') && source.includes('bs-customer-change'), "Optional authenticated onboarding is incomplete");
  const publicSource = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.ok(publicSource.includes('if (!bookingForm.dataset.bookingOwner) window.bsRememberGuestBooking?.(result.bookingUrl)'), "Account bookings are copied into guest history");
}
