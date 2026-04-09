import { loadFirmwareList } from "./firmware.js";
import { logStatus, clearStatus, setFlashEnabled } from "./ui.js";
import { connectDevice } from "./dfu-wrapper.js";

window.addEventListener("DOMContentLoaded", async () => {
  const firmwareSelect = document.getElementById("firmwareSelect");
  const connectBtn = document.getElementById("connectBtn");
  const flashBtn = document.getElementById("flashBtn");

  clearStatus();
  logStatus("Page loaded.");

  try {
    const firmwareList = await loadFirmwareList();

    firmwareSelect.innerHTML = "";

    firmwareList.forEach((fw) => {
      const option = document.createElement("option");
      option.value = fw.file;
      option.textContent = fw.name;
      firmwareSelect.appendChild(option);
    });

    logStatus("Firmware list loaded.");
  } catch (err) {
    logStatus(`Failed to load firmware list: ${err.message}`);
  }

  connectBtn.addEventListener("click", async () => {
    try {
      logStatus("Requesting USB device...");
      const info = await connectDevice();

      logStatus(`Connected: ${info.productName}`);
      logStatus(`Manufacturer: ${info.manufacturerName}`);
      logStatus(`VID:PID = ${info.vendorId}:${info.productId}`);

      setFlashEnabled(true);
    } catch (err) {
      logStatus(`Connection failed: ${err.message}`);
    }
  });

  flashBtn.addEventListener("click", () => {
    logStatus("Connect works. Flashing comes next.");
  });
});