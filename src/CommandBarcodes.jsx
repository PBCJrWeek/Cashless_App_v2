import React, { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export default function CommandBarcodes({ commands }) {
  return (
    <section className="card stack command-sheet">
      <div>
        <h3>Scanner command barcodes</h3>
        <p className="muted">
          Print and place this sheet beside the register for scanner-only checkout.
        </p>
      </div>

      <div className="command-barcode-grid">
        <CommandBarcode
          label="Complete and charge order"
          value={commands.checkout}
        />
        <CommandBarcode label="Undo last scanned item" value={commands.undo} />
        <CommandBarcode label="Cancel current order" value={commands.cancel} />
      </div>

      <button type="button" className="print-command-button" onClick={() => window.print()}>
        Print command barcodes
      </button>
    </section>
  );
}

function CommandBarcode({ label, value }) {
  const barcodeRef = useRef(null);

  useEffect(() => {
    if (!barcodeRef.current) return;

    JsBarcode(barcodeRef.current, value, {
      format: "CODE128",
      width: 2,
      height: 72,
      margin: 10,
      displayValue: true,
      fontSize: 16,
    });
  }, [value]);

  return (
    <div className="command-barcode">
      <strong>{label}</strong>
      <svg ref={barcodeRef} aria-label={`${label}: ${value}`} />
    </div>
  );
}
