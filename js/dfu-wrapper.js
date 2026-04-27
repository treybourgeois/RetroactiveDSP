let selectedDevice = null;
const STM_VENDOR_ID = 0x0483;
const STM_DFU_PRODUCT_ID = 0xdf11;

function toHex(value, width = 4) {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function hasDfuInterface(usbDevice) {
  if (!usbDevice.configuration || !usbDevice.configuration.interfaces) {
    return false;
  }

  return usbDevice.configuration.interfaces.some((iface) =>
    iface.alternates.some(
      (alt) => alt.interfaceClass === 0xfe && alt.interfaceSubclass === 0x01
    )
  );
}

export async function connectDevice() {
  if (!("usb" in navigator)) {
    throw new Error("WebUSB is not supported in this browser. Use Chrome or another Chromium-based browser.");
  }

  // Prefer STM32 ROM DFU first, while still allowing manual Daisy bootloader selection.
  const filters = [
    { vendorId: STM_VENDOR_ID, productId: STM_DFU_PRODUCT_ID },
    { vendorId: STM_VENDOR_ID }
  ];

  const device = await navigator.usb.requestDevice({ filters });

  await device.open();

  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  const productName = (device.productName || "").toLowerCase();
  const looksLikeDaisyBootloader =
    productName.includes("daisy") || productName.includes("bootloader");
  const isStmRomDfu =
    device.vendorId === STM_VENDOR_ID && device.productId === STM_DFU_PRODUCT_ID;

  if (!isStmRomDfu && !looksLikeDaisyBootloader) {
    try {
      await device.close();
    } catch (closeErr) {
      // Ignore close failures.
    }

    throw new Error(
      `Selected device is not Daisy bootloader (VID 0x${toHex(STM_VENDOR_ID)}, PID 0x${toHex(STM_DFU_PRODUCT_ID)}). ` +
      "In the USB popup choose DAISY BOOTLOADER, not the external programmer."
    );
  }

  if (!hasDfuInterface(device)) {
    try {
      await device.close();
    } catch (closeErr) {
      // Ignore close failures.
    }

    throw new Error(
      "Selected USB device does not expose a DFU interface. Choose DAISY BOOTLOADER in the USB popup."
    );
  }

  selectedDevice = device;

  return {
    productName: device.productName || "Unknown USB Device",
    manufacturerName: device.manufacturerName || "Unknown Manufacturer",
    vendorId: `0x${toHex(device.vendorId)}`,
    productId: `0x${toHex(device.productId)}`
  };
}

export function getConnectedDevice() {
  return selectedDevice;
}
