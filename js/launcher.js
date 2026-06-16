/* Hydrus Bridge Eagle launcher.
   This file runs inside Eagle's plugin window. It starts a localhost server,
   exposes Eagle item/tag/file operations to the browser GUI, then opens the
   default browser with eagle.shell.openExternal().
*/

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const url = require("url");
const { fileURLToPath } = require("url");
const crypto = require("crypto");

const HOST = "127.0.0.1";

function maybeFileUrlDir() {
  try {
    if (window.location && String(window.location.href).startsWith("file:")) {
      return path.dirname(fileURLToPath(window.location.href));
    }
  } catch (err) {}
  return "";
}

function hasBrowserUi(candidateRoot) {
  if (!candidateRoot) return false;
  return fs.existsSync(path.join(candidateRoot, "browser", "index.html"));
}

function findPluginRoot() {
  const candidates = [];

  // Depending on Eagle/Electron runtime details, __dirname may point to:
  // - the plugin root
  // - the js/ folder
  // - an Eagle internal working directory
  // So we test the filesystem instead of assuming.
  candidates.push(path.resolve(__dirname));
  candidates.push(path.resolve(__dirname, ".."));
  candidates.push(path.resolve(__dirname, "..", ".."));

  const fileDir = maybeFileUrlDir();
  candidates.push(fileDir);
  candidates.push(path.resolve(fileDir, ".."));

  candidates.push(process.cwd());
  candidates.push(path.resolve(process.cwd(), ".."));

  const unique = [...new Set(candidates.filter(Boolean))];

  for (const candidate of unique) {
    if (hasBrowserUi(candidate)) return candidate;
  }

  throw new Error(
    "Could not locate browser/index.html. Tried:\n" +
    unique.map(p => " - " + p).join("\n")
  );
}

const PLUGIN_ROOT = findPluginRoot();
const BROWSER_ROOT = path.join(PLUGIN_ROOT, "browser");

let server = null;
let serverUrl = null;
let cachedItems = new Map();

const $ = (id) => document.getElementById(id);

function setStatus(message) {
  $("status").textContent = message;
}

function setDetails(message) {
  $("details").textContent = message || "";
}

