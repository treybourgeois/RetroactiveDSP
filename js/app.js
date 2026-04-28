import { loadFirmwareList } from "./firmware.js";
import {
  clearStatus,
  setFlashEnabled,
  setBootloaderFlashEnabled,
  setProgress,
  setConnectionStatus,
  showSuccess,
  showError
} from "./ui.js";
import { connectDevice, getConnectedDevice } from "./dfu-wrapper.js";

const BOOTLOADER_FILE =
  "firmware/stable/dsy_bootloader_v6_4-extdfu-2000ms_ripped.bin";
const DEFAULT_DFU_TRANSFER_SIZE = 1024;
const DOWNLOAD_PROGRESS_START = 70;
const DOWNLOAD_PROGRESS_END = 99;
const QSPI_INTERFACE_BASE_ADDRESS = 0x90000000;
const APP_FLASH_START_ADDRESS = 0x90040000;
const INTERNAL_FLASH_BASE_ADDRESS = 0x08000000;
const FLASH_TIMEOUT_MIN_MS = 180000;
const FLASH_TIMEOUT_MAX_MS = 600000;

function formatError(err) {
  if (err instanceof Error && err.message) {
    return err.message;
  }

  if (typeof err === "string") {
    return err;
  }

  if (err && typeof err === "object") {
    if (typeof err.message === "string" && err.message) {
      return err.message;
    }

    try {
      return JSON.stringify(err);
    } catch (jsonErr) {
      // fall through
    }
  }

  return String(err || "Unknown error");
}

