export function compactScannerValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function identifyScannerCommand(value, commands) {
  const scannedValue = compactScannerValue(value);
  if (!scannedValue) return null;

  for (const [commandName, commandValue] of Object.entries(commands)) {
    const compactCommand = compactScannerValue(commandValue);

    // Physical scanners may prepend an AIM identifier such as ]C1, add a
    // configured prefix/suffix, or omit punctuation when emulating a keyboard.
    if (compactCommand && scannedValue.includes(compactCommand)) {
      return commandName;
    }
  }

  return null;
}
