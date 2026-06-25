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
  permissions: null,
  downloadProgress: {},
  languageOpen: false,
  modelOpen: false,
  settingsOpen: false,
};

const el = {};
let capturingHotkey = false;
let captureTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  el.panel = document.querySelector(".panel");
  el.statusLabel = document.querySelector("#status-label");
  el.statusDetail = document.querySelector("#status-detail");
  el.recordToggle = document.querySelector("#record-toggle");
  el.settingsToggle = document.querySelector("#settings-toggle");
  el.settingsBody = document.querySelector("#settings-body");
  el.settingsDot = document.querySelector("#settings-dot");
  el.modelRow = document.querySelector("#model-row");
  el.modelButton = document.querySelector("#model-button");
  el.modelValue = document.querySelector("#model-value");
  el.modelMenu = document.querySelector("#model-menu");
  el.modelList = document.querySelector("#model-list");
  el.languageButton = document.querySelector("#language-button");
  el.languageValue = document.querySelector("#language-value");
  el.languageMenu = document.querySelector("#language-menu");
  el.languageList = document.querySelector("#language-list");
  el.hotkeyRecord = document.querySelector("#hotkey-record");
  el.hotkeyValue = document.querySelector("#hotkey-value");
  el.hotkeyAction = document.querySelector("#hotkey-action");
  el.modeHold = document.querySelector("#mode-hold");
  el.modeToggle = document.querySelector("#mode-toggle");
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

  el.settingsToggle.addEventListener("click", toggleSettings);
  el.recordToggle.addEventListener("click", toggleRecording);
  el.modelDownloadButton.addEventListener("click", downloadSelectedModel);
  el.modelButton.addEventListener("click", (e) => { e.stopPropagation(); const open = !state.modelOpen; closeAllDropdowns(); if (open) setModelMenuOpen(true); });
  el.languageButton.addEventListener("click", (e) => { e.stopPropagation(); const open = !state.languageOpen; closeAllDropdowns(); if (open) setLanguageMenuOpen(true); });
  el.hotkeyRecord.addEventListener("click", startHotkeyCapture);
  el.modeHold.addEventListener("click", () => setActivationMode("hold"));
  el.modeToggle.addEventListener("click", () => setActivationMode("toggle"));
  el.audioCuesToggle.addEventListener("click", toggleAudioCues);
  el.muteToggle.addEventListener("click", toggleMuteDuringRecording);
  document.getElementById("perm-mic")?.addEventListener("click", grantMicPermission);
  document.getElementById("perm-acc")?.addEventListener("click", grantAccessibilityPermission);

  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("click", closeDropdowns);
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

// ── Boot & settings collapse ─────────────────────────────────

async function boot() {
  state.recording = await invoke("is_recording");
  applySettings(await invoke("get_settings"));
  await refreshModels();
  await refreshHistory();
  await refreshStats();
  await checkPermissions();

  const selected = selectedModelStatus();
  const needsSetup = !selected?.installed || needsPermissionAttention();
  if (needsSetup) setSettingsOpen(true);

  setStatus(
    state.recording ? "recording" : "idle",
    state.recording ? "Recording" : selected?.installed ? "Ready" : "Download model",
  );
}

function toggleSettings() {
  setSettingsOpen(!state.settingsOpen);
}

function setSettingsOpen(open) {
  state.settingsOpen = open;
  el.settingsBody.hidden = !open;
  el.settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) {
    setModelMenuOpen(false);
    setLanguageMenuOpen(false);
  }
}

function updateSettingsDot() {
  const needs = needsPermissionAttention();
  el.settingsDot.hidden = !needs;
}

function needsPermissionAttention() {
  if (!state.permissions) return false;
  return state.permissions.microphone !== "authorized" || !state.permissions.accessibility;
}

// ── Permissions ──────────────────────────────────────────────

async function checkPermissions() {
  try {
    const perms = await invoke("check_permissions");
    state.permissions = perms;
    updatePermissionUI(perms);
    updateSettingsDot();
  } catch (_) {
    state.permissions = { microphone: "authorized", accessibility: true };
  }
}

function updatePermissionUI(perms) {
  const micRow = document.getElementById("perm-mic");
  const accRow = document.getElementById("perm-acc");
  if (micRow) {
    const ok = perms.microphone === "authorized";
    micRow.dataset.status = ok ? "granted" : perms.microphone;
    const b = micRow.querySelector(".perm-badge");
    if (b) b.textContent = ok ? "Granted" : perms.microphone === "not_determined" ? "Grant" : "Open Settings";
  }
  if (accRow) {
    const ok = perms.accessibility;
    accRow.dataset.status = ok ? "granted" : "needed";
    const b = accRow.querySelector(".perm-badge");
    if (b) b.textContent = ok ? "Granted" : "Open Settings";
  }
}

