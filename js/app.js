import { loadFirmwareList } from "./firmware.js";
import {
  clearStatus,
  setFlashEnabled,
  setBootloaderFlashEnabled,
  setProgress,
  showSuccess,
  showError
} from "./ui.js";
import { connectDevice, getConnectedDevice } from "./dfu-wrapper.js";

const BOOTLOADER_FILE = "Data/bootloader.bin";

async function fetchBinary(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Failed to fetch file: HTTP ${response.status}`);
  }

  return await response.arrayBuffer();
}

function findDfuInterfaceInfo(usbDevice) {
  if (!usbDevice.configuration || !usbDevice.configuration.interfaces) {
    throw new Error("Connected USB device has no active configuration.");
  }

  for (const iface of usbDevice.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const name = (alt.interfaceName || "").toLowerCase();
      const isDfuClass = alt.interfaceClass === 0xfe;
      const isDfuSubclass = alt.interfaceSubclass === 0x01;
      const looksLikeDfu =
        name.includes("dfu") ||
        name.includes("bootloader") ||
        name.includes("stm");

      if ((isDfuClass && isDfuSubclass) || looksLikeDfu) {
        return {
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          interfaceName:
            alt.interfaceName ||
            `Interface ${iface.interfaceNumber} Alt ${alt.alternateSetting}`
        };
      }
    }
  }

  throw new Error("No DFU-capable interface was found on the connected device.");
}

async function createDfuDevice(usbDevice) {
  if (!usbDevice.opened) {
    await usbDevice.open();
  }

  if (usbDevice.configuration === null) {
    await usbDevice.selectConfiguration(1);
  }

  const dfuInfo = findDfuInterfaceInfo(usbDevice);

  try {
    await usbDevice.claimInterface(dfuInfo.interfaceNumber);
  } catch (err) {
    // Ignore if already claimed
  }

  try {
    await usbDevice.selectAlternateInterface(
      dfuInfo.interfaceNumber,
      dfuInfo.alternateSetting
    );
  } catch (err) {
    // Ignore if already selected
  }

  const settings = {
    configuration: usbDevice.configuration.configurationValue,
    interface: dfuInfo.interfaceNumber,
    alternate: dfuInfo.alternateSetting,
    name: dfuInfo.interfaceName
  };

  const dfuDevice =
    typeof dfuse !== "undefined"
      ? new dfuse.Device(usbDevice, settings)
      : new dfu.Device(usbDevice, settings);

  await dfuDevice.open();
  return dfuDevice;
}

async function clearErrorStateIfNeeded(dfuDevice) {
  try {
    const status = await dfuDevice.getStatus();

    if (typeof dfu !== "undefined" && status.state === dfu.dfuERROR) {
      await dfuDevice.clearStatus();
    }
  } catch (err) {
    // Safe to continue if status read is unsupported
  }
}

async function flashBinaryFile(path) {
  const usbDevice = getConnectedDevice();

  if (!usbDevice) {
    throw new Error("No device connected. Click Connect first.");
  }

  clearStatus();
  setProgress(10);

  const binary = await fetchBinary(path);
  setProgress(35);

  const dfuDevice = await createDfuDevice(usbDevice);
  setProgress(55);

  await clearErrorStateIfNeeded(dfuDevice);
  setProgress(70);

  await dfuDevice.do_download(2048, binary, true);
  setProgress(100);
}

window.addEventListener("DOMContentLoaded", async () => {
  const firmwareSelect = document.getElementById("firmwareSelect");
  const connectBtn = document.getElementById("connectBtn");
  const flashBtn = document.getElementById("flashBtn");
  const flashBootloaderBtn = document.getElementById("flashBootloaderBtn");

  clearStatus();

  try {
    const firmwareList = await loadFirmwareList();

    firmwareSelect.innerHTML = "";

    firmwareList.forEach((fw) => {
      const option = document.createElement("option");
      option.value = fw.file;
      option.textContent = fw.name;
      firmwareSelect.appendChild(option);
    });
  } catch (err) {
    showError(`Failed to load firmware list: ${err.message}`);
  }

  connectBtn.addEventListener("click", async () => {
    try {
      clearStatus();
      const info = await connectDevice();

      // Keep UI quiet on success here.
      // Connection success only enables flashing buttons.
      if (info) {
        setFlashEnabled(true);
        setBootloaderFlashEnabled(true);
      }
    } catch (err) {
      showError(`Connection failed: ${err.message}`);
    }
  });

  flashBtn.addEventListener("click", async () => {
    try {
      flashBtn.disabled = true;
      flashBootloaderBtn.disabled = true;

      const firmwarePath = firmwareSelect.value;
      if (!firmwarePath) {
        throw new Error("No firmware selected.");
      }

      await flashBinaryFile(firmwarePath);
      showSuccess("👍 Firmware flashed successfully.");
    } catch (err) {
      setProgress(0);
      showError(`Flash failed: ${err.message}`);
    } finally {
      setFlashEnabled(true);
      setBootloaderFlashEnabled(true);
    }
  });

  flashBootloaderBtn.addEventListener("click", async () => {
    try {
      flashBtn.disabled = true;
      flashBootloaderBtn.disabled = true;

      await flashBinaryFile(BOOTLOADER_FILE);
      showSuccess("👍 Bootloader flashed successfully.");
    } catch (err) {
      setProgress(0);
      showError(`Bootloader flash failed: ${err.message}`);
    } finally {
      setFlashEnabled(true);
      setBootloaderFlashEnabled(true);
    }
  });
});