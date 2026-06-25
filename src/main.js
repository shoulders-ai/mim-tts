const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const defaultHotkey = "CommandOrControl+Shift+Space";
const languageOptions = [
  ["auto", "Auto"],
  ["de", "DE"],
  ["en", "EN"],
  ["fr", "FR"],
  ["es", "ES"],
  ["it", "IT"],
  ["nl", "NL"],
  ["pl", "PL"],
  ["pt", "PT"],
  ["sv", "SV"],
];

const state = {
  recording: false,
  settings: null,
  models: [],
  downloadProgress: {},
  languageOpen: false,
};

const el = {};
let capturingHotkey = false;
let captureTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  el.panel = document.querySelector(".panel");
  el.statusLabel = document.querySelector("#status-label");
  el.statusDetail = document.querySelector("#status-detail");
  el.recordToggle = document.querySelector("#record-toggle");
  el.modelSelect = document.querySelector("#model-select");
  el.languageButton = document.querySelector("#language-button");
  el.languageValue = document.querySelector("#language-value");
  el.languageMenu = document.querySelector("#language-menu");
  el.languageList = document.querySelector("#language-list");
  el.hotkeyRecord = document.querySelector("#hotkey-record");
  el.hotkeyValue = document.querySelector("#hotkey-value");
  el.hotkeyAction = document.querySelector("#hotkey-action");
  el.modeHold = document.querySelector("#mode-hold");
  el.modeToggle = document.querySelector("#mode-toggle");
  el.autoPasteToggle = document.querySelector("#auto-paste-toggle");
  el.audioCuesToggle = document.querySelector("#audio-cues-toggle");
  el.muteToggle = document.querySelector("#mute-toggle");
  el.historyList = document.querySelector("#history-list");
  el.emptyHistory = document.querySelector("#empty-history");
  el.modelGate = document.querySelector("#model-gate");
  el.modelGateTitle = document.querySelector("#model-gate-title");
  el.modelGateDetail = document.querySelector("#model-gate-detail");
  el.modelDownloadButton = document.querySelector("#model-download-button");
  el.modelDownloadFill = document.querySelector("#model-download-fill");
  el.modelDownloadProgress = document.querySelector("#model-download-progress");

  renderLanguageOptions();

  el.recordToggle.addEventListener("click", toggleRecording);
  el.modelDownloadButton.addEventListener("click", downloadSelectedModel);
  el.modelSelect.addEventListener("change", selectModel);
  el.languageButton.addEventListener("click", toggleLanguageMenu);
  el.hotkeyRecord.addEventListener("click", startHotkeyCapture);
  el.modeHold.addEventListener("click", () => setActivationMode("hold"));
  el.modeToggle.addEventListener("click", () => setActivationMode("toggle"));
  el.autoPasteToggle.addEventListener("click", toggleAutoPaste);
  el.audioCuesToggle.addEventListener("click", toggleAudioCues);
  el.muteToggle.addEventListener("click", toggleMuteDuringRecording);
  document.getElementById("perm-mic")?.addEventListener("click", grantMicPermission);
  document.getElementById("perm-acc")?.addEventListener("click", grantAccessibilityPermission);

  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("click", closeLanguageMenuFromClick);
  window.addEventListener("blur", stopHotkeyCapture);
  window.addEventListener("focus", checkPermissions);
  window.addEventListener("beforeunload", () => {
    if (capturingHotkey) invoke("cancel_hotkey_capture");
  });

  await listen("recording-state", (event) => setStatus(event.payload.state, event.payload.message));
  await listen("history-changed", () => { refreshHistory(); refreshStats(); });
  await listen("settings-changed", (event) => applySettings(event.payload));
  await listen("hotkey-captured", (event) => {
    if (capturingHotkey) saveHotkey(event.payload.hotkey);
  });
  await listen("model-download-progress", (event) => {
    state.downloadProgress[event.payload.model] = event.payload;
    updateModelGate();
  });

  await boot();
});

