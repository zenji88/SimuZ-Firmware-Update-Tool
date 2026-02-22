import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.4.3/bundle.js";

let device = null;
let transport = null;
let espLoader = null;
let currentMode = "bundle"; // "bundle" or "manual"

const files = {
  bootloader: { address: 0x0,     data: null, inputId: "fileBootloader", nameId: "nameBootloader" },
  partitions:  { address: 0x8000,  data: null, inputId: "filePartitions",  nameId: "namePartitions"  },
  firmware:    { address: 0x10000, data: null, inputId: "fileFirmware",    nameId: "nameFirmware"    },
};

const BUNDLE_FILES = [
  { key: "bootloader", filename: "bootloader.bin", address: 0x0     },
  { key: "partitions", filename: "partitions.bin",  address: 0x8000  },
  { key: "firmware",   filename: "firmware.bin",    address: 0x10000 },
];

const connectBtn   = document.getElementById("connectBtn");
const disconnectBtn= document.getElementById("disconnectBtn");
const flashBtn     = document.getElementById("flashBtn");
const statusBadge  = document.getElementById("statusBadge");
const progressWrap = document.getElementById("progressWrap");
const progressBar  = document.getElementById("progressBar");
const logBox       = document.getElementById("logBox");

function log(msg, type = "default") {
  const span = document.createElement("span");
  span.className = type !== "default" ? `log-${type}` : "";
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logBox.appendChild(span);
  logBox.scrollTop = logBox.scrollHeight;
}

function setStep(step, state) {
  const el = document.getElementById(`step${step}`);
  el.classList.remove("active", "done");
  if (state) el.classList.add(state);
}

async function readFileAsBinaryString(file) {
  const ab = await file.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return binary;
}

async function uint8ArrayToBinaryString(uint8arr) {
  let binary = "";
  for (let i = 0; i < uint8arr.length; i++) {
    binary += String.fromCharCode(uint8arr[i]);
  }
  return binary;
}

// ── Tab switch ──────────────────────────────────────────────
window.switchTab = function(mode) {
  currentMode = mode;
  document.getElementById("modeBundle").style.display = mode === "bundle" ? "" : "none";
  document.getElementById("modeManual").style.display = mode === "manual" ? "" : "none";
  document.getElementById("tabBundle").classList.toggle("active", mode === "bundle");
  document.getElementById("tabManual").classList.toggle("active", mode === "manual");
  // Reset data when switching
  Object.values(files).forEach(f => f.data = null);
  updateFlashBtn();
};

// ── Bundle mode ─────────────────────────────────────────────
document.getElementById("fileBundle").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById("bundleStatus");
  statusEl.innerHTML = "";
  Object.values(files).forEach(f => f.data = null);

  log("Lecture du bundle " + file.name + "...", "info");

  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let allOk = true;

    for (const entry of BUNDLE_FILES) {
      const item = document.createElement("div");
      item.className = "bundle-item";

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "0x" + entry.address.toString(16).padStart(4, "0").toUpperCase();

      const check = document.createElement("span");
      check.className = "check";

      const label = document.createElement("span");

      const zipFile = zip.file(entry.filename);
      if (zipFile) {
        const uint8 = await zipFile.async("uint8array");
        files[entry.key].data = await uint8ArrayToBinaryString(uint8);
        item.classList.add("ok");
        check.textContent = "✅";
        label.textContent = entry.filename + " (" + (uint8.length / 1024).toFixed(1) + " KB)";
        log("Chargé [0x" + entry.address.toString(16) + "] : " + entry.filename, "success");
      } else {
        allOk = false;
        item.classList.add("error");
        check.textContent = "❌";
        label.textContent = entry.filename + " — introuvable dans le zip !";
        log("Manquant : " + entry.filename, "error");
      }

      item.appendChild(badge);
      item.appendChild(check);
      item.appendChild(label);
      statusEl.appendChild(item);
    }

    if (allOk) {
      setStep("File", "done");
      setStep("Flash", "active");
    }
    updateFlashBtn();

  } catch (err) {
    log("Erreur lecture zip : " + err.message, "error");
  }
});

// ── Manual mode ─────────────────────────────────────────────
for (const [key, f] of Object.entries(files)) {
  const input = document.getElementById(f.inputId);
  const nameEl = document.getElementById(f.nameId);
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    f.data = await readFileAsBinaryString(file);
    nameEl.textContent = "✅ " + file.name + " (" + (file.size / 1024).toFixed(1) + " KB)";
    nameEl.className = "file-name loaded";
    log("Chargé [0x" + f.address.toString(16) + "] : " + file.name, "success");
    updateFlashBtn();
    if (allFilesLoaded()) {
      setStep("File", "done");
      setStep("Flash", "active");
    }
  });
}

function allFilesLoaded() {
  return Object.values(files).every(f => f.data !== null);
}

function updateFlashBtn() {
  flashBtn.disabled = !(espLoader && allFilesLoaded());
}

// ── Connect ──────────────────────────────────────────────────
connectBtn.addEventListener("click", async () => {
  if (!("serial" in navigator)) {
    log("Web Serial API non supportée. Utilise Chrome ou Edge.", "error");
    return;
  }
  try {
    device = await navigator.serial.requestPort();
    transport = new Transport(device, true);
    espLoader = new ESPLoader({
      transport,
      baudrate: 115200,
      terminal: {
        clean() {},
        writeLine: (data) => log(data, "info"),
        write:     (data) => log(data, "info"),
      },
    });
    log("Connexion en cours...", "info");
    await espLoader.main();
    const chipName = espLoader.chip.CHIP_NAME;
    log("Connecté ! Puce détectée : " + chipName, "success");
    statusBadge.textContent = "✅ " + chipName;
    statusBadge.className = "status-badge connected";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    setStep("Connect", "done");
    setStep("File", "active");
    updateFlashBtn();
  } catch (err) {
    log("Erreur de connexion : " + err.message, "error");
  }
});

// ── Disconnect ───────────────────────────────────────────────
disconnectBtn.addEventListener("click", async () => {
  try { if (transport) await transport.disconnect(); } catch (_) {}
  device = null; transport = null; espLoader = null;
  statusBadge.textContent = "⚪ Non connecté";
  statusBadge.className = "status-badge disconnected";
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  flashBtn.disabled = true;
  setStep("Connect", "active");
  setStep("File", "");
  setStep("Flash", "");
  log("Déconnecté.", "info");
});

// ── Flash ────────────────────────────────────────────────────
flashBtn.addEventListener("click", async () => {
  if (!espLoader || !allFilesLoaded()) return;
  flashBtn.disabled = true;
  connectBtn.disabled = true;
  progressWrap.classList.add("visible");
  progressBar.style.width = "0%";
  progressBar.classList.remove("done");
  log("Démarrage du flash...", "info");
  try {
    await espLoader.flashId();
    const fileArray = Object.values(files).map(f => ({
      data: f.data,
      address: f.address,
    }));
    await espLoader.writeFlash({
      fileArray,
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const pct = Math.round((written / total) * 100);
        progressBar.style.width = pct + "%";
        const names = ["Bootloader", "Partitions", "Firmware"];
        if (pct % 20 === 0) log(names[fileIndex] + " : " + pct + "%", "info");
      },
      calculateMD5Hash: undefined,
    });
    progressBar.style.width = "100%";
    progressBar.classList.add("done");
    log("Flash terminé avec succès ! Redémarre ton ESP32. ✅", "success");
    setStep("Flash", "done");
  } catch (err) {
    log("Erreur lors du flash : " + err.message, "error");
    progressBar.style.width = "0%";
  }
  flashBtn.disabled = false;
});
