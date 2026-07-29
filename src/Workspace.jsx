import React from "react";
import { formatMoneyFromCents, parseCurrencyToCents } from "./lib";
import CommandBarcodes from "./CommandBarcodes";

const ADMIN_WARNING = "Only use these features with direct permission from Adam";

export default function Workspace({
  scanner,
  camper,
  purchase,
  items,
}) {
  return (
    <>
      <MobileScanner {...scanner} />
      <SelectedCamper camper={camper.selected} />

      <div className="pos-layout">
        <CamperPanel {...camper} />
        <PurchasePanel {...purchase} selectedCamper={camper.selected} />
      </div>

      <section className="panel stack store-items-panel">
        <div>
          <h2>Store items</h2>
          <p className="muted">Choose an item to add it to the current order.</p>
        </div>
        <div className="items-list">
          {items.entries.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`list-button ${items.selectedId === item.id ? "selected" : ""}`}
              onClick={() => items.select(item.id)}
            >
              <span>{item.item_name}</span>
              <span>{formatMoneyFromCents(item.price_cents)}</span>
            </button>
          ))}
          {!items.entries.length ? <div className="empty">No store items yet.</div> : null}
        </div>
      </section>
    </>
  );
}

function MobileScanner({
  expanded,
  setExpanded,
  target,
  setTarget,
  active,
  start,
  stop,
  close,
  elementId,
}) {
  return (
    <section className="panel stack mobile-scanner">
      <div className="section-head">
        <div>
          <h2>Camera scanner</h2>
          <p className="muted">Open only when you need to scan with this device.</p>
        </div>
        <button
          type="button"
          onClick={() => (expanded ? close() : setExpanded(true))}
          aria-expanded={expanded}
        >
          {expanded ? "Close scanner" : "Open scanner"}
        </button>
      </div>

      {expanded ? (
        <>
          <div className="segmented">
            <button
              type="button"
              className={target === "camper" ? "active" : ""}
              onClick={() => setTarget("camper")}
            >
              Scan camper
            </button>
            <button
              type="button"
              className={target === "item" ? "active" : ""}
              onClick={() => setTarget("item")}
            >
              Scan item
            </button>
          </div>
          <div className="inline-form">
            <button type="button" onClick={start} disabled={active}>
              {active ? "Scanner running" : "Start camera"}
            </button>
            <button type="button" onClick={stop} disabled={!active}>
              Stop camera
            </button>
          </div>
          <div id={elementId} className="scanner-box" />
        </>
      ) : null}
    </section>
  );
}

function SelectedCamper({ camper }) {
  return (
    <section className="selected-camper-summary" aria-live="polite">
      {camper ? (
        <>
          <div>
            <div className="label">Selected camper</div>
            <div className="summary-name">{camper.full_name}</div>
            <div className="muted">
              {camper.camper_id} | {camper.cabin || "No cabin"}
            </div>
          </div>
          <div className="summary-balance">
            <div className="label">Current balance</div>
            <div className="value">{formatMoneyFromCents(camper.balance_cents)}</div>
          </div>
        </>
      ) : (
        <div>
          <div className="label">Selected camper</div>
          <div className="summary-name">Select a camper to begin</div>
          <div className="muted">Use the barcode field, search, or camper list below.</div>
        </div>
      )}
    </section>
  );
}

