const configuredTime = process.env.APP_ENV === "test" ? process.env.APP_TEST_NOW_ISO : "";

if (configuredTime) {
  const epoch = Date.parse(configuredTime);
  if (!Number.isFinite(epoch)) throw new Error("APP_TEST_NOW_ISO must be a valid ISO date-time");

  const NativeDate = globalThis.Date;
  class FrozenDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [epoch]));
    }

    static now() {
      return epoch;
    }
  }

  Object.defineProperty(globalThis, "Date", {
    configurable: true,
    writable: true,
    value: FrozenDate
  });
}