async function boot() {
  state.recording = await invoke("is_recording");
  applySettings(await invoke("get_settings"));
  await refreshModels();
  await refreshHistory();
  await refreshStats();
  await checkPermissions();
  const selected = selectedModelStatus();
  setStatus(
    state.recording ? "recording" : "idle",
    state.recording ? "Recording" : selected?.installed ? "Ready" : "Download model",
  );
}

async function checkPermissions() {
  try {
    const perms = await invoke("check_permissions");
    state.permissions = perms;
    updatePermissionUI(perms);
  } catch (_) {
    state.permissions = { microphone: "authorized", accessibility: true };
  }
}

function updatePermissionUI(perms) {
  const bar = document.getElementById("permission-bar");
  const micChip = document.getElementById("perm-mic");
  const accChip = document.getElementById("perm-acc");
  if (!bar) return;

  const micOk = perms.microphone === "authorized";
  const accOk = perms.accessibility;

  bar.hidden = micOk && accOk;

  if (micChip) micChip.dataset.status = micOk ? "granted" : perms.microphone;
  if (accChip) accChip.dataset.status = accOk ? "granted" : "needed";
}

async function grantMicPermission() {
  const perms = state.permissions;
  if (perms?.microphone === "not_determined") {
    await invoke("request_mic_permission");
    setTimeout(checkPermissions, 1000);
  } else if (perms?.microphone === "denied" || perms?.microphone === "restricted") {
    await invoke("open_permission_settings", { pane: "microphone" });
  }
}

async function grantAccessibilityPermission() {
  await invoke("open_permission_settings", { pane: "accessibility" });
  setTimeout(checkPermissions, 2000);
}

async function toggleRecording() {
  if (state.recording) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const selected = selectedModelStatus();
    if (!selected?.installed) {
      setStatus("idle", "Download model");
      updateModelGate();
      return;
    }
    if (state.permissions?.microphone === "denied") {
      setStatus("idle", "Microphone access denied — open Settings to grant");
      return;
    }
    if (state.permissions?.microphone === "not_determined") {
      await invoke("request_mic_permission");
      setTimeout(checkPermissions, 1000);
      return;
    }
    await invoke("start_recording");
    state.recording = true;
    setStatus("recording", "Recording");
  } catch (error) {
    await refreshModels();
    setStatus("idle", String(error));
  }
}

async function stopRecording() {
  try {
    setStatus("transcribing", "Transcribing");
    const result = await invoke("stop_recording");
    state.recording = false;
    if (result.transcript?.text) {
      setStatus("done", result.message || "Done");
      setTimeout(() => setStatus("idle", selectedModelStatus()?.installed ? "Ready" : "Download model"), 1200);
      await refreshHistory();
    } else {
      setStatus("idle", result.message || "Ready");
    }
  } catch (error) {
    state.recording = false;
    setStatus("idle", String(error));
  }
}

async function selectModel() {
  try {
    applySettings(await invoke("set_model", { model: el.modelSelect.value }));
    await refreshModels();
    const selected = selectedModelStatus();
    setStatus("idle", selected?.installed ? "Ready" : "Download model");
  } catch (error) {
    setStatus("idle", String(error));
  }
}

async function setActivationMode(mode) {
  try {
    applySettings(await invoke("set_activation_mode", { mode }));
  } catch (error) {
    setStatus("idle", String(error));
  }
}

async function toggleAutoPaste() {
  try {
    const enabled = !(state.settings?.auto_paste ?? true);
    applySettings(await invoke("set_auto_paste", { enabled }));
  } catch (error) {
    setStatus("idle", String(error));
  }
}

async function toggleAudioCues() {
  try {
    const enabled = !(state.settings?.audio_cues ?? true);
    applySettings(await invoke("set_audio_cues", { enabled }));
  } catch (error) {
    setStatus("idle", String(error));
  }
}

