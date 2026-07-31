import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.4.3/bundle.js";

let device = null;
let transport = null;
let espLoader = null;

const REPO = window.SIMUZ_REPO || {
  owner: "zenji88",
  repo: "SimuZ-Firmware-Update-Tool",
  branch: "main",
};

// Mapping type -> dossier
const TYPE_TO_FOLDER = {
  formula: "firmware/1-formula",
  simple_emulator: "firmware/2-simple-emulator",
  universal_beta: "firmware/3-universal-beta",
  full_gt_beta: "firmware/4-full-gt-beta",
};

const TYPE_LABELS = {
  formula: "1. Formula",
  simple_emulator: "2. Simple Emulator",
  universal_beta: "3. Universal (Beta)",
  full_gt_beta: "4. Full GT (Beta)",
  custom: "5. Flash My Custom Software",
};

let selectedSoftwareType = "";
let selectedSoftwareVersion = "";
let selectedBundleFilename = ""; // nom zip choisi
let loadedBundleFileName = "";   // nom zip réellement chargé

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
const versionRow = document.getElementById("versionRow");
const customZipPicker = document.getElementById("customZipPicker");
const fileBundleInput = document.getElementById("fileBundle");
const selectedBundleNameEl = document.getElementById("selectedBundleName");
const bundleStatusEl = document.getElementById("bundleStatus");

// État initial UI
versionRow.style.display = "";
customZipPicker.style.display = "none";

// cache des versions par type
const versionsCache = {
  formula: [],
  simple_emulator: [],
  universal_beta: [],
  full_gt_beta: [],
};

function log(msg, type = "default") {
  const span = document.createElement("span");
  span.className = type !== "default" ? `log-${type}` : "";
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logBox.appendChild(span);
  logBox.scrollTop = logBox.scrollHeight;
}

function setStep(step, state) {
  const el = document.getElementById(`step${step}`);
  if (!el) return;
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
  loadedBundleFileName = "";
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

function humanVersionFromFilename(filename) {
  return filename.replace(/\.zip$/i, "");
}

function sortVersionsDesc(filesList) {
  return [...filesList].sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
}

function buildApiContentsUrl(folderPath) {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURIComponent(folderPath).replace(/%2F/g, "/")}?ref=${encodeURIComponent(REPO.branch)}`;
}

function buildRawZipUrl(folderPath, zipName) {
  // URL raw fiable pour GitHub
  return `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${encodeURIComponent(REPO.branch).replace(/%2F/g, "/")}/${folderPath}/${encodeURIComponent(zipName)}`;
}

async function fetchZipListForFolder(folderPath) {
  const url = buildApiContentsUrl(folderPath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GitHub API ${res.status} sur ${folderPath}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item.type === "file" && /\.zip$/i.test(item.name))
    .map((item) => item.name);
}

async function loadVersionsForType(typeKey) {
  const folder = TYPE_TO_FOLDER[typeKey];
  if (!folder) return [];

  const zipNames = await fetchZipListForFolder(folder);
  const sorted = sortVersionsDesc(zipNames);

  versionsCache[typeKey] = sorted.map((zipName) => ({
    label: humanVersionFromFilename(zipName),
    bundle: zipName,
    folder,
  }));

  return versionsCache[typeKey];
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

  const versions = versionsCache[typeKey] || [];
  for (const version of versions) {
    const opt = document.createElement("option");
    opt.value = version.label;
    opt.textContent = version.label;
    softwareVersionSelect.appendChild(opt);
  }

  softwareVersionSelect.disabled = versions.length === 0;
}

function getSelectedVersionEntry() {
  if (!selectedSoftwareType || selectedSoftwareType === "custom" || !selectedSoftwareVersion) return null;
  const list = versionsCache[selectedSoftwareType] || [];
  return list.find((v) => v.label === selectedSoftwareVersion) || null;
}

function renderBundleItem(addressHex, fileLabel, ok, details = "") {
  const item = document.createElement("div");
  item.className = "bundle-item " + (ok ? "ok" : "error");

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = addressHex;

  const check = document.createElement("span");
  check.className = "check";
  check.textContent = ok ? "✅" : "❌";

  const label = document.createElement("span");
  label.textContent = details ? `${fileLabel} ${details}` : fileLabel;

  item.appendChild(badge);
  item.appendChild(check);
  item.appendChild(label);

  bundleStatusEl.appendChild(item);
}

async function parseZipArrayBuffer(arrayBuffer, displayName) {
  resetFiles();
  log("Lecture du bundle " + displayName + "...", "info");

  const zip = await JSZip.loadAsync(arrayBuffer);
  let allOk = true;

  for (const entry of BUNDLE_FILES) {
    const zipFile = zip.file(entry.filename);
    const addrHex = "0x" + entry.address.toString(16).padStart(4, "0").toUpperCase();

    if (zipFile) {
      const uint8 = await zipFile.async("uint8array");
      files[entry.key].data = await uint8ArrayToBinaryString(uint8);
      renderBundleItem(addrHex, entry.filename, true, `(${(uint8.length / 1024).toFixed(1)} KB)`);
      log(`Chargé [${addrHex}] : ${entry.filename}`, "success");
    } else {
      allOk = false;
      renderBundleItem(addrHex, `${entry.filename} — introuvable dans le zip`, false);
      log(`Manquant : ${entry.filename}`, "error");
    }
  }

  if (!allOk) {
    throw new Error("Bundle incomplet : fichiers requis manquants.");
  }

  loadedBundleFileName = displayName;
  setSelectedBundleInfo(`✅ ${displayName} chargé`, true);
  setStep("File", "done");
  setStep("Flash", "active");
  updateFlashBtn();
}

async function autoLoadSelectedFirmwareZip() {
  const entry = getSelectedVersionEntry();
  if (!entry) return;

  selectedBundleFilename = entry.bundle;
  const rawUrl = buildRawZipUrl(entry.folder, entry.bundle);

  setSelectedBundleInfo(`Téléchargement auto : ${entry.bundle}...`);
  log(`Téléchargement du bundle depuis ${entry.folder}/${entry.bundle}`, "info");

  try {
    const res = await fetch(rawUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} lors du téléchargement du zip`);

    const arrayBuffer = await res.arrayBuffer();
    await parseZipArrayBuffer(arrayBuffer, entry.bundle);

    log(`Bundle auto chargé : ${entry.bundle}`, "success");
  } catch (err) {
    resetFiles();
    setSelectedBundleInfo(`Erreur chargement auto (${entry.bundle})`);
    updateFlashBtn();
    log("Erreur chargement auto du bundle : " + err.message, "error");
  }
}