function isRetriableDfuTransferError(err) {
  const msg = formatError(err).toLowerCase();
  return (
    msg.includes("controltransferin failed") ||
    msg.includes("controltransferout failed") ||
    msg.includes("transfer error has occurred")
  );
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function getFlashTimeoutMs(binaryBytes, transferSize) {
  const safeTransfer = Math.max(64, transferSize || DEFAULT_DFU_TRANSFER_SIZE);
  const estimatedChunks = Math.ceil(binaryBytes / safeTransfer);
  // Chunk transfer + polling + erase/manifest overhead.
  const estimatedMs = estimatedChunks * 120 + 90000;

  return Math.max(
    FLASH_TIMEOUT_MIN_MS,
    Math.min(FLASH_TIMEOUT_MAX_MS, estimatedMs)
  );
}

async function fetchBinary(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Failed to fetch file: HTTP ${response.status}`);
  }

  return await response.arrayBuffer();
}

function findDfuInterfaceInfo(usbDevice, mode = "app") {
  if (!usbDevice.configuration || !usbDevice.configuration.interfaces) {
    throw new Error("Connected USB device has no active configuration.");
  }

  const candidates = [];

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
        // Prefer true DfuSe memory-map interfaces (e.g. "@Internal Flash /0x08000000/...").
        // Those are required for address-aware downloads.
        let score = 0;
        if (isDfuClass && isDfuSubclass) score += 10;
        if (name.startsWith("@")) score += 8;
        if (mode === "bootloader") {
          if (name.includes("0x08000000")) score += 16;
          if (name.includes("internal flash")) score += 10;
          if (name.includes("0x90000000")) score -= 8;
          if (name.includes("qspi")) score -= 8;
        } else {
          if (name.includes("0x90000000")) score += 12;
          if (name.includes("qspi")) score += 10;
          if (name.includes("external flash")) score += 6;
          if (name.includes("0x08000000")) score += 2;
          if (name.includes("internal flash")) score += 1;
        }
        if (name.includes("dfu")) score += 2;
        if (name.includes("bootloader")) score += 1;

        candidates.push({
          score,
          configuration: usbDevice.configuration,
          interface: iface,
          alternate: alt,
          interfaceName: alt.interfaceName || null
        });
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  throw new Error("No DFU-capable interface was found on the connected device.");
}

async function createDfuDevice(usbDevice, mode = "app") {
  if (!usbDevice.opened) {
    await usbDevice.open();
  }

  if (usbDevice.configuration === null) {
    await usbDevice.selectConfiguration(1);
  }

  const dfuInfo = findDfuInterfaceInfo(usbDevice, mode);

  try {
    await usbDevice.claimInterface(dfuInfo.interface.interfaceNumber);
  } catch (err) {
    // Ignore if already claimed
  }

  try {
    await usbDevice.selectAlternateInterface(
      dfuInfo.interface.interfaceNumber,
      dfuInfo.alternate.alternateSetting
    );
  } catch (err) {
    // Ignore if already selected
  }

  const settings = {
    configuration: dfuInfo.configuration,
    interface: dfuInfo.interface,
    alternate: dfuInfo.alternate
  };

  if (dfuInfo.interfaceName) {
    settings.name = dfuInfo.interfaceName;
  }

  // Some browsers do not populate interfaceName in WebUSB alternates.
  // Recovering it allows DfuSe mode when the device exposes a memory map.
  if (
    !settings.name &&
    typeof dfu !== "undefined" &&
    typeof dfu.Device !== "undefined"
  ) {
    const tempDevice = new dfu.Device(usbDevice, settings);

    try {
      await tempDevice.open();
      const mapping = await tempDevice.readInterfaceNames();
      const cfg = settings.configuration.configurationValue;
      const intf = settings.interface.interfaceNumber;
      const alt = settings.alternate.alternateSetting;
      const recoveredName =
        mapping &&
        mapping[cfg] &&
        mapping[cfg][intf] &&
        mapping[cfg][intf][alt];

      if (recoveredName) {
        settings.name = recoveredName;
      }
    } catch (err) {
      // Continue without interface name recovery.
    } finally {
      try {
        await tempDevice.close();
      } catch (closeErr) {
        // Ignore close failures.
      }
    }
  }

  const hasDfuSeMemoryMap =
    typeof settings.name === "string" && settings.name.trim().startsWith("@");

  const dfuDevice =
    typeof dfuse !== "undefined" && hasDfuSeMemoryMap
      ? new dfuse.Device(usbDevice, settings)
      : new dfu.Device(usbDevice, settings);

  await dfuDevice.open();
  return dfuDevice;
}

async function getTransferOptions(dfuDevice) {
  let transferSize = DEFAULT_DFU_TRANSFER_SIZE;
  let manifestationTolerant = true;

  if (
    typeof dfu === "undefined" ||
    typeof dfu.parseConfigurationDescriptor === "undefined" ||
    typeof dfuDevice.readConfigurationDescriptor !== "function"
  ) {
    return { transferSize, manifestationTolerant };
  }

  try {
    const cfgValue = dfuDevice.settings.configuration.configurationValue || 1;
    const cfgIndex = Math.max(0, cfgValue - 1);
    const descriptor = await dfuDevice.readConfigurationDescriptor(cfgIndex);
    const parsed = dfu.parseConfigurationDescriptor(descriptor);

    for (const desc of parsed.descriptors || []) {
      if (desc.bDescriptorType === 0x21) {
        if (typeof desc.wTransferSize === "number" && desc.wTransferSize > 0) {
          transferSize = desc.wTransferSize;
        }

        if (typeof desc.bmAttributes === "number") {
          manifestationTolerant = (desc.bmAttributes & 0x04) !== 0;
        }
        break;
      }
    }
  } catch (err) {
    // Use defaults when descriptor probing fails.
  }

  transferSize = Math.max(64, Math.min(transferSize, 4096));
  return { transferSize, manifestationTolerant };
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

function bindDownloadProgress(dfuDevice) {
  const previousLogProgress = dfuDevice.logProgress
    ? dfuDevice.logProgress.bind(dfuDevice)
    : null;

  dfuDevice.logProgress = (done, total) => {
    if (typeof total === "number" && total > 0) {
      const ratio = Math.max(0, Math.min(1, done / total));
      const progress =
        DOWNLOAD_PROGRESS_START +
        ratio * (DOWNLOAD_PROGRESS_END - DOWNLOAD_PROGRESS_START);
      setProgress(Math.round(progress));
    }

    if (previousLogProgress) {
      previousLogProgress(done, total);
    }
  };
}

function configureDfuseStartAddressIfAvailable(dfuDevice, mode = "app") {
  if (
    typeof dfuse === "undefined" ||
    !(dfuDevice instanceof dfuse.Device) ||
    !dfuDevice.memoryInfo ||
    !Array.isArray(dfuDevice.memoryInfo.segments)
  ) {
    return;
  }

  const writableSegments = dfuDevice.memoryInfo.segments.filter(
    (segment) => segment.writable
  );

  if (writableSegments.length === 0) {
    return;
  }

  const preferredAddress =
    mode === "bootloader" ? INTERNAL_FLASH_BASE_ADDRESS : APP_FLASH_START_ADDRESS;
  const secondaryAddress =
    mode === "bootloader" ? APP_FLASH_START_ADDRESS : QSPI_INTERFACE_BASE_ADDRESS;

  let targetSegment = writableSegments.find(
    (segment) => segment.start <= preferredAddress && preferredAddress < segment.end
  );
  if (!targetSegment && secondaryAddress) {
    targetSegment = writableSegments.find(
      (segment) => segment.start <= secondaryAddress && secondaryAddress < segment.end
    );
  }

  if (!targetSegment) {
    targetSegment = writableSegments[0];
  }

  if (targetSegment.start <= preferredAddress && preferredAddress < targetSegment.end) {
    dfuDevice.startAddress = preferredAddress;
  } else {
    dfuDevice.startAddress = targetSegment.start;
  }
}

async function restartDeviceIfPossible(usbDevice) {
  if (!usbDevice || !usbDevice.opened) {
    return false;
  }

  try {
    await usbDevice.reset();
    return true;
  } catch (err) {
    return false;
  }
}

async function flashBinaryFile(path, mode = "app") {
  const usbDevice = getConnectedDevice();

  if (!usbDevice) {
    throw new Error("No device connected. Click Connect first.");
  }

  clearStatus();
  setProgress(10);

  const binary = await fetchBinary(path);
  setProgress(35);

  const dfuDevice = await createDfuDevice(usbDevice, mode);
  configureDfuseStartAddressIfAvailable(dfuDevice, mode);
  setProgress(55);

  await clearErrorStateIfNeeded(dfuDevice);
  setProgress(DOWNLOAD_PROGRESS_START);

  const transferOptions = await getTransferOptions(dfuDevice);
  bindDownloadProgress(dfuDevice);
  const flashTimeoutMs = getFlashTimeoutMs(
    binary.byteLength,
    transferOptions.transferSize
  );

  const preferredSize = transferOptions.transferSize;
  const fallbackSizes = [preferredSize, 1024, 512, 256]
    .map((n) => Math.max(64, Math.min(n, 4096)))
    .filter((n, idx, arr) => arr.indexOf(n) === idx);

  let lastError = null;
  for (let i = 0; i < fallbackSizes.length; i += 1) {
    const xferSize = fallbackSizes[i];

    try {
      await withTimeout(
        dfuDevice.do_download(
          xferSize,
          binary,
          transferOptions.manifestationTolerant
        ),
        flashTimeoutMs,
        "Timed out while waiting for the device to finish flashing."
      );
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (i === fallbackSizes.length - 1 || !isRetriableDfuTransferError(err)) {
        break;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  setProgress(100);
  return await restartDeviceIfPossible(usbDevice);
}

window.addEventListener("DOMContentLoaded", async () => {
  const firmwareSelect = document.getElementById("firmwareSelect");
  const connectBtn = document.getElementById("connectBtn");
  const flashBtn = document.getElementById("flashBtn");
  const flashBootloaderBtn = document.getElementById("flashBootloaderBtn");

  clearStatus();
  setConnectionStatus("disconnected", "Not connected");
  setFlashEnabled(false);
  setBootloaderFlashEnabled(false);

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
    showError(`Failed to load firmware list: ${formatError(err)}`);
  }

  connectBtn.addEventListener("click", async () => {
    setConnectionStatus("busy", "Waiting for device...");

    try {
      const info = await connectDevice("app");

      if (info) {
        setFlashEnabled(true);
        if (flashBootloaderBtn) {
          setBootloaderFlashEnabled(true);
        }
        setConnectionStatus("ready", "Connected");
      }
    } catch (err) {
      setConnectionStatus("error", "Connection failed");
      showError(`Connection failed: ${formatError(err)}`);
    }
  });

  flashBtn.addEventListener("click", async () => {
    try {
      flashBtn.disabled = true;
      if (flashBootloaderBtn) {
        flashBootloaderBtn.disabled = true;
      }

      const firmwarePath = firmwareSelect.value;
      if (!firmwarePath) {
        throw new Error("No firmware selected.");
      }

      const restarted = await flashBinaryFile(firmwarePath, "app");
      if (restarted) {
        showSuccess("👍 Firmware flashed successfully. Device restarting...");
      } else {
        showSuccess("👍 Firmware flashed successfully.");
      }
    } catch (err) {
      setProgress(0);
      showError(`Flash failed: ${formatError(err)}`);
    } finally {
      setFlashEnabled(true);
      if (flashBootloaderBtn) {
        setBootloaderFlashEnabled(true);
      }
    }
  });

  if (flashBootloaderBtn) {
    flashBootloaderBtn.addEventListener("click", async () => {
      try {
        flashBtn.disabled = true;
        flashBootloaderBtn.disabled = true;

        const restarted = await flashBinaryFile(BOOTLOADER_FILE, "bootloader");
        if (restarted) {
          showSuccess("👍 Bootloader flashed successfully. Device restarting...");
        } else {
          showSuccess("👍 Bootloader flashed successfully.");
        }
      } catch (err) {
        setProgress(0);
        showError(`Bootloader flash failed: ${formatError(err)}`);
      } finally {
        setFlashEnabled(true);
        setBootloaderFlashEnabled(true);
      }
    });
  }
});