async function grantMicPermission() {
  const p = state.permissions;
  if (p?.microphone === "not_determined") {
    await invoke("request_mic_permission");
    setTimeout(checkPermissions, 1000);
  } else if (p?.microphone === "denied" || p?.microphone === "restricted") {
    await invoke("open_permission_settings", { pane: "microphone" });
  }
}

async function grantAccessibilityPermission() {
  await invoke("open_permission_settings", { pane: "accessibility" });
  setTimeout(checkPermissions, 2000);
}

// ── Recording ────────────────────────────────────────────────

async function toggleRecording() {
  if (state.recording) await stopRecording(); else await startRecording();
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
      setSettingsOpen(true);
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
      setTimeout(() => setStatus("idle", idleStatusMessage()), 1200);
      await refreshHistory();
    } else {
      setStatus("idle", result.message || "Ready");
    }
  } catch (error) {
    state.recording = false;
    setStatus("idle", String(error));
  }
}

// ── Model ────────────────────────────────────────────────────

function setModelMenuOpen(open) {
  state.modelOpen = open;
  el.modelMenu.hidden = !open;
  el.modelButton.setAttribute("aria-expanded", open ? "true" : "false");
}

async function selectModel(model) {
  setModelMenuOpen(false);
  try {
    applySettings(await invoke("set_model", { model }));
    await refreshModels();
    setStatus("idle", selectedModelStatus()?.installed ? "Ready" : "Download model");
  } catch (error) { setStatus("idle", String(error)); }
}

async function refreshModels() {
  state.models = await invoke("get_model_status");
  renderModelOptions();
  updateModelGate();
  updateModelRowHighlight();
}

function renderModelOptions() {
  if (!state.settings || !state.models.length) return;
  el.modelList.textContent = "";
  for (const model of state.models) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.role = "option";
    btn.dataset.model = model.id;
    btn.textContent = `${model.id} · ${model.installed ? "ready" : "download"}`;
    btn.addEventListener("click", () => selectModel(model.id));
    el.modelList.append(btn);
  }
  updateModelButton();
}

function updateModelButton() {
  if (!state.settings) return;
  const m = state.models.find((x) => x.id === state.settings.model);
  el.modelValue.textContent = m ? `${m.id} · ${m.installed ? "ready" : "download"}` : state.settings.model;
  for (const opt of el.modelList.querySelectorAll("button")) {
    opt.setAttribute("aria-selected", opt.dataset.model === state.settings.model ? "true" : "false");
  }
}

function updateModelRowHighlight() {
  const selected = selectedModelStatus();
  el.modelRow.dataset.needsAction = selected && !selected.installed ? "true" : "false";
}

// ── Language ─────────────────────────────────────────────────

function setLanguageMenuOpen(open) {
  state.languageOpen = open;
  el.languageMenu.hidden = !open;
  el.languageButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderLanguageOptions() {
  el.languageList.textContent = "";
  for (const [value, label] of languageOptions) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.role = "option";
    btn.dataset.lang = value; btn.textContent = label;
    btn.addEventListener("click", () => selectLanguage(value));
    el.languageList.append(btn);
  }
}

async function selectLanguage(value) {
  if (!state.settings) return;
  const selected = new Set(state.settings.languages || []);
  let langs = [];
  if (value !== "auto") {
    selected.has(value) ? selected.delete(value) : selected.add(value);
    langs = [...selected].filter((l) => l !== "auto");
  }
  try { applySettings(await invoke("set_languages", { langs })); }
  catch (error) { setStatus("idle", String(error)); }
}

function updateLanguageButton() {
  const summary = languageSummary(state.settings?.languages || []);
  el.languageValue.textContent = summary.short;
  el.languageButton.title = summary.full;
}

function updateLanguageOptions() {
  const selected = new Set(state.settings?.languages || []);
  const auto = selected.size === 0;
  for (const opt of el.languageList.querySelectorAll("button")) {
    const v = opt.dataset.lang;
    opt.setAttribute("aria-selected", (v === "auto" ? auto : selected.has(v)) ? "true" : "false");
  }
}

function languageSummary(langs) {
  if (!langs.length) return { short: "auto", full: "Auto detect" };
  const ordered = languageOptions.map(([v]) => v).filter((v) => langs.includes(v) && v !== "auto");
  const short = ordered.length > 3 ? `${ordered.slice(0,2).join("/")}/+${ordered.length-2}` : ordered.join("/");
  return { short, full: ordered.join(", ") };
}

// ── Hotkey ────────────────────────────────────────────────────

