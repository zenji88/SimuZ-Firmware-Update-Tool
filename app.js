import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.4.3/bundle.js";

let device = null;
let transport = null;
let espLoader = null;

const files = {
  bootloader: { address: 0x0,     data: null, inputId: "fileBootloader", nameId: "nameBootloader" },
  partitions:  { address: 0x8000,  data: null, inputId: "filePartitions",  nameId: "namePartitions"  },
  firmware:    { address: 0x10000, data: null, inputId: "fileFirmware",    nameId: "nameFirmware"    },
};

const connectBtn    = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const flashBtn      = document.getElementById("flashBtn");
const statusBadge   = document.getElementById("statusBadge");
const progressWrap  = document.getElementById("progressWrap");
const progressBar   = document.getElementById("progressBar");
const logBox        = document.getElementById("logBox");

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

// Setup file inputs
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
    if (allFilesLoaded()) setStep("File", "done");
  });
}

function allFilesLoaded() {
  return Object.values(files).every(f => f.data !== null);
}

function updateFlashBtn() {
  flashBtn.disabled = !(espLoader && allFilesLoaded());
}

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
