let currentRecords = [];

const $ = (id) => document.getElementById(id);

function setStatus(id, message, kind = "") {
  const el = $(id);
  el.textContent = message;
  el.className = `status ${kind}`;
}

function getScope() {
  return document.querySelector("input[name='scope']:checked").value;
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function checkHealth() {
  try {
    const data = await api("/api/health");
    $("healthBadge").textContent = `Eagle build ${data.eagleBuild}`;
  } catch (err) {
    $("healthBadge").textContent = "Disconnected";
  }
}

function buildSidecarText(rec) {
  let tags = String(rec.sidecarText || "")
    .split(/\r?\n/)
    .map(t => t.trim())
    .filter(Boolean);

  if ($("prefixTags").checked) {
    tags = tags.map(t => t.includes(":") ? t : `eagle:${t}`);
  }

  if ($("includeUrl").checked && rec.url) {
    tags.push(`source:${rec.url}`);
  }

  if ($("includeRating").checked && Number(rec.star || 0) > 0) {
    tags.push(`rating:eagle_${rec.star}`);
  }

  const seen = new Set();
  return tags.filter(tag => {
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  }).join("\n");
}

async function loadItems() {
  setStatus("sourceStatus", "Loading items from Eagle…");
  try {
    const data = await api(`/api/items?scope=${encodeURIComponent(getScope())}`);
    currentRecords = data.records || [];
    renderRecords();
    const missing = currentRecords.filter(r => r.status !== "ready").length;
    const tagless = currentRecords.filter(r => !r.tagCount).length;

    let message = `Loaded ${currentRecords.length} ${data.scope === "all" ? "library" : "selected"} item(s).`;
    if (tagless) message += ` ${tagless} item(s) have no Eagle tags.`;
    setStatus("sourceStatus", message, missing ? "warn" : "good");
  } catch (err) {
    setStatus("sourceStatus", err.message, "bad");
  }
}

async function browseTarget() {
  try {
    const data = await api("/api/browse-target", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title: "Choose Hydrus pickup/import folder"})
    });
    if (data.folder) {
      $("targetFolder").value = data.folder;
      localStorage.setItem("hydrusBridgeTargetFolder", data.folder);
    }
  } catch (err) {
    setStatus("exportStatus", err.message, "bad");
  }
}

function recordFromRow(row) {
  const idx = Number(row.dataset.index);
  const base = currentRecords[idx];
  return {
    ...base,
    enabled: row.querySelector(".row-enabled").checked,
    outputFileName: row.querySelector(".output-file-name").value.trim(),
    sidecarName: row.querySelector(".sidecar-name").value.trim(),
    sidecarText: row.querySelector(".sidecar-text").value
  };
}

function getEditedRecords() {
  return Array.from(document.querySelectorAll("#recordsBody tr[data-index]")).map(recordFromRow);
}

