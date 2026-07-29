import assert from "node:assert/strict";
import { identifyScannerCommand } from "../src/scannerCommands.js";

const commands = {
  checkout: "PBC-CMD-CHECKOUT",
  undo: "PBC-CMD-UNDO",
  cancel: "PBC-CMD-CANCEL",
};

const cases = [
  ["PBC-CMD-CHECKOUT", "checkout"],
  ["pbc-cmd-undo", "undo"],
  ["  PBC-CMD-CANCEL\r\n", "cancel"],
  ["]C1PBC-CMD-CHECKOUT\r", "checkout"],
  ["\u0002PBC-CMD-UNDO\u0003", "undo"],
  ["PBCCMDCANCEL", "cancel"],
  ["SCAN:PBC-CMD-CHECKOUT:END", "checkout"],
  ["ITEM1001", null],
  ["PBC-CMD", null],
  ["", null],
];

for (const [scannedValue, expected] of cases) {
  assert.equal(
    identifyScannerCommand(scannedValue, commands),
    expected,
    `Unexpected command match for ${JSON.stringify(scannedValue)}`
  );
}

console.log(`Scanner command parser passed ${cases.length} cases.`);
