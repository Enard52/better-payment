const NAVIGATION_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * Return the provider tab that should receive focus for a horizontal tablist.
 * A null result means the key is unrelated and should keep its native behavior.
 */
export function nextProviderTabIndex(key, currentIndex, tabCount) {
  if (!NAVIGATION_KEYS.has(key) || tabCount < 1) return null;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  return (currentIndex - 1 + tabCount) % tabCount;
}
