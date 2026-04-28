function getStatusBar() {
  return document.getElementById("statusBar");
}

function getStatusMessage() {
  return document.getElementById("statusMessage");
}

function getStatusPercent() {
  return document.getElementById("statusPercent");
}

function getConnectionStatusPill() {
  return document.getElementById("connectionStatus");
}

export function clearStatus() {
  const bar = getStatusBar();
  const msg = getStatusMessage();

  if (bar) {
    bar.style.width = "0%";
  }

  if (msg) {
    msg.textContent = "";
    msg.className = "status-message idle";
  }

  const percent = getStatusPercent();
  if (percent) {
    percent.textContent = "0%";
  }
}

export function setProgress(percent) {
  const bar = getStatusBar();
  const msg = getStatusMessage();
  const percentEl = getStatusPercent();

  const safePercent = Math.max(0, Math.min(100, percent));
  if (bar) {
    bar.style.width = `${safePercent}%`;
  }

  if (percentEl) {
    percentEl.textContent = `${Math.round(safePercent)}%`;
  }

  if (msg && safePercent > 0 && safePercent < 100) {
    msg.textContent = "Flash in progress - do not disconnect.";
    msg.className = "status-message flashing";
  }
}

export function showSuccess(message = "👍 Flash successful.") {
  const msg = getStatusMessage();
  if (!msg) return;

  msg.textContent = message;
  msg.className = "status-message success";
}

export function showError(message) {
  const msg = getStatusMessage();
  if (!msg) return;

  msg.textContent = message;
  msg.className = "status-message error";
}

export function showIdle(message = "") {
  const msg = getStatusMessage();
  if (!msg) return;

  msg.textContent = message;
  msg.className = "status-message idle";
}

export function setFlashEnabled(enabled) {
  const flashBtn = document.getElementById("flashBtn");
  if (flashBtn) {
    flashBtn.disabled = !enabled;
  }
}

export function setBootloaderFlashEnabled(enabled) {
  const bootloaderBtn = document.getElementById("flashBootloaderBtn");
  if (bootloaderBtn) {
    bootloaderBtn.disabled = !enabled;
  }
}

export function setConnectionStatus(
  state = "disconnected",
  message = "Not connected"
) {
  const pill = getConnectionStatusPill();
  if (!pill) return;

  const normalizedState = state === "connected" ? "ready" : state;
  const allowedStates = new Set(["disconnected", "busy", "ready", "error"]);
  const safeState = allowedStates.has(normalizedState)
    ? normalizedState
    : "disconnected";

  pill.className = `status-pill ${safeState}`;

  const label = pill.querySelector(".connection-label");
  if (label) {
    label.textContent = message;
  }
}
