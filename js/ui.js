export function clearStatus() {
  const log = document.getElementById("statusLog");
  if (log) {
    log.textContent = "";
  }
}

export function logStatus(message) {
  const log = document.getElementById("statusLog");
  if (!log) return;

  const timestamp = new Date().toLocaleTimeString();
  log.textContent += `[${timestamp}] ${message}\n`;
  log.scrollTop = log.scrollHeight;
}

export function setFlashEnabled(enabled) {
  const flashBtn = document.getElementById("flashBtn");
  if (flashBtn) {
    flashBtn.disabled = !enabled;
  }
}