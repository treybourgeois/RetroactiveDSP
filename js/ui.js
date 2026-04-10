function getStatusBar() {
  return document.getElementById("statusBar");
}

function getStatusMessage() {
  return document.getElementById("statusMessage");
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
}

export function setProgress(percent) {
  const bar = getStatusBar();
  if (!bar) return;

  const safePercent = Math.max(0, Math.min(100, percent));
  bar.style.width = `${safePercent}%`;
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