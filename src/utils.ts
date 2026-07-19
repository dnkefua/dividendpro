// String to HSL color generator for consistent asset colors
export function getAssetColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a hue between 0 and 360
  const h = hash % 360;
  // Keep saturation high (70-90%) for vibrant colors, lightness low-medium (25-40%) for readability with white text
  const s = 70 + (hash % 20);
  const l = 25 + (hash % 15);
  
  
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Format a number as currency based on a currency code
export function formatCurrency(amount: number, currencyCode: string = "USD", options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      ...options
    }).format(amount);
  } catch (e) {
    // Fallback if currency code is somehow invalid
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      ...options
    }).format(amount);
  }
}
