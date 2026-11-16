// Remembers the garden the user last picked, in the browser's localStorage

// localStorage key for the selected garden
export const SELECTED_GARDEN_STORAGE_KEY = "smart-agri:selected-garden-id";

// Reads the saved garden id (null on the server or if none)
export function getSelectedGardenId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SELECTED_GARDEN_STORAGE_KEY);
}

// Saves the chosen garden id
export function setSelectedGardenId(gardenId: string) {
  window.localStorage.setItem(SELECTED_GARDEN_STORAGE_KEY, gardenId);
}