async function startHotkeyCapture() {
  if (capturingHotkey) { await stopHotkeyCapture(); return; }
  try {
    capturingHotkey = true;
    clearTimeout(captureTimer);
    el.hotkeyValue.textContent = "press keys…";
    el.hotkeyAction.textContent = "listening";
    el.hotkeyRecord.dataset.capturing = "true";
    el.hotkeyRecord.focus();
    await invoke("begin_hotkey_capture");
    captureTimer = setTimeout(stopHotkeyCapture, 15000);
  } catch (error) {
    capturingHotkey = false; clearTimeout(captureTimer); captureTimer = null;
    updateHotkeyControls(); setStatus("idle", String(error));
  }
}

async function stopHotkeyCapture() {
  if (!capturingHotkey) return;
  capturingHotkey = false; clearTimeout(captureTimer); captureTimer = null;
  await invoke("cancel_hotkey_capture");
  updateHotkeyControls();
}

async function saveHotkey(hotkey) {
  capturingHotkey = false; clearTimeout(captureTimer); captureTimer = null;
  await invoke("cancel_hotkey_capture");
  try {
    applySettings(await invoke("set_hotkey", { hotkey }));
    setStatus("done", "Ready");
    setTimeout(() => setStatus("idle", idleStatusMessage()), 900);
  } catch (error) { updateHotkeyControls(); setStatus("idle", String(error)); }
}

function updateHotkeyControls() {
  if (capturingHotkey) return;
  el.hotkeyValue.textContent = formatHotkey(state.settings?.hotkey || defaultHotkey);
  el.hotkeyAction.textContent = "rec";
  el.hotkeyRecord.dataset.capturing = "false";
}

// ── Mode & toggles ───────────────────────────────────────────

async function setActivationMode(mode) {
  try { applySettings(await invoke("set_activation_mode", { mode })); }
  catch (error) { setStatus("idle", String(error)); }
}

async function toggleAudioCues() {
  try { applySettings(await invoke("set_audio_cues", { enabled: !(state.settings?.audio_cues ?? true) })); }
  catch (error) { setStatus("idle", String(error)); }
}

async function toggleMuteDuringRecording() {
  try { applySettings(await invoke("set_mute_during_recording", { enabled: !(state.settings?.mute_during_recording ?? false) })); }
  catch (error) { setStatus("idle", String(error)); }
}

function updateModeControls() {
  const mode = state.settings?.activation_mode || "hold";
  el.modeHold.setAttribute("aria-pressed", mode === "hold" ? "true" : "false");
  el.modeToggle.setAttribute("aria-pressed", mode === "toggle" ? "true" : "false");
}

function updateToggleControls() {
  el.audioCuesToggle.setAttribute("aria-pressed", state.settings?.audio_cues ? "true" : "false");
  el.muteToggle.setAttribute("aria-pressed", state.settings?.mute_during_recording ? "true" : "false");
}

// ── Settings apply ───────────────────────────────────────────

function applySettings(settings) {
  state.settings = settings;
  updateModelButton();
  updateLanguageButton();
  updateLanguageOptions();
  updateHotkeyControls();
  updateModeControls();
  updateToggleControls();
  updateDetail();
  updateModelGate();
  updateModelRowHighlight();
}

// ── Stats ────────────────────────────────────────────────────

async function refreshStats() {
  const section = document.getElementById("stats-section");
  const row = document.getElementById("dictation-stats");
  if (!section || !row) return;
  try {
    const s = await invoke("get_dictation_stats");
    if (s.session_count === 0) { section.hidden = true; return; }
    const mins = Math.round(s.total_duration_ms / 60000);
    const wpm = Math.round(s.avg_wpm);
    row.textContent = `${s.total_words} words · ${mins}m recorded · ${wpm} words/min`;
    section.hidden = false;
  } catch (_) { section.hidden = true; }
}

// ── History ──────────────────────────────────────────────────

async function refreshHistory() {
  const items = await invoke("get_history");
  el.historyList.textContent = "";
  el.emptyHistory.style.display = items.length ? "none" : "grid";
  for (const item of items) {
    const row = document.createElement("button");
    row.className = "history-item"; row.type = "button";
    row.title = "Copy transcription";
    row.addEventListener("click", () => copyHistoryText(item.text, row));

    const text = document.createElement("div"); text.className = "history-text"; text.textContent = item.text;
    const time = document.createElement("div"); time.className = "history-time"; time.textContent = timeAgo(item.created_at);
    const meta = document.createElement("div"); meta.className = "history-meta";
    meta.textContent = `${item.language} · ${item.model} · ${(item.duration_ms / 1000).toFixed(1)}s`;
    row.append(text, time, meta);
    el.historyList.append(row);
  }
}

