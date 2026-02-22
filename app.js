import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.4.3/bundle.js";

let device = null;
let transport = null;
let espLoader = null;
let firmwareBytes = null;

const connectBtn    = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const flashBtn      = document.getElementById("flashBtn");
const firmwareInput = document.getElementById("firmware");
const fileNameEl    = document.getElementById("fileName");
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

connectBtn.addEventListener("click", async () => {
  if (!("serial" in navigator)) {
    log("Web Serial API non supportée. Utilise Chrome ou Edge.", "error");
    return;
  }
  try {
    device = await navigator.serial.requestPort();
    transport = new Transport(device, true);
    const loaderOptions = {
      transport,
      baudrate: 115200,
      terminal: {
        clean() {},
        writeLine: (data) => log(data, "info"),
        write:     (data) => log(data, "info"),
      },
      enableTracing: false,
    };
    log("Connexion en cours...", "info");
    espLoader = new ESPLoader(loaderOptions);
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

firmwareInput.addEventListener("change", async () => {
  const file = firmwareInput.files[0];
  if (!file) return;
  const ab = await file.arrayBuffer();
  firmwareBytes = new Uint8Array(ab);
  fileNameEl.textContent = file.name + " (" + (file.size / 1024).toFixed(1) + " KB)";
  fileNameEl.className = "file-name loaded";
  log("Fichier chargé : " + file.name + " (" + (file.size / 1024).toFixed(1) + " KB)", "success");
  if (espLoader) setStep("File", "done");
  setStep("Flash", "active");
  updateFlashBtn();
});

function updateFlashBtn() {
  flashBtn.disabled = !(espLoader && firmwareBytes);
}

flashBtn.addEventListener("click", async () => {
  if (!espLoader || !firmwareBytes) return;
  flashBtn.disabled = true;
  connectBtn.disabled = true;
  progressWrap.classList.add("visible");
  progressBar.style.width = "0%";
  progressBar.classList.remove("done");
  log("Démarrage du flash...", "info");
  try {
    await espLoader.flashId();
    const flashOptions = {
      fileArray: [{ data: firmwareBytes, address: 0x0 }],
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const pct = Math.round((written / total) * 100);
        progressBar.style.width = pct + "%";
        if (pct % 10 === 0) log("Progression : " + pct + "%", "info");
      },
      calculateMD5Hash: undefined,
    };
    await espLoader.writeFlash(flashOptions);
    progressBar.style.width = "100%";
    progressBar.classList.add("done");
    log("Flash terminé avec succès ! Redémarre ton ESP32.", "success");
    setStep("Flash", "done");
  } catch (err) {
    log("Erreur lors du flash : " + err.message, "error");
    progressBar.style.width = "0%";
  }
  flashBtn.disabled = false;
});