function jsonResponse(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sanitizeFileName(name) {
  return String(name || "untitled")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "untitled";
}

function safeSidecarText(tags) {
  const seen = new Set();
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .join("\n");
}

function shortId(id) {
  return String(id || "").slice(0, 8) || crypto.randomBytes(4).toString("hex");
}

function getBaseFileName(item) {
  if (item.filePath) return path.basename(item.filePath);
  const ext = item.ext ? "." + String(item.ext).replace(/^\./, "") : "";
  return sanitizeFileName(item.name || item.id) + ext;
}

function dedupeOutputNames(records) {
  const counts = new Map();
  for (const rec of records) {
    const key = rec.outputFileName.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const seen = new Map();
  for (const rec of records) {
    const key = rec.outputFileName.toLowerCase();
    if (counts.get(key) <= 1) continue;

    const current = (seen.get(key) || 0) + 1;
    seen.set(key, current);

    const parsed = path.parse(rec.outputFileName);
    rec.outputFileName = sanitizeFileName(`${parsed.name}__eagle-${shortId(rec.id)}${parsed.ext}`);
    rec.sidecarName = rec.outputFileName + ".txt";
    rec.notes.push("Duplicate output filename was made unique with Eagle ID.");
  }
}

function itemToRecord(item) {
  const outputFileName = sanitizeFileName(getBaseFileName(item));
  const notes = [];
  if (!item.filePath) notes.push("No filePath returned by Eagle.");
  if (!item.tags || !item.tags.length) notes.push("No Eagle tags on this item.");

  return {
    id: item.id,
    name: item.name || "",
    ext: item.ext || "",
    filePath: item.filePath || "",
    fileName: getBaseFileName(item),
    outputFileName,
    sidecarName: outputFileName + ".txt",
    thumbnailPath: item.thumbnailPath || "",
    tagCount: Array.isArray(item.tags) ? item.tags.length : 0,
    sidecarText: safeSidecarText(item.tags),
    url: item.url || "",
    annotation: item.annotation || "",
    star: item.star || 0,
    size: item.size || 0,
    status: item.filePath ? "ready" : "missing-path",
    notes
  };
}

async function getItems(scope) {
  let items;
  if (scope === "all") {
    items = await eagle.item.get({
      fields: [
        "id", "name", "ext", "tags", "url", "annotation", "star",
        "size", "filePath", "thumbnailPath", "thumbnailURL", "fileURL"
      ]
    });
  } else {
    items = await eagle.item.getSelected();
  }

  cachedItems.clear();
  for (const item of items) cachedItems.set(item.id, item);

  const records = items.map(itemToRecord);
  dedupeOutputNames(records);
  return records;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const table = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml; charset=utf-8",
    ".ico": "image/x-icon"
  };
  return table[ext] || "application/octet-stream";
}

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || "/");
  if (pathname === "/") pathname = "/index.html";

  // Make URL paths relative before joining. This avoids absolute-path weirdness
  // on Windows/macOS/Linux and inside Eagle's Electron runtime.
  pathname = pathname.replace(/^[/\\]+/, "");

  const filePath = path.normalize(path.join(BROWSER_ROOT, pathname));
  if (!isInside(filePath, BROWSER_ROOT)) {
    textResponse(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      textResponse(
        res,
        404,
        `Not found\n\nRequested: ${pathname}\nResolved: ${filePath}\nBrowser root: ${BROWSER_ROOT}\nPlugin root: ${PLUGIN_ROOT}`
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function chooseFolder(title) {
  const result = await eagle.dialog.showOpenDialog({
    title: title || "Choose folder",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return "";
  return result.filePaths[0];
}

async function ensureDirectory(folderPath) {
  const stat = await fsp.stat(folderPath);
  if (!stat.isDirectory()) throw new Error("Target path is not a folder.");
}

async function copyFilePair(record, targetFolder, overwrite) {
  const item = cachedItems.get(record.id) || await eagle.item.getById(record.id);
  if (!item || !item.filePath) throw new Error("Could not find Eagle item filePath.");

  const sourceFile = item.filePath;
  const outputFileName = sanitizeFileName(record.outputFileName || path.basename(sourceFile));
  const sidecarName = sanitizeFileName(record.sidecarName || `${outputFileName}.txt`);
  const targetImage = path.join(targetFolder, outputFileName);
  const targetSidecar = path.join(targetFolder, sidecarName);

  if (!overwrite) {
    const imageExists = fs.existsSync(targetImage);
    const sidecarExists = fs.existsSync(targetSidecar);
    if (imageExists || sidecarExists) {
      return {
        id: record.id,
        ok: false,
        skipped: true,
        reason: "target exists",
        targetImage,
        targetSidecar
      };
    }
  }

  await fsp.copyFile(sourceFile, targetImage);
  await fsp.writeFile(targetSidecar, String(record.sidecarText || "").replace(/\s+$/g, "") + "\n", "utf-8");

  return {
    id: record.id,
    ok: true,
    skipped: false,
    targetImage,
    targetSidecar
  };
}

async function handleApi(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      jsonResponse(res, 200, {
        ok: true,
        app: "Hydrus Bridge",
        eagleVersion: eagle.app.version,
        eagleBuild: eagle.app.build,
        platform: eagle.app.platform,
        pluginRoot: PLUGIN_ROOT,
        browserRoot: BROWSER_ROOT
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/items") {
      const scope = parsed.query.scope === "all" ? "all" : "selected";
      const records = await getItems(scope);
      jsonResponse(res, 200, { ok: true, scope, records });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/thumbnail/")) {
      const id = pathname.split("/").pop();
      const item = cachedItems.get(id) || await eagle.item.getById(id);
      if (!item) {
        textResponse(res, 404, "No item");
        return;
      }

      const thumbPath = item.thumbnailPath && fs.existsSync(item.thumbnailPath)
        ? item.thumbnailPath
        : item.filePath;

      if (!thumbPath || !fs.existsSync(thumbPath)) {
        textResponse(res, 404, "No thumbnail");
        return;
      }

      res.writeHead(200, {
        "Content-Type": contentTypeFor(thumbPath),
        "Cache-Control": "no-store"
      });
      fs.createReadStream(thumbPath).pipe(res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/browse-target") {
      const body = await readJsonBody(req);
      const folder = await chooseFolder(body.title || "Choose Hydrus pickup/import folder");
      jsonResponse(res, 200, { ok: true, folder });
      return;
    }

    if (req.method === "POST" && pathname === "/api/export") {
      const body = await readJsonBody(req);
      const targetFolder = String(body.targetFolder || "").trim();
      const overwrite = Boolean(body.overwrite);
      const trashAfterCopy = Boolean(body.trashAfterCopy);
      const records = Array.isArray(body.records) ? body.records : [];

      if (!targetFolder) throw new Error("Choose a target Hydrus pickup folder.");
      await ensureDirectory(targetFolder);
      if (!records.length) throw new Error("No records selected for export.");

      let copied = 0;
      let skipped = 0;
      let errors = 0;
      let trashed = 0;
      const results = [];

      for (const record of records) {
        if (record.enabled === false) continue;

        try {
          const result = await copyFilePair(record, targetFolder, overwrite);
          results.push(result);

          if (result.ok) {
            copied++;
            if (trashAfterCopy) {
              const item = cachedItems.get(record.id) || await eagle.item.getById(record.id);
              if (item && typeof item.moveToTrash === "function") {
                await item.moveToTrash();
                trashed++;
              }
            }
          } else if (result.skipped) {
            skipped++;
          }
        } catch (err) {
          errors++;
          results.push({
            id: record.id,
            ok: false,
            skipped: false,
            reason: err.message || String(err)
          });
        }
      }

      jsonResponse(res, 200, {
        ok: true,
        copied,
        skipped,
        errors,
        trashed,
        results
      });
      return;
    }

    textResponse(res, 404, "Unknown API route");
  } catch (err) {
    jsonResponse(res, 500, {
      ok: false,
      error: err.message || String(err)
    });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname || "/";
    if (pathname.startsWith("/api/")) {
      handleApi(req, res);
    } else {
      serveStatic(req, res);
    }
  });
}

async function startServer() {
  if (serverUrl) return serverUrl;

  server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });

  const address = server.address();
  serverUrl = `http://${HOST}:${address.port}/`;
  return serverUrl;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  serverUrl = null;
}

async function boot() {
  try {
    setStatus("Starting local browser GUI…");
    const openUrl = await startServer();

    $("openButton").disabled = false;
    $("stopButton").disabled = false;
    $("openButton").onclick = () => eagle.shell.openExternal(openUrl);
    $("stopButton").onclick = async () => {
      await stopServer();
      setStatus("Server stopped. Re-open the plugin to start again.");
      setDetails("");
      $("openButton").disabled = true;
      $("stopButton").disabled = true;
    };

    setStatus("Ready. Browser GUI opened.");
    setDetails(`Local GUI: ${openUrl}\nEagle ${eagle.app.version} build ${eagle.app.build}\nPlugin root: ${PLUGIN_ROOT}\nBrowser root: ${BROWSER_ROOT}`);

    await eagle.shell.openExternal(openUrl);
  } catch (err) {
    setStatus("Could not start Hydrus Bridge.");
    setDetails(err.stack || err.message || String(err));
  }
}

if (window.eagle && typeof eagle.onPluginCreate === "function") {
  eagle.onPluginCreate(() => boot());
} else {
  boot();
}

window.addEventListener("beforeunload", () => {
  if (server) {
    try { server.close(); } catch (err) {}
  }
});