async function toggleMuteDuringRecording() {
  try {
    const enabled = !(state.settings?.mute_during_recording ?? false);
    applySettings(await invoke("set_mute_during_recording", { enabled }));
  } catch (error) {
    setStatus("idle", String(error));
  }
}

function applySettings(settings) {
  state.settings = settings;
  el.modelSelect.value = settings.model;
  updateLanguageButton();
  updateLanguageOptions();
  updateHotkeyControls();
  updateModeControls();
  updateToggleControls();
  updateDetail();
  updateModelGate();
}

async function refreshModels() {
  state.models = await invoke("get_model_status");
  renderModelOptions();
  updateModelGate();
}

async function downloadSelectedModel() {
  const model = state.settings?.model || el.modelSelect.value;
  if (!model) return;

  try {
    state.downloadProgress[model] = { model, percent: 0, bytes: 0 };
    updateModelGate();
    await invoke("download_model", { model });
    delete state.downloadProgress[model];
    await refreshModels();
    setStatus("done", "Ready");
    setTimeout(() => setStatus("idle", "Ready"), 900);
  } catch (error) {
    delete state.downloadProgress[model];
    await refreshModels();
    setStatus("idle", String(error));
  }
}

async function refreshStats() {
  const el_stats = document.getElementById("dictation-stats");
  if (!el_stats) return;
  try {
    const s = await invoke("get_dictation_stats");
    if (s.session_count === 0) {
      el_stats.hidden = true;
      return;
    }
    const mins = Math.round(s.total_duration_ms / 60000);
    const wpm = Math.round(s.avg_wpm);
    el_stats.textContent = `30d: ${s.total_words} words · ${mins}m recorded · ${wpm} wpm`;
    el_stats.hidden = false;
  } catch (_) {
    el_stats.hidden = true;
  }
}

