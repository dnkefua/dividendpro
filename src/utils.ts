// String to HSL color generator for consistent asset colors
export function getAssetColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a hue between 0 and 360
  const h = hash % 360;
  // Keep saturation high (70-90%) for vibrant colors, lightness medium (45-60%) for readability
  const s = 70 + (hash % 20);
  const l = 45 + (hash % 15);
  
  return `hsl(${h}, ${s}%, ${l}%)`;
}
