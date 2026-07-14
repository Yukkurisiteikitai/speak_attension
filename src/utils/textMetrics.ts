export function isFullWidthChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x3000 && code <= 0x303f)
  );
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) units += isFullWidthChar(char) ? 1.0 : 0.62;
  return units * fontSize;
}