async function refreshHistory() {
  const items = await invoke("get_history");
  el.historyList.textContent = "";
  el.emptyHistory.style.display = items.length ? "none" : "grid";

  for (const item of items) {
    const row = document.createElement("button");
    row.className = "history-item";
    row.type = "button";
    row.title = "Copy transcription";
    row.setAttribute("aria-label", `Copy transcription: ${item.text}`);
    row.addEventListener("click", () => copyHistoryText(item.text, row));

    const text = document.createElement("div");
    text.className = "history-text";
    text.textContent = item.text;

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = timeAgo(item.created_at);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${item.language} · ${item.model} · ${(item.duration_ms / 1000).toFixed(1)}s`;

    row.append(text, time, meta);
    el.historyList.append(row);
  }
}

async function copyHistoryText(text, row) {
  try {
    await invoke("copy_text", { text });
    if (row) {
      row.dataset.state = "copied";
      setTimeout(() => {
        delete row.dataset.state;
      }, 800);
    }
    setStatus("done", "Copied");
    setTimeout(() => setStatus("idle", idleStatusMessage()), 900);
  } catch (error) {
    setStatus("idle", String(error));
  }
}

function renderLanguageOptions() {
  el.languageList.textContent = "";
  for (const [value, label] of languageOptions) {
    const option = document.createElement("button");
    option.className = "language-option";
    option.type = "button";
    option.role = "option";
    option.dataset.lang = value;
    option.textContent = label;
    option.addEventListener("click", () => selectLanguage(value));
    el.languageList.append(option);
  }
}

async function selectLanguage(value) {
  if (!state.settings) return;

  const selected = new Set(state.settings.languages || []);
  let langs = [];

  if (value !== "auto") {
    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }
    langs = [...selected].filter((lang) => lang !== "auto");
  }

  try {
    applySettings(await invoke("set_languages", { langs }));
  } catch (error) {
    setStatus("idle", String(error));
  }
}

function toggleLanguageMenu(event) {
  event.stopPropagation();
  setLanguageMenuOpen(!state.languageOpen);
}

function closeLanguageMenuFromClick(event) {
  if (!state.languageOpen) return;
  if (!event.target.closest(".language-picker")) {
    setLanguageMenuOpen(false);
  }
}

function setLanguageMenuOpen(open) {
  state.languageOpen = open;
  el.languageMenu.hidden = !open;
  el.languageButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function updateLanguageButton() {
  const summary = languageSummary(state.settings?.languages || []);
  el.languageValue.textContent = summary.short;
  el.languageButton.title = summary.full;
}

function updateLanguageOptions() {
  const selected = new Set(state.settings?.languages || []);
  const auto = selected.size === 0;
  for (const option of el.languageList.querySelectorAll(".language-option")) {
    const value = option.dataset.lang;
    const active = value === "auto" ? auto : selected.has(value);
    option.setAttribute("aria-selected", active ? "true" : "false");
  }
}

function languageSummary(langs) {
  if (!langs.length) return { short: "auto", full: "Auto detect" };
  const ordered = languageOptions
    .map(([value]) => value)
    .filter((value) => langs.includes(value) && value !== "auto");
  const short = ordered.length > 3 ? `${ordered.slice(0, 2).join("/")}/+${ordered.length - 2}` : ordered.join("/");
  return { short, full: ordered.join(", ") };
}

async function startHotkeyCapture() {
  if (capturingHotkey) {
    await stopHotkeyCapture();
    return;
  }

  try {
    capturingHotkey = true;
    clearTimeout(captureTimer);
    el.hotkeyValue.textContent = "Press keys";
    el.hotkeyAction.textContent = "Listening";
    el.hotkeyRecord.dataset.capturing = "true";
    el.hotkeyRecord.focus();
    await invoke("begin_hotkey_capture");
    captureTimer = setTimeout(() => {
      stopHotkeyCapture();
    }, 15000);
  } catch (error) {
    capturingHotkey = false;
    clearTimeout(captureTimer);
    captureTimer = null;
    updateHotkeyControls();
    setStatus("idle", String(error));
  }
}

async function stopHotkeyCapture() {
  if (!capturingHotkey) return;
  capturingHotkey = false;
  clearTimeout(captureTimer);
  captureTimer = null;
  await invoke("cancel_hotkey_capture");
  updateHotkeyControls();
}

async function saveHotkey(hotkey) {
  capturingHotkey = false;
  clearTimeout(captureTimer);
  captureTimer = null;
  await invoke("cancel_hotkey_capture");

  try {
    applySettings(await invoke("set_hotkey", { hotkey }));
    setStatus("done", "Ready");
    setTimeout(() => setStatus("idle", selectedModelStatus()?.installed ? "Ready" : "Download model"), 900);
  } catch (error) {
    updateHotkeyControls();
    setStatus("idle", String(error));
  }
}

async function handleKeydown(event) {
  if (capturingHotkey) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      await stopHotkeyCapture();
      return;
    }

    const hotkey = eventToHotkey(event);
    if (hotkey) await saveHotkey(hotkey);
    return;
  }

  if (event.key === "Escape") {
    if (state.languageOpen) {
      setLanguageMenuOpen(false);
    } else {
      invoke("hide_panel");
    }
  }
}

function updateHotkeyControls() {
  if (capturingHotkey) return;
  el.hotkeyValue.textContent = formatHotkey(state.settings?.hotkey || defaultHotkey);
  el.hotkeyAction.textContent = "Record";
  el.hotkeyRecord.dataset.capturing = "false";
}

function updateModeControls() {
  const mode = state.settings?.activation_mode || "hold";
  el.modeHold.setAttribute("aria-pressed", mode === "hold" ? "true" : "false");
  el.modeToggle.setAttribute("aria-pressed", mode === "toggle" ? "true" : "false");
}

function updateToggleControls() {
  el.autoPasteToggle.setAttribute("aria-pressed", state.settings?.auto_paste ? "true" : "false");
  el.audioCuesToggle.setAttribute("aria-pressed", state.settings?.audio_cues ? "true" : "false");
  el.muteToggle.setAttribute("aria-pressed", state.settings?.mute_during_recording ? "true" : "false");
}

function eventToHotkey(event) {
  const parts = [];
  if (event.metaKey) parts.push("CommandOrControl");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = normalizeKey(event.key);
  if (!key) return null;
  if (!parts.includes(key)) parts.push(key);
  return parts.join("+");
}

function normalizeKey(key) {
  if (!key || ["Meta", "Control", "Alt", "Shift"].includes(key)) return null;
  if (key === " ") return "Space";
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function setStatus(status, message) {
  const text = String(message || "Ready");
  el.panel.dataset.state = status;
  el.statusLabel.textContent = statusTitle(text);
  el.statusLabel.title = text;
  el.statusDetail.textContent = statusDetail(status, text);
}

function updateDetail() {
  if (!state.settings) return;
  if (el.panel.dataset.state === "idle") {
    el.statusDetail.textContent = "";
  }
}

function updateModelGate() {
  if (!el.modelGate || !state.settings) return;

  const selected = selectedModelStatus();
  const progress = state.downloadProgress[state.settings.model];
  const installed = selected?.installed;
  const percent = Math.max(0, Math.min(100, progress?.percent || 0));
  el.modelGate.hidden = Boolean(installed);
  el.recordToggle.disabled = !installed || Boolean(progress);
  el.recordToggle.title = installed ? "Record" : "Download model first";

  if (installed) {
    el.emptyHistory.hidden = false;
    el.historyList.hidden = false;
    el.modelDownloadFill.style.width = "0%";
    updateDetail();
    return;
  }

  const label = displayModelName(selected);
  el.modelGateTitle.textContent = progress ? `Downloading ${label}` : `Download ${label}`;
  el.modelGateDetail.textContent = progress ? "Keep the app open." : "Required once for local dictation.";
  el.modelDownloadButton.textContent = progress ? "Downloading" : "Download";
  el.modelDownloadButton.disabled = Boolean(progress);
  el.modelDownloadFill.style.width = progress ? `${percent}%` : "0%";
  el.modelDownloadProgress.textContent = progress
    ? `${Math.round(percent)}% · ${formatBytes(progress.bytes || 0)}`
    : selected
      ? `About ${formatBytes(selected.min_bytes)}`
      : "";
  el.emptyHistory.hidden = true;
  el.historyList.hidden = true;
  updateDetail();
}

function selectedModelStatus() {
  if (!state.settings) return null;
  return state.models.find((model) => model.id === state.settings.model) || null;
}

function renderModelOptions() {
  if (!state.settings || !state.models.length) return;

  const current = state.settings.model;
  el.modelSelect.textContent = "";
  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.id} · ${model.installed ? "ready" : "download"}`;
    el.modelSelect.append(option);
  }
  el.modelSelect.value = current;
}

function displayModelName(model) {
  return (model?.name || state.settings?.model || "Model").toLowerCase();
}

function statusTitle(message) {
  const text = String(message || "Ready");
  if (text === "Ready" || text === "Done") return "Mim TTS";
  if (text.startsWith("Pasted")) return "Pasted";
  if (text.startsWith("Copied")) return "Copied";
  if (text.includes("Accessibility permission")) return "Copied";
  if (text.includes("Download the")) return "Download model";
  if (text.length > 24) return "Needs attention";
  return text;
}

function statusDetail(status, message) {
  const text = String(message || "");
  if (text === "Ready" || text === "Done") return "";
  return text.length > 24 ? text : "";
}

function idleStatusMessage() {
  return selectedModelStatus()?.installed ? "Ready" : "Download model";
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1_000_000).toFixed(bytes > 100_000_000 ? 0 : 1)} MB`;
}

function formatHotkey(value) {
  return value.replace("CommandOrControl", "Command").replaceAll("+", "+");
}

function timeAgo(value) {
  const time = new Date(value).getTime();
  const diff = Math.max(0, Date.now() - time);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
