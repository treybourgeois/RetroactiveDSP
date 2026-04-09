export async function loadFirmwareList() {
  const response = await fetch("firmware/manifest.json");

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.releases || [];
}