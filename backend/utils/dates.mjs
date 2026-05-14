export function nowIso() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
