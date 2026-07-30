import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.4.3/bundle.js";

let device = null;
let transport = null;
let espLoader = null;

const SOFTWARE_CATALOG = {
  formula: {
    label: "Formula",
    versions: [{ label: "v1.0.0", bundle: "formula-v1.0.0.zip" }],
  },
  simple_emulator: {
    label: "Simple Emulator",
    versions: [{ label: "v1.0.0", bundle: "simple-emulator-v1.0.0.zip" }],
  },
  universal_beta: {
    label: "Universal (Beta)",
    versions: [{ label: "v0.9.0-beta", bundle: "universal-v0.9.0-beta.zip" }],
  },
  full_gt_beta: {
    label: "Full GT (Beta)",
    versions: [{ label: "v0.8.1-beta", bundle: "full-gt-v0.8.1-beta.zip" }],
  },
  custom: {
    label: "Flash My Custom Software",
    versions: [],
  },
};

let selectedSoftwareType = "";
let selectedSoftwareVersion = "";
let selectedBundleFilename = "";

const files = {
  bootloader: { address: 0x0, data: null },
  partitions: { address: 0x8000, data: null },
  firmware: { address: 0x10000, data: null },
};

const BUNDLE_FILES = [
  { key: "bootloader", filename: "bootloader.bin", address: 0x0 },
  { key: "partitions", filename: "partitions.bin", address: 0x8000 },
  { key: "firmware", filename: "firmware.bin", address: 0x10000 },
];

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const flashBtn = document.getElementById("flashBtn");
const statusBadge = document.getElementById("statusBadge");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const logBox = document.getElementById("logBox");
const softwareTypeSelect = document.getElementById("softwareType");
const softwareVersionSelect = document.getElementById("softwareVersion");
const selectedBundleNameEl = document.getElementById("selectedBundleName");
const bundleStatusEl = document.getElementById("bundleStatus");
const versionRow = document.getElementById("versionRow");
const fileBundleInput = document.getElementById("fileBundle");

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

async function uint8ArrayToBinaryString(uint8arr) {
  let binary = "";
  for (let i = 0; i < uint8arr.length; i++) binary += String.fromCharCode(uint8arr[i]);
  return binary;
}

function resetFiles() {
  Object.values(files).forEach((f) => (f.data = null));
  bundleStatusEl.innerHTML = "";
}

function allFilesLoaded() {
  return Object.values(files).every((f) => f.data !== null);
}

function updateFlashBtn() {
  flashBtn.disabled = !(espLoader && allFilesLoaded());
}

function setSelectedBundleInfo(text, loaded = false) {
  selectedBundleNameEl.textContent = text;
  selectedBundleNameEl.className = loaded ? "file-name loaded" : "file-name";
}

function populateVersionSelect(typeKey) {
  softwareVersionSelect.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "-- Sélectionner une version --";
  softwareVersionSelect.appendChild(defaultOpt);

  if (!typeKey || typeKey === "custom") {
    softwareVersionSelect.disabled = true;
    return;
  }

  for (const version of SOFTWARE_CATALOG[typeKey].versions) {
    const opt = document.createElement("option");
    opt.value = version.label;
    opt.textContent = version.label;
    softwareVersionSelect.appendChild(opt);
  }
  softwareVersionSelect.disabled = false;
}

function getSelectedBundleFilename() {
  if (!selectedSoftwareType || selectedSoftwareType === "custom" || !selectedSoftwareVersion) return "";
  const group = SOFTWARE_CATALOG[selectedSoftwareType];
  const version = group?.versions.find((v) => v.label === selectedSoftwareVersion);
  return version ? version.bundle : "";
}

softwareTypeSelect.addEventListener("change", () => {
  selectedSoftwareType = softwareTypeSelect.value;
  selectedSoftwareVersion = "";
  selectedBundleFilename = "";

  populateVersionSelect(selectedSoftwareType);
  versionRow.style.display = selectedSoftwareType === "custom" ? "none" : "";

  if (selectedSoftwareType === "custom") {
    setSelectedBundleInfo("Mode custom: choisis n'importe quel bundle .zip");
  } else {
    setSelectedBundleInfo("Aucun bundle sélectionné");
  }

  fileBundleInput.value = "";
  resetFiles();
  updateFlashBtn();
});

softwareVersionSelect.addEventListener("change", () => {
  selectedSoftwareVersion = softwareVersionSelect.value;
  selectedBundleFilename = getSelectedBundleFilename();

  if (selectedBundleFilename) {
    setSelectedBundleInfo(`Bundle attendu : ${selectedBundleFilename}`);
    log(`Type/version: ${SOFTWARE_CATALOG[selectedSoftwareType].label} / ${selectedSoftwareVersion}`, "info");
  } else {
    setSelectedBundleInfo("Aucun bundle sélectionné");
  }

  fileBundleInput.value = "";
  resetFiles();
  updateFlashBtn();
});

fileBundleInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Validation selon type
  if (!selectedSoftwareType) {
    log("Sélectionne d'abord un type de software.", "error");
    e.target.value = "";
    return;
  }

  if (selectedSoftwareType !== "custom") {
    if (!selectedSoftwareVersion || !selectedBundleFilename) {
      log("Sélectionne d'abord une version.", "error");
      e.target.value = "";
      return;
    }
    if (file.name !== selectedBundleFilename) {
      log(`Bundle invalide: ${file.name}. Attendu: ${selectedBundleFilename}`, "error");
      e.target.value = "";
      resetFiles();
      updateFlashBtn();
      return;
    }
  }

  resetFiles();
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
        label.textContent = `${entry.filename} (${(uint8.length / 1024).toFixed(1)} KB)`;
      } else {
        allOk = false;
        item.classList.add("error");
        check.textContent = "❌";
        label.textContent = `${entry.filename} — introuvable dans le zip`;
      }

      item.appendChild(badge);
      item.appendChild(check);
      item.appendChild(label);
      bundleStatusEl.appendChild(item);
    }

    if (allOk) {
      setSelectedBundleInfo(`✅ ${file.name} chargé`, true);
      setStep("File", "done");
      setStep("Flash", "active");
      log("Bundle valide et prêt à flasher.", "success");
    } else {
      log("Bundle incomplet: fichiers requis manquants.", "error");
    }

    updateFlashBtn();
  } catch (err) {
    log("Erreur lecture zip : " + err.message, "error");
  }
});

// ── Connect
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
        write: (data) => log(data, "info"),
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

// ── Disconnect
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

// ── Flash
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
    const fileArray = Object.values(files).map((f) => ({ data: f.data, address: f.address }));

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
  connectBtn.disabled = false;
});
