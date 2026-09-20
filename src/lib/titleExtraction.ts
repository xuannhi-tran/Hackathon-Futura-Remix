export function extractTitle(adText: string): string | undefined {
  const lines = adText
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^#+\s*/, ""))
    .filter(line => line.length > 0);

  if (lines.length === 0) return undefined;

  const openingLines = lines.slice(0, 5);

  const rolePattern = /\b(engineer|developer|analyst|scientist|designer|consultant|coordinator|manager|accountant|architect|specialist|administrator|technician|graduate|intern|nurse|doctor|officer|assistant|executive|director)\b/i;
  
  for (const line of openingLines) {
    if (line.length > 60) continue;
    
    if (/[.!?]$/.test(line)) continue;
    if (/^(we|our|the|this|are you|about)\b/i.test(line)) continue;

    if (rolePattern.test(line)) {
      return line;
    }
  }

  for (const line of openingLines) {
    if (line.length <= 60 && !/[.!?]$/.test(line) && !/^(we|our|the|this|about)\b/i.test(line)) {
      return line;
    }
  }

  return lines[0];
}