softwareTypeSelect.addEventListener("change", async () => {
  selectedSoftwareType = softwareTypeSelect.value;
  selectedSoftwareVersion = "";
  selectedBundleFilename = "";

  const isCustom = selectedSoftwareType === "custom";
  versionRow.style.display = isCustom ? "none" : "";
  customZipPicker.style.display = isCustom ? "" : "none";

  fileBundleInput.value = "";
  resetFiles();
  setStep("Flash", "");
  updateFlashBtn();

  if (!selectedSoftwareType) {
    softwareVersionSelect.innerHTML = `<option value="">-- Sélectionner une version --</option>`;
    softwareVersionSelect.disabled = true;
    setSelectedBundleInfo("Aucun bundle sélectionné");
    return;
  }

  if (isCustom) {
    softwareVersionSelect.innerHTML = `<option value="">-- Sélectionner une version --</option>`;
    softwareVersionSelect.disabled = true;
    setSelectedBundleInfo("Mode custom : choisis n'importe quel bundle .zip");
    return;
  }

  try {
    setSelectedBundleInfo("Chargement des versions...");
    softwareVersionSelect.disabled = true;
    softwareVersionSelect.innerHTML = `<option value="">Chargement...</option>`;

    const versions = await loadVersionsForType(selectedSoftwareType);
    populateVersionSelect(selectedSoftwareType);

    if (!versions.length) {
      setSelectedBundleInfo("Aucune version .zip trouvée dans le dossier.");
      log(`Aucun .zip trouvé dans ${TYPE_TO_FOLDER[selectedSoftwareType]}`, "error");
    } else {
      setSelectedBundleInfo("Sélectionne une version (chargement auto du zip).");
      log(`${versions.length} version(s) trouvée(s) pour ${TYPE_LABELS[selectedSoftwareType]}.`, "success");
    }
  } catch (err) {
    softwareVersionSelect.innerHTML = `<option value="">-- Erreur chargement --</option>`;
    softwareVersionSelect.disabled = true;
    setSelectedBundleInfo("Erreur de chargement des versions.");
    log("Erreur liste versions : " + err.message, "error");
  }
});

softwareVersionSelect.addEventListener("change", async () => {
  selectedSoftwareVersion = softwareVersionSelect.value;

  fileBundleInput.value = "";
  resetFiles();
  setStep("Flash", "");
  updateFlashBtn();

  const entry = getSelectedVersionEntry();
  if (!entry) {
    setSelectedBundleInfo("Sélectionne une version.");
    return;
  }

  setSelectedBundleInfo(`Version choisie : ${entry.label}`);
  log(`Type/version : ${TYPE_LABELS[selectedSoftwareType]} / ${entry.label}`, "info");

  // 🔥 Auto-download + auto-parse du zip
  await autoLoadSelectedFirmwareZip();
});

// Upload manuel réservé au type 5
fileBundleInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!selectedSoftwareType) {
    log("Sélectionne d'abord un type de software.", "error");
    e.target.value = "";
    return;
  }

  if (selectedSoftwareType !== "custom") {
    log("Le chargement manuel du .zip est réservé au type 5 (Custom).", "error");
    e.target.value = "";
    return;
  }

  try {
    await parseZipArrayBuffer(await file.arrayBuffer(), file.name);
    log("Bundle custom valide et prêt à flasher.", "success");
  } catch (err) {
    resetFiles();
    setSelectedBundleInfo("Erreur lecture bundle custom");
    updateFlashBtn();
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
  try {
    if (transport) await transport.disconnect();
  } catch (_) {}

  device = null;
  transport = null;
  espLoader = null;

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

    const fileArray = Object.values(files).map((f) => ({
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
  connectBtn.disabled = false;
  updateFlashBtn();
});
