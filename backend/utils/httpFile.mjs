import fs from "node:fs";

// HTTP try/catch does not catch asynchronous ReadStream errors.
export function streamFile(response, filePath, headers = {}) {
  const fail = (error) => {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) { response.destroy(); return; }
    const status = ["ENOENT", "ENOTDIR", "EISDIR"].includes(error?.code) ? 404 : 500;
    const body = status === 404 ? "Файл не найден" : "Не удалось прочитать файл";
    response.writeHead(status, {
      ...headers, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
  };
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) { fail({ code: "EISDIR" }); return; }
  } catch (error) { fail(error); return; }
  let stream;
  try { stream = fs.createReadStream(filePath); } catch (error) { fail(error); return; }
  stream.once("error", fail);
  response.once("close", () => stream.destroy());
  stream.once("open", () => {
    if (response.destroyed) { stream.destroy(); return; }
    response.writeHead(200, { ...headers, "Content-Length": stat.size });
  });
  stream.pipe(response);
}