function CamperPanel({
  barcode,
  setBarcode,
  barcodeRef,
  findByBarcode,
  search,
  setSearch,
  filteredEntries,
  selectedId,
  select,
  admin,
  form,
  setForm,
  create,
  downloadTemplate,
  importRef,
  importCsv,
  saving,
}) {
  return (
    <section className="panel stack">
      <div>
        <h2>Camper lookup</h2>
        <p className="muted">Find and select the camper before making a purchase.</p>
      </div>

      <div className="inline-form">
        <label className="grow">
          Camper barcode
          <input
            ref={barcodeRef}
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findByBarcode(event.currentTarget.value);
              }
            }}
            placeholder="Scan or type camper barcode"
            autoFocus
          />
        </label>
        <button type="button" onClick={() => findByBarcode(barcode)}>
          Find camper
        </button>
      </div>

      <label>
        Search campers
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Camper ID, name, or cabin"
        />
      </label>

      <div className="table">
        <div className="thead">
          <div>ID</div>
          <div>Name</div>
          <div>Cabin</div>
          <div>Balance</div>
        </div>
        <div className="tbody">
          {filteredEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`row ${selectedId === entry.id ? "selected" : ""}`}
              onClick={() => select(entry.id)}
            >
              <div>{entry.camper_id}</div>
              <div>{entry.full_name}</div>
              <div>{entry.cabin || "-"}</div>
              <div>{formatMoneyFromCents(entry.balance_cents)}</div>
            </button>
          ))}
          {!filteredEntries.length ? <div className="empty">No campers found.</div> : null}
        </div>
      </div>

      <button
        type="button"
        className="admin-toggle"
        onClick={() => admin.setExpanded(!admin.expanded)}
        aria-expanded={admin.expanded}
      >
        {admin.expanded ? "Close camper administration" : "Camper administration"}
      </button>

      {admin.expanded ? (
        <div className="admin-menu stack">
          <div className="admin-warning">{ADMIN_WARNING}</div>
          <div className="inline-form wrap">
            <button type="button" onClick={() => admin.setShowForm(!admin.showForm)}>
              {admin.showForm ? "Close Add Camper" : "Add Camper"}
            </button>
            <button type="button" onClick={downloadTemplate}>
              Download CSV template
            </button>
            <button type="button" onClick={() => importRef.current?.click()} disabled={saving}>
              Import Campers CSV
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={importCsv}
            />
          </div>

          {admin.showForm ? (
            <form className="card stack" onSubmit={create}>
              <h3>Add Camper</h3>
              <div className="grid-2">
                <label>
                  Camper ID
                  <input
                    value={form.camper_id}
                    onChange={(event) => setForm({ ...form, camper_id: event.target.value })}
                    required
                  />
                </label>
                <label>
                  Cabin
                  <input
                    value={form.cabin}
                    onChange={(event) => setForm({ ...form, cabin: event.target.value })}
                  />
                </label>
              </div>
              <label>
                Full name
                <input
                  value={form.full_name}
                  onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                  required
                />
              </label>
              <label>
                Starting balance
                <input
                  value={form.starting_balance}
                  onChange={(event) => setForm({ ...form, starting_balance: event.target.value })}
                  placeholder="25.00"
                  required
                />
              </label>
              <button type="submit" disabled={saving}>
                Save camper
              </button>
            </form>
          ) : null}

          <div className="muted">
            CSV requires camper_id and full_name. Cabin, barcode_value, and starting_balance are
            optional.
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PurchasePanel({
  barcode,
  setBarcode,
  barcodeRef,
  findByBarcode,
  quickAmounts,
  chargeAmount,
  setChargeAmount,
  chargeNote,
  setChargeNote,
  applyTransaction,
  cartLines,
  cartTotalCents,
  cartItemCount,
  addCustomCharge,
  updateCartQuantity,
  undoLastCartItem,
  cancelOrder,
  completeOrder,
  commands,
  selectedCamper,
  saving,
  admin,
  depositAmount,
  setDepositAmount,
  depositNote,
  setDepositNote,
  downloadTemplate,
  importRef,
  importCsv,
  itemForm,
  setItemForm,
  createItem,
}) {
  const validCustomAmount =
    chargeAmount.trim() && parseCurrencyToCents(chargeAmount) > 0;

  return (
    <section className="panel stack">
      <div>
        <h2>Purchase</h2>
        <p className="muted">Scan each item to build one order, then complete the total charge.</p>
      </div>

      <div className="inline-form">
        <label className="grow">
          Item barcode
          <input
            ref={barcodeRef}
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findByBarcode(event.currentTarget.value);
              }
            }}
            placeholder="Scan or type item barcode"
          />
        </label>
        <button type="button" onClick={() => findByBarcode(barcode)}>
          Add item
        </button>
      </div>

      <div>
        <div className="label section-label">Quick charges</div>
        <div className="quick-grid">
          {quickAmounts.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => addCustomCharge(amount, `Quick charge ${formatMoneyFromCents(amount)}`)}
              disabled={saving || !selectedCamper}
            >
              Add {formatMoneyFromCents(amount)}
            </button>
          ))}
        </div>
      </div>

      <div className="cart-card stack" aria-live="polite">
        <div className="section-head">
          <div>
            <h3>Current order</h3>
            <p className="muted">
              {cartItemCount
                ? `${cartItemCount} item${cartItemCount === 1 ? "" : "s"} scanned`
                : "Scan the first item to begin."}
            </p>
          </div>
          <div className="cart-total">{formatMoneyFromCents(cartTotalCents)}</div>
        </div>

        <div className="cart-lines">
          {cartLines.map((line) => (
            <div className="cart-line" key={line.key}>
              <div>
                <strong>{line.label}</strong>
                <div className="muted">{formatMoneyFromCents(line.unitPriceCents)} each</div>
              </div>
              <div className="quantity-controls">
                <button
                  type="button"
                  className="small-button"
                  onClick={() => updateCartQuantity(line.key, -1)}
                  aria-label={`Remove one ${line.label}`}
                  disabled={saving}
                >
                  -
                </button>
                <strong>{line.quantity}</strong>
                <button
                  type="button"
                  className="small-button"
                  onClick={() => updateCartQuantity(line.key, 1)}
                  aria-label={`Add one ${line.label}`}
                  disabled={saving}
                >
                  +
                </button>
              </div>
              <strong>{formatMoneyFromCents(line.unitPriceCents * line.quantity)}</strong>
            </div>
          ))}
          {!cartLines.length ? <div className="empty">The current order is empty.</div> : null}
        </div>

        <div className="inline-form wrap">
          <button
            type="button"
            className="secondary-button"
            onClick={undoLastCartItem}
            disabled={saving || !cartLines.length}
          >
            Undo last item
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={cancelOrder}
            disabled={saving || (!selectedCamper && !cartLines.length)}
          >
            Cancel order
          </button>
        </div>
      </div>

      <div className="inline-form">
        <label className="grow">
          Custom amount
          <input
            value={chargeAmount}
            onChange={(event) => setChargeAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomCharge();
              }
            }}
            placeholder="3.50"
          />
        </label>
        <button
          type="button"
          onClick={() => addCustomCharge()}
          disabled={saving || !selectedCamper || !validCustomAmount}
        >
          Add to order
        </button>
      </div>

      <label>
        Optional transaction note
        <input
          value={chargeNote}
          onChange={(event) => setChargeNote(event.target.value)}
          placeholder="Canteen purchase"
        />
      </label>

      <div className="checkout-summary">
        <div>
          <div className="label">Order total</div>
          <div className="checkout-total">{formatMoneyFromCents(cartTotalCents)}</div>
        </div>
        <div className="command-help">
          Scanner checkout barcode: <code>{commands.checkout}</code>
        </div>
      </div>

      <button
        type="button"
        className="charge-button"
        onClick={completeOrder}
        disabled={saving || !selectedCamper || !cartLines.length}
      >
        {saving
          ? "Completing order..."
          : selectedCamper
            ? `Charge ${selectedCamper.full_name} ${formatMoneyFromCents(cartTotalCents)}`
            : "Select a camper to charge"}
      </button>

      <button
        type="button"
        className="admin-toggle"
        onClick={() => admin.setExpanded(!admin.expanded)}
        aria-expanded={admin.expanded}
      >
        {admin.expanded
          ? "Close deposits and item administration"
          : "Deposits and item administration"}
      </button>

      {admin.expanded ? (
        <div className="admin-menu stack">
          <div className="admin-warning">{ADMIN_WARNING}</div>
          <CommandBarcodes commands={commands} />
          <div className="card stack">
            <h3>Add deposit</h3>
            <div className="inline-form">
              <label className="grow">
                Deposit amount
                <input
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder="20.00"
                />
              </label>
              <label className="grow">
                Note
                <input value={depositNote} onChange={(event) => setDepositNote(event.target.value)} />
              </label>
            </div>
            <button
              type="button"
              onClick={() => applyTransaction("deposit", depositAmount, depositNote)}
              disabled={saving || !selectedCamper}
            >
              Save deposit
            </button>
          </div>

          <div className="inline-form wrap">
            <button type="button" onClick={downloadTemplate}>
              Download item CSV template
            </button>
            <button type="button" onClick={() => importRef.current?.click()} disabled={saving}>
              Import items CSV
            </button>
            <button type="button" onClick={() => admin.setShowForm(!admin.showForm)}>
              {admin.showForm ? "Close Add Item" : "Add Item"}
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={importCsv}
            />
          </div>

          {admin.showForm ? (
            <form className="card stack" onSubmit={createItem}>
              <h3>Add Item</h3>
              <label>
                Item name
                <input
                  value={itemForm.item_name}
                  onChange={(event) => setItemForm({ ...itemForm, item_name: event.target.value })}
                  required
                />
              </label>
              <div className="grid-2">
                <label>
                  Barcode
                  <input
                    value={itemForm.barcode_value}
                    onChange={(event) =>
                      setItemForm({ ...itemForm, barcode_value: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Price
                  <input
                    value={itemForm.price}
                    onChange={(event) => setItemForm({ ...itemForm, price: event.target.value })}
                    placeholder="2.50"
                    required
                  />
                </label>
              </div>
              <button type="submit" disabled={saving}>
                Save item
              </button>
            </form>
          ) : null}

          <div className="muted">Item CSV requires item_name, barcode_value, and price.</div>
        </div>
      ) : null}
    </section>
  );
}