function renderRecords() {
  const body = $("recordsBody");
  body.innerHTML = "";

  if (!currentRecords.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No records loaded.</td></tr>`;
    $("miniStats").textContent = "No records loaded";
    return;
  }

  let ready = 0;
  let tagless = 0;

  currentRecords.forEach((rec, idx) => {
    if (rec.status === "ready") ready++;
    if (!rec.tagCount) tagless++;

    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);

    const notes = rec.notes && rec.notes.length
      ? `<div class="notes">${rec.notes.map(escapeHtml).join("<br>")}</div>`
      : "";

    tr.innerHTML = `
      <td class="use-cell">
        <input class="row-enabled" type="checkbox" ${rec.status === "ready" ? "checked" : ""}>
      </td>
      <td>
        <div class="thumb-cell">
          <img class="thumb" loading="lazy" src="/api/thumbnail/${encodeURIComponent(rec.id)}" alt="">
          <div>
            <div class="file-name">${escapeHtml(rec.name || rec.fileName)}</div>
            <div class="file-path">${escapeHtml(rec.filePath || "No file path")}</div>
            <div class="file-path">${rec.tagCount} tag(s) · ${formatBytes(rec.size)}</div>
          </div>
        </div>
      </td>
      <td><input class="output-file-name" type="text" value="${escapeAttr(rec.outputFileName)}"></td>
      <td><input class="sidecar-name" type="text" value="${escapeAttr(rec.sidecarName)}"></td>
      <td><textarea class="sidecar-text" spellcheck="false">${escapeHtml(buildSidecarText(rec))}</textarea></td>
      <td><span class="pill ${escapeAttr(rec.status)}">${escapeHtml(rec.status)}</span>${notes}</td>
    `;

    body.appendChild(tr);
  });

  $("miniStats").textContent = `${currentRecords.length} rows · ${ready} ready · ${tagless} no tags`;
}

function rebuildSidecars() {
  const rows = Array.from(document.querySelectorAll("#recordsBody tr[data-index]"));
  rows.forEach(row => {
    const idx = Number(row.dataset.index);
    row.querySelector(".sidecar-text").value = buildSidecarText(currentRecords[idx]);
    const outputName = row.querySelector(".output-file-name").value.trim();
    if (outputName) row.querySelector(".sidecar-name").value = outputName + ".txt";
  });
  setStatus("exportStatus", "Sidecar text rebuilt from Eagle tags/options.", "good");
}

async function exportPairs() {
  const targetFolder = $("targetFolder").value.trim();
  localStorage.setItem("hydrusBridgeTargetFolder", targetFolder);

  let records = getEditedRecords().filter(r => r.enabled);
  if (!records.length) {
    setStatus("exportStatus", "No rows are selected for export.", "bad");
    return;
  }

  if ($("trashAfterCopy").checked) {
    const ok = confirm(
      "This will copy the selected image + sidecar pairs to your Hydrus folder, then move the exported Eagle items to Eagle's Trash. Continue?"
    );
    if (!ok) return;
  }

  setStatus("exportStatus", "Exporting selected image/sidecar pairs…");

  try {
    const data = await api("/api/export", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        targetFolder,
        overwrite: $("overwrite").checked,
        trashAfterCopy: $("trashAfterCopy").checked,
        records
      })
    });

    setStatus(
      "exportStatus",
      `Copied ${data.copied} pair(s). Skipped ${data.skipped}. Errors ${data.errors}. Trashed in Eagle ${data.trashed}.`,
      data.errors ? "warn" : "good"
    );

    const successfulIds = new Set((data.results || []).filter(r => r.ok).map(r => r.id));
    const successfulRecords = records.filter(r => successfulIds.has(r.id));
    await playExportPopups(successfulRecords);
  } catch (err) {
    setStatus("exportStatus", err.message, "bad");
  }
}

function selectRows(checked) {
  document.querySelectorAll(".row-enabled").forEach(cb => cb.checked = checked);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = n;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}


const exportFx = {
  z: 100,
  populateAudio: new Audio("/sfx/populate.wav"),
  bloopAudio: new Audio("/sfx/bloop.wav"),
  closeAudio: new Audio("/sfx/close.wav"),
  bgAudio: new Audio("/sfx/bg.wav"),
  wordDelayMs: 95,
  popupSpawnDelayMs: 1300
};

function playSfx(kind) {
  if (!$("playExportSounds")?.checked) return;

  let source = exportFx.bloopAudio;
  if (kind === "populate") source = exportFx.populateAudio;
  if (kind === "close") source = exportFx.closeAudio;
  if (!source) return;

  try {
    const audio = source.cloneNode();
    audio.volume = kind === "populate" ? 0.45 : kind === "close" ? 0.34 : 0.30;
    audio.play().catch(() => {});
  } catch (err) {}
}

function startBgAmbience() {
  if (!$("playBgAmbience")?.checked) return;
  const bg = exportFx.bgAudio;
  if (!bg) return;

  try {
    bg.loop = true;
    bg.volume = 0.18;
    bg.currentTime = 0;
    bg.play().catch(() => {});
  } catch (err) {}
}

function stopBgAmbience() {
  const bg = exportFx.bgAudio;
  if (!bg) return;

  try {
    bg.pause();
    bg.currentTime = 0;
  } catch (err) {}
}


function randomPopPosition(cardWidth = 250, cardHeight = 310) {
  const pad = 18;
  const w = Math.max(320, window.innerWidth);
  const h = Math.max(320, window.innerHeight);
  const maxX = Math.max(pad, w - cardWidth - pad);
  const maxY = Math.max(pad, h - cardHeight - pad);

  return {
    x: Math.floor(pad + Math.random() * Math.max(1, maxX - pad)),
    y: Math.floor(pad + Math.random() * Math.max(1, maxY - pad))
  };
}

function splitSidecarIntoWords(text) {
  return String(text || "")
    .split(/(\s+)/)
    .filter(part => part.length > 0);
}

function makeDraggable(card, handle) {
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  let active = false;

  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".export-pop-close")) return;
    active = true;
    card.classList.add("dragging");
    card.style.zIndex = String(++exportFx.z);
    startX = event.clientX;
    startY = event.clientY;
    baseX = parseFloat(card.style.left) || 0;
    baseY = parseFloat(card.style.top) || 0;
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!active) return;
    card.style.left = `${baseX + event.clientX - startX}px`;
    card.style.top = `${baseY + event.clientY - startY}px`;
  });

  const end = (event) => {
    if (!active) return;
    active = false;
    card.classList.remove("dragging");
    try { handle.releasePointerCapture(event.pointerId); } catch (err) {}
  };

  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

async function typeSidecarText(container, text) {
  container.textContent = "";
  const parts = splitSidecarIntoWords(text);

  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      container.append(document.createTextNode(part));
      continue;
    }

    const span = document.createElement("span");
    span.className = "export-pop-word";
    span.textContent = part;
    container.append(span);
    container.scrollTop = container.scrollHeight;
    playSfx("bloop");
    await sleep(exportFx.wordDelayMs);
  }
}

function createExportPopup(record, index) {
  const stage = $("exportStage");
  const card = document.createElement("article");
  card.className = "export-pop";
  card.style.zIndex = String(++exportFx.z);
  card.style.setProperty("--tilt", `${(Math.random() * 6 - 3).toFixed(2)}deg`);

  const pos = randomPopPosition();
  card.style.left = `${pos.x}px`;
  card.style.top = `${pos.y}px`;

  const imageUrl = `/api/thumbnail/${encodeURIComponent(record.id)}`;
  card.innerHTML = `
    <div class="export-pop-titlebar">
      <div class="export-pop-title">${escapeHtml(record.outputFileName || record.fileName || `Export ${index + 1}`)}</div>
      <button class="export-pop-close" title="Close popup">×</button>
    </div>
    <div class="export-pop-img-wrap">
      <img class="export-pop-img" src="${imageUrl}" alt="">
    </div>
    <div class="export-pop-text" aria-label="Exported sidecar text"></div>
  `;

  stage.appendChild(card);

  const handle = card.querySelector(".export-pop-titlebar");
  const close = card.querySelector(".export-pop-close");
  const textBox = card.querySelector(".export-pop-text");

  makeDraggable(card, handle);
  close.addEventListener("click", () => {
    playSfx("close");
    card.classList.add("fade-out");
    setTimeout(() => card.remove(), 420);
  });

  playSfx("populate");
  typeSidecarText(textBox, record.sidecarText || "").then(() => {
    card.classList.add("done");
    const keepPopupsControl = $("keepPopups");
    const shouldKeepPopups = !keepPopupsControl || keepPopupsControl.checked;
    if (!shouldKeepPopups) {
      setTimeout(() => {
        card.classList.add("fade-out");
        setTimeout(() => card.remove(), 420);
      }, 1800);
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function playExportPopups(records) {
  if (!$("showExportPopups")?.checked) return;
  const exported = records.filter(r => r.enabled !== false);
  if (!exported.length) return;

  startBgAmbience();

  for (let i = 0; i < exported.length; i++) {
    createExportPopup(exported[i], i);
    if (i < exported.length - 1) await sleep(exportFx.popupSpawnDelayMs);
  }
}

function clearExportPopups() {
  const stage = $("exportStage");
  if (stage && stage.children.length) playSfx("close");
  if (stage) stage.innerHTML = "";
  stopBgAmbience();
}

$("loadItems").addEventListener("click", loadItems);
$("browseTarget").addEventListener("click", browseTarget);
$("rebuildSidecars").addEventListener("click", rebuildSidecars);
$("exportPairs").addEventListener("click", exportPairs);
$("clearPopups").addEventListener("click", clearExportPopups);
$("selectAll").addEventListener("click", () => selectRows(true));
$("selectNone").addEventListener("click", () => selectRows(false));

const savedTarget = localStorage.getItem("hydrusBridgeTargetFolder");
if (savedTarget) $("targetFolder").value = savedTarget;

checkHealth();
loadItems();
