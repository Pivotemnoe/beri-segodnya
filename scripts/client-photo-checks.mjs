import assert from "node:assert/strict";
import { Script } from "node:vm";

export async function runClientPhotoChecks(appSource) {
  const source = appSource.match(/  function imageFromFile\([\s\S]*?(?=\n  function openOfferWizard)/)?.[0];
  assert.ok(source, "Client photo preparation is missing");
  function harness(mode = "valid") {
    const urls = [];
    const revoked = [];
    const timers = [];
    const canvases = [];
    const images = [];
    class FakeImage {
      naturalWidth = mode === "empty" ? 0 : 4000;
      naturalHeight = 3000;
      constructor() { images.push(this); }
      set src(value) {
        this.source = value;
        if (mode === "timeout") return;
        queueMicrotask(() => { if (mode === "decode-error") this.onerror?.(); else this.onload?.(); });
      }
      removeAttribute() { this.source = ""; }
    }
    class FakeReader {
      readyState = 0;
      readAsDataURL() {
        this.readyState = 1;
        queueMicrotask(() => {
          this.readyState = 2;
          if (mode === "reader-error") this.onerror?.();
          else { this.result = "data:image/jpeg;base64,/9j/2Q=="; this.onload?.(); }
        });
      }
      abort() { this.readyState = 2; }
    }
    const convert = new Script(source + "; imageFromFile;").runInNewContext({
      Image: FakeImage, FileReader: FakeReader,
      URL: { createObjectURL: () => { const url = "blob:photo-" + urls.length; urls.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
      window: {
        setTimeout: (callback, ms) => { timers.push({callback, ms, cleared: false}); return timers.length - 1; },
        clearTimeout: index => { timers[index].cleared = true; }
      },
      document: { createElement: tag => {
        assert.equal(tag, "canvas");
        const canvas = {
          getContext: () => mode === "canvas-error" ? null : { fillRect() {}, drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray(4096).fill(180)}) },
          toDataURL() { throw Error("Synchronous encoding must not be used"); },
          toBlob: (callback, type, quality) => {
            assert.equal(type, "image/jpeg"); assert.equal(quality, 0.8);
            queueMicrotask(() => callback(mode === "encode-error" ? null : {type: "image/jpeg"}));
          }
        };
        canvases.push(canvas);
        return canvas;
      }}
    });
    return { convert, urls, revoked, timers, canvases, images };
  }
  const file = {type: "image/png", size: 1024};
  const success = harness();
  const photo = await success.convert(file);
  assert.ok(photo.dataUrl.startsWith("data:image/jpeg;base64,"));
  assert.deepEqual([success.canvases[0].width, success.canvases[0].height], [1600, 1200]);
  assert.equal(photo.warning, "");
  assert.ok(!Number.isNaN(Date.parse(photo.capturedAt)));
  assert.deepEqual(success.revoked, success.urls);
  assert.ok(success.timers.every(timer => timer.cleared));
  for (const input of [{...file, type: "image/svg+xml"}, {...file, size: 12 * 1024 * 1024 + 1}]) {
    const rejected = harness();
    await assert.rejects(rejected.convert(input), /JPEG, PNG или WebP/);
    assert.equal(rejected.urls.length, 0);
  }
  for (const mode of ["decode-error", "canvas-error", "encode-error", "reader-error", "empty"]) {
    const rejected = harness(mode);
    await assert.rejects(rejected.convert(file), /Не удалось/);
    assert.deepEqual(rejected.revoked, rejected.urls, "Failed photo retained its object URL: " + mode);
    assert.ok(rejected.timers.every(timer => timer.cleared));
  }
  const timed = harness("timeout");
  const pending = timed.convert(file);
  const lateLoad = timed.images[0].onload;
  const rejected = assert.rejects(pending, /слишком долго/);
  assert.equal(timed.timers[0].ms, 30000);
  timed.timers[0].callback();
  await rejected;
  assert.deepEqual(timed.revoked, timed.urls);
  assert.equal(timed.images[0].onload, null);
  lateLoad();
  assert.equal(timed.canvases.length, 0, "Late decoder still allocated photo canvases after timeout");
  assert.deepEqual(timed.revoked, timed.urls, "Late load completed a timed-out photo twice");
  console.log("Client photo checks passed: async JPEG, resize, invalid type/size, decode/canvas/encoding/read failures and timeout cleanup");
}
