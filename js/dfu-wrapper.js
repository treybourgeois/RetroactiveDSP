let selectedDevice = null;

function toHex(value, width = 4) {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

export async function connectDevice() {
  if (!("usb" in navigator)) {
    throw new Error("WebUSB is not supported in this browser. Use Chrome or another Chromium-based browser.");
  }

  // STMicroelectronics VID. The STM32 DFU PID is commonly 0xDF11.
  // Using only vendorId makes the chooser a bit more forgiving.
  const filters = [
    { vendorId: 0x0483 }
  ];

  const device = await navigator.usb.requestDevice({ filters });

  await device.open();

  if (device.configuration === null) {
    await device.selectConfiguration(1);
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