async function copyHistoryText(text, row) {
  try {
    await invoke("copy_text", { text });
    if (row) { row.dataset.state = "copied"; setTimeout(() => delete row.dataset.state, 800); }
    setStatus("done", "Copied");
    setTimeout(() => setStatus("idle", idleStatusMessage()), 900);
  } catch (error) { setStatus("idle", String(error)); }
}

// ── Model gate ───────────────────────────────────────────────

async function downloadSelectedModel() {
  const model = state.settings?.model;
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

function updateModelGate() {
  if (!el.modelGate || !state.settings) return;
  const selected = selectedModelStatus();
  const progress = state.downloadProgress[state.settings.model];
  const installed = selected?.installed;
  const pct = Math.max(0, Math.min(100, progress?.percent || 0));

  el.modelGate.hidden = Boolean(installed);
  el.recordToggle.disabled = !installed || Boolean(progress);
  el.recordToggle.title = installed ? "Record" : "Download model first";

  if (installed) {
    el.emptyHistory.hidden = false; el.historyList.hidden = false;
    el.modelDownloadFill.style.width = "0%"; updateDetail(); return;
  }

  const label = (selected?.name || state.settings.model).toLowerCase();
  el.modelGateTitle.textContent = progress ? `Downloading ${label}` : `Download ${label}`;
  el.modelGateDetail.textContent = progress ? "Keep the app open." : "Required once for local dictation.";
  el.modelDownloadButton.textContent = progress ? "Downloading" : "Download";
  el.modelDownloadButton.disabled = Boolean(progress);
  el.modelDownloadFill.style.width = progress ? `${pct}%` : "0%";
  el.modelDownloadProgress.textContent = progress
    ? `${Math.round(pct)}% · ${formatBytes(progress.bytes || 0)}`
    : selected ? `About ${formatBytes(selected.min_bytes)}` : "";
  el.emptyHistory.hidden = true; el.historyList.hidden = true; updateDetail();
}

function selectedModelStatus() {
  if (!state.settings) return null;
  return state.models.find((m) => m.id === state.settings.model) || null;
}

// ── Keyboard & dropdowns ─────────────────────────────────────

async function handleKeydown(event) {
  if (capturingHotkey) {
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { await stopHotkeyCapture(); return; }
    const hotkey = eventToHotkey(event);
    if (hotkey) await saveHotkey(hotkey);
    return;
  }
  if (event.key === "Escape") {
    if (state.languageOpen) setLanguageMenuOpen(false);
    else if (state.modelOpen) setModelMenuOpen(false);
    else invoke("hide_panel");
  }
}

function closeAllDropdowns() {
  if (state.languageOpen) setLanguageMenuOpen(false);
  if (state.modelOpen) setModelMenuOpen(false);
}

function closeDropdowns(event) {
  if (state.languageOpen && !event.target.closest(".language-picker")) setLanguageMenuOpen(false);
  if (state.modelOpen && !event.target.closest(".model-picker")) setModelMenuOpen(false);
}

// ── Helpers ──────────────────────────────────────────────────

function setStatus(status, message) {
  const text = String(message || "Ready");
  el.panel.dataset.state = status;
  el.statusLabel.textContent = statusTitle(text);
  el.statusLabel.title = text;
  el.statusDetail.textContent = statusDetail(status, text);
}

function updateDetail() {
  if (state.settings && el.panel.dataset.state === "idle") el.statusDetail.textContent = "";
}

function statusTitle(message) {
  const t = String(message || "Ready");
  if (t === "Ready" || t === "Done") return "Mim TTS";
  if (t.startsWith("Pasted")) return "Pasted";
  if (t.startsWith("Copied")) return "Copied";
  if (t.includes("Accessibility permission")) return "Copied";
  if (t.includes("Download the")) return "Download model";
  if (t.length > 24) return "Needs attention";
  return t;
}

function statusDetail(status, message) {
  const t = String(message || "");
  return (t === "Ready" || t === "Done") ? "" : t.length > 24 ? t : "";
}

function idleStatusMessage() { return selectedModelStatus()?.installed ? "Ready" : "Download model"; }

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
  if (!key || ["Meta","Control","Alt","Shift"].includes(key)) return null;
  if (key === " ") return "Space";
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  return key.length === 1 ? key.toUpperCase() : key;
}

function formatBytes(b) { return b ? `${(b/1e6).toFixed(b > 1e8 ? 0 : 1)} MB` : "0 MB"; }
function formatHotkey(v) { return v.replace("CommandOrControl", "Command").replaceAll("+", " + "); }
function timeAgo(v) {
  const d = Math.max(0, Date.now() - new Date(v).getTime());
  const s = Math.floor(d/1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s/60); if (m < 60) return `${m}m`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h`;
  return `${Math.floor(h/24)}d`;
}
