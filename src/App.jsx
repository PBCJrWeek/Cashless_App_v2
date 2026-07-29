import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  downloadCsv,
  formatDate,
  formatMoneyFromCents,
  normalizeError,
  parseCsvText,
  parseCurrencyToCents,
  supabase,
} from "./lib";
import { identifyScannerCommand } from "./scannerCommands";
import Workspace from "./Workspace";

const QUICK_AMOUNTS = [50, 100, 200, 300];
const SCANNER_COMMANDS = {
  checkout: "PBC-CMD-CHECKOUT",
  undo: "PBC-CMD-UNDO",
  cancel: "PBC-CMD-CANCEL",
};
const SCAN_DEBOUNCE_MS = 250;
const INITIAL_AUTH = { email: "", password: "" };
const INITIAL_CAMPER_FORM = {
  camper_id: "",
  full_name: "",
  cabin: "",
  starting_balance: "25.00",
};
const INITIAL_ITEM_FORM = {
  item_name: "",
  barcode_value: "",
  price: "",
};
const INITIAL_REPORT_FILTER = {
  type: "all",
  startDate: "",
  endDate: "",
};
function DevelopmentBanner() {
  return (
    <aside
      className="development-banner"
      role="status"
      aria-label="Development environment warning"
    >
      <strong>DEVELOPMENT VERSION — TEST DATA ONLY</strong>
      <span>Do not use this system for live camp transactions.</span>
    </aside>
  );
}
function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("sign-in");
  const [authForm, setAuthForm] = useState(INITIAL_AUTH);
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [campers, setCampers] = useState([]);
  const [items, setItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [cartLines, setCartLines] = useState([]);
  const [expandedOrderIds, setExpandedOrderIds] = useState([]);
  const [selectedCamperId, setSelectedCamperId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [search, setSearch] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("Canteen purchase");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote, setDepositNote] = useState("Deposit added");
  const [itemBarcodeInput, setItemBarcodeInput] = useState("");
  const [camperBarcodeInput, setCamperBarcodeInput] = useState("");
  const [appMessage, setAppMessage] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [savingAction, setSavingAction] = useState(false);

  const [showAddCamper, setShowAddCamper] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showCamperAdmin, setShowCamperAdmin] = useState(false);
  const [showPurchaseAdmin, setShowPurchaseAdmin] = useState(false);
  const [showMobileScanner, setShowMobileScanner] = useState(false);
  const [camperForm, setCamperForm] = useState(INITIAL_CAMPER_FORM);
  const [itemForm, setItemForm] = useState(INITIAL_ITEM_FORM);

  const [reportFilter, setReportFilter] = useState(INITIAL_REPORT_FILTER);
  const camperImportRef = useRef(null);
  const itemImportRef = useRef(null);
  const camperBarcodeRef = useRef(null);
  const itemBarcodeRef = useRef(null);
  const checkoutTokenRef = useRef(null);
  const lastItemScanRef = useRef({ value: "", time: 0 });
  const lastAddedCartKeyRef = useRef("");

  const [scannerTarget, setScannerTarget] = useState("camper");
  const [scannerActive, setScannerActive] = useState(false);
  const scannerRef = useRef(null);
  const scannerElementId = "barcode-scanner";

  useEffect(() => {
    let ignore = false;

    async function bootstrap() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (!ignore) {
        setSession(currentSession);
      }
    }

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
      stopScanner();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setCampers([]);
      setItems([]);
      setTransactions([]);
      setCartLines([]);
      setSelectedCamperId("");
      setSelectedItemId("");
      setCamperBarcodeInput("");
      setItemBarcodeInput("");
      setScannerActive(false);
      checkoutTokenRef.current = null;
      return;
    }

    refreshData();
  }, [session]);

  useEffect(() => {
    if (selectedCamperId) {
      window.requestAnimationFrame(() => itemBarcodeRef.current?.focus());
    }
  }, [selectedCamperId]);

  useEffect(() => {
    if (session && !loadingData && !selectedCamperId) {
      window.requestAnimationFrame(() => camperBarcodeRef.current?.focus());
    }
  }, [session, loadingData, selectedCamperId]);

  const filteredCampers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return campers;
    return campers.filter((camper) => {
      return (
        camper.camper_id.toLowerCase().includes(query) ||
        camper.full_name.toLowerCase().includes(query) ||
        (camper.cabin || "").toLowerCase().includes(query)
      );
    });
  }, [campers, search]);

  const selectedCamper =
    campers.find((camper) => camper.id === selectedCamperId) ?? null;

  const cartTotalCents = useMemo(
    () =>
      cartLines.reduce(
        (total, line) => total + line.unitPriceCents * line.quantity,
        0
      ),
    [cartLines]
  );

  const cartItemCount = useMemo(
    () => cartLines.reduce((total, line) => total + line.quantity, 0),
    [cartLines]
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const matchesType =
        reportFilter.type === "all" || transaction.transaction_type === reportFilter.type;

      const created = new Date(transaction.created_at);
      const matchesStart = reportFilter.startDate
        ? created >= new Date(`${reportFilter.startDate}T00:00:00`)
        : true;
      const matchesEnd = reportFilter.endDate
        ? created <= new Date(`${reportFilter.endDate}T23:59:59.999`)
        : true;

      return matchesType && matchesStart && matchesEnd;
    });
  }, [transactions, reportFilter]);

  const reportSummary = useMemo(() => {
    return filteredTransactions.reduce(
      (summary, transaction) => {
        if (transaction.transaction_type === "charge") {
          summary.chargeCount += 1;
          summary.chargeTotal += transaction.amount_cents;
        }
        if (transaction.transaction_type === "deposit") {
          summary.depositCount += 1;
          summary.depositTotal += transaction.amount_cents;
        }
        return summary;
      },
      {
        chargeCount: 0,
        chargeTotal: 0,
        depositCount: 0,
        depositTotal: 0,
      }
    );
  }, [filteredTransactions]);


  async function importCampersCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setSavingAction(true);
    setAppMessage("");

    try {
      const rows = parseCsvText(await file.text());
      if (!rows.length) {
        throw new Error("The camper CSV file is empty.");
      }

      const payload = rows.map((row, index) => {
        const camperId = String(row.camper_id ?? row.camperId ?? row.id ?? "").trim();
        const fullName = String(row.full_name ?? row.fullName ?? row.name ?? "").trim();
        const cabin = String(row.cabin ?? "").trim();
        const barcodeValue = String(row.barcode_value ?? row.barcode ?? camperId).trim();
        const balanceSource = row.balance ?? row.starting_balance ?? row.startingBalance ?? "0";
        const balanceCents = parseCurrencyToCents(balanceSource);

        if (!camperId || !fullName) {
          throw new Error(`Camper CSV row ${index + 2} is missing camper_id or full_name.`);
        }

        return {
          camper_id: camperId,
          full_name: fullName,
          cabin: cabin || null,
          barcode_value: barcodeValue || camperId,
          balance_cents: balanceCents,
          is_active: true,
        };
      });

      for (const [index, entry] of payload.entries()) {
        if (!Number.isFinite(entry.balance_cents) || entry.balance_cents < 0) {
          throw new Error(`Camper CSV row ${index + 2} has an invalid balance.`);
        }
      }

      const { error } = await supabase.from("campers").upsert(payload, {
        onConflict: "camper_id",
        ignoreDuplicates: false,
      });

      if (error) throw error;

      setAppMessage(`Imported ${payload.length} campers.`);
      await refreshData();
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not import campers CSV."));
    } finally {
      setSavingAction(false);
    }
  }

  async function voidTransaction(transactionId) {
    const confirmed = window.confirm(
      "Void this charge? This will add the amount back to the camper balance and keep an audit trail."
    );

    if (!confirmed) return;

    setSavingAction(true);
    setAppMessage("");

    try {
      const { data, error } = await supabase.rpc("void_charge_transaction", {
        p_transaction_id: transactionId,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        throw new Error(result?.message || "The transaction could not be voided.");
      }

      setAppMessage(result.message || "Transaction voided.");
      await refreshData();
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not void transaction."));
    } finally {
      setSavingAction(false);
    }
  }

  async function importItemsCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setSavingAction(true);
    setAppMessage("");

    try {
      const rows = parseCsvText(await file.text());
      if (!rows.length) {
        throw new Error("The store items CSV file is empty.");
      }

      const payload = rows.map((row, index) => {
        const itemName = String(row.item_name ?? row.itemName ?? row.name ?? "").trim();
        const barcodeValue = String(row.barcode_value ?? row.barcode ?? "").trim();
        const priceCents = parseCurrencyToCents(row.price ?? row.amount ?? "");

        if (!itemName || !barcodeValue) {
          throw new Error(`Store item CSV row ${index + 2} is missing item_name or barcode_value.`);
        }

        if (!Number.isFinite(priceCents) || priceCents <= 0) {
          throw new Error(`Store item CSV row ${index + 2} has an invalid price.`);
        }

        return {
          item_name: itemName,
          barcode_value: barcodeValue,
          price_cents: priceCents,
          is_active: true,
        };
      });

      const { error } = await supabase.from("store_items").upsert(payload, {
        onConflict: "barcode_value",
        ignoreDuplicates: false,
      });

      if (error) throw error;

      setAppMessage(`Imported ${payload.length} store items.`);
      await refreshData();
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not import store items CSV."));
    } finally {
      setSavingAction(false);
    }
  }

  function downloadCamperTemplate() {
    downloadCsv("campers-template.csv", [
      ["camper_id", "full_name", "cabin", "barcode_value", "starting_balance"],
      ["A101", "Emma Carter", "Pine", "A101", "25.00"],
      ["A102", "Noah Bennett", "Oak", "A102", "18.50"],
    ]);
  }

  function downloadItemTemplate() {
    downloadCsv("store-items-template.csv", [
      ["item_name", "barcode_value", "price"],
      ["Candy Bar", "9001001", "1.50"],
      ["Bracelet Kit", "9001002", "4.00"],
    ]);
  }


  async function refreshData() {
    setLoadingData(true);
    setAppMessage("");

    try {
      const [
        { data: campersData, error: campersError },
        { data: itemsData, error: itemsError },
        { data: transactionsData, error: transactionsError },
      ] = await Promise.all([
        supabase
          .from("campers")
          .select("id, camper_id, full_name, cabin, balance_cents, is_active, barcode_value")
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        supabase
          .from("store_items")
          .select("id, item_name, barcode_value, price_cents, is_active")
          .eq("is_active", true)
          .order("item_name", { ascending: true }),
        supabase
          .from("transactions")
          .select(
            "id, transaction_type, amount_cents, note, created_at, voided_at, order_id, campers(full_name, camper_id), store_items(item_name, barcode_value), orders(order_number, item_count, total_cents, status, note, order_items(id, item_name, barcode_value, unit_price_cents, quantity, line_total_cents))"
          )
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (campersError) throw campersError;
      if (itemsError) throw itemsError;
      if (transactionsError) throw transactionsError;

      setCampers(campersData ?? []);
      setItems(itemsData ?? []);
      setTransactions(transactionsData ?? []);
    } catch (error) {
      setAppMessage(normalizeError(error, "Failed to load camp data."));
    } finally {
      setLoadingData(false);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");

    try {
      if (authMode === "sign-up") {
        const { error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;
        setAuthMessage("Account created. Sign in if you do not receive an email confirmation.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;
      }
      setAuthForm(INITIAL_AUTH);
    } catch (error) {
      setAuthMessage(normalizeError(error, "Unable to sign in."));
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    await stopScanner();
    await supabase.auth.signOut();
  }

  async function createCamper(event) {
    event.preventDefault();
    setSavingAction(true);
    setAppMessage("");

    try {
      const startingBalanceCents = parseCurrencyToCents(camperForm.starting_balance);
      if (!Number.isFinite(startingBalanceCents) || startingBalanceCents < 0) {
        throw new Error("Enter a valid starting balance.");
      }

      const payload = {
        camper_id: camperForm.camper_id.trim(),
        full_name: camperForm.full_name.trim(),
        cabin: camperForm.cabin.trim() || null,
        barcode_value: camperForm.camper_id.trim(),
        balance_cents: startingBalanceCents,
      };

      const { error } = await supabase.from("campers").insert(payload);
      if (error) throw error;

      setCamperForm(INITIAL_CAMPER_FORM);
      setShowAddCamper(false);
      setAppMessage("Camper added.");
      await refreshData();
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not add camper."));
    } finally {
      setSavingAction(false);
    }
  }

  async function createItem(event) {
    event.preventDefault();
    setSavingAction(true);
    setAppMessage("");

    try {
      const priceCents = parseCurrencyToCents(itemForm.price);
      if (!Number.isFinite(priceCents) || priceCents <= 0) {
        throw new Error("Enter a valid item price.");
      }

      const payload = {
        item_name: itemForm.item_name.trim(),
        barcode_value: itemForm.barcode_value.trim(),
        price_cents: priceCents,
      };

      const { error } = await supabase.from("store_items").insert(payload);
      if (error) throw error;

      setItemForm(INITIAL_ITEM_FORM);
      setShowAddItem(false);
      setAppMessage("Store item added.");
      await refreshData();
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not add store item."));
    } finally {
      setSavingAction(false);
    }
  }

  async function applyTransaction(transactionType, rawAmount, note, itemId = null) {
    if (!selectedCamper) {
      setAppMessage("Select a camper first.");
      return;
    }

    const amountCents = parseCurrencyToCents(rawAmount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setAppMessage("Enter a valid amount greater than 0.");
      return;
    }

    setSavingAction(true);
    setAppMessage("");

    try {
      const { data, error } = await supabase.rpc("apply_camper_transaction", {
        p_camper_id: selectedCamper.id,
        p_transaction_type: transactionType,
        p_amount_cents: amountCents,
        p_note: note || null,
        p_item_id: itemId,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        throw new Error(result?.message || "The transaction could not be completed.");
      }

      if (transactionType === "charge") {
        setChargeAmount("");
      } else {
        setDepositAmount("");
      }

      setSelectedItemId("");
      setItemBarcodeInput("");
      setAppMessage(result.message || "Saved.");
      await refreshData();
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not save transaction."));
    } finally {
      setSavingAction(false);
    }
  }

  function markCartChanged() {
    checkoutTokenRef.current = null;
  }

  function focusCamperBarcode() {
    window.requestAnimationFrame(() => camperBarcodeRef.current?.focus());
  }

  function focusItemBarcode() {
    window.requestAnimationFrame(() => itemBarcodeRef.current?.focus());
  }

  function addItemToCart(item) {
    if (!selectedCamper) {
      setAppMessage("Scan or select a camper before adding items.");
      focusCamperBarcode();
      return false;
    }

    const key = `item:${item.id}`;
    markCartChanged();
    lastAddedCartKeyRef.current = key;
    setCartLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line
        );
      }

      return [
        ...current,
        {
          key,
          itemId: item.id,
          label: item.item_name,
          barcode: item.barcode_value,
          unitPriceCents: item.price_cents,
          quantity: 1,
          isCustom: false,
        },
      ];
    });

    setSelectedItemId(item.id);
    setItemBarcodeInput("");
    setAppMessage(`Added ${item.item_name} to the order.`);
    focusItemBarcode();
    return true;
  }

  function addCustomCharge(amountCents, label = "Custom charge") {
    if (!selectedCamper) {
      setAppMessage("Scan or select a camper before adding a charge.");
      focusCamperBarcode();
      return false;
    }

    const resolvedAmount =
      Number.isInteger(amountCents) && amountCents > 0
        ? amountCents
        : parseCurrencyToCents(chargeAmount);

    if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
      setAppMessage("Enter a valid custom amount greater than 0.");
      return false;
    }

    const key = `custom:${resolvedAmount}:${label}`;
    markCartChanged();
    lastAddedCartKeyRef.current = key;
    setCartLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line
        );
      }

      return [
        ...current,
        {
          key,
          itemId: null,
          label,
          barcode: null,
          unitPriceCents: resolvedAmount,
          quantity: 1,
          isCustom: true,
        },
      ];
    });

    setChargeAmount("");
    setAppMessage(`Added ${label} to the order.`);
    focusItemBarcode();
    return true;
  }

  function updateCartQuantity(key, adjustment) {
    markCartChanged();
    setCartLines((current) =>
      current
        .map((line) =>
          line.key === key
            ? { ...line, quantity: Math.max(0, line.quantity + adjustment) }
            : line
        )
        .filter((line) => line.quantity > 0)
    );
    focusItemBarcode();
  }

  function undoLastCartItem() {
    if (!cartLines.length) {
      setAppMessage("The current order is already empty.");
      focusItemBarcode();
      return false;
    }

    const preferredKey = lastAddedCartKeyRef.current;
    const line =
      cartLines.find((entry) => entry.key === preferredKey) ??
      cartLines[cartLines.length - 1];

    updateCartQuantity(line.key, -1);
    setAppMessage(`Removed one ${line.label} from the order.`);
    return true;
  }

  function resetOrderState() {
    setCartLines([]);
    setSelectedCamperId("");
    setSelectedItemId("");
    setCamperBarcodeInput("");
    setItemBarcodeInput("");
    setSearch("");
    setChargeAmount("");
    setChargeNote("Canteen purchase");
    checkoutTokenRef.current = null;
    lastAddedCartKeyRef.current = "";
  }

  function cancelOrder() {
    const camperName = selectedCamper?.full_name;
    resetOrderState();
    setAppMessage(
      camperName ? `Canceled ${camperName}'s order.` : "The current order was cleared."
    );
    focusCamperBarcode();
    return true;
  }

  async function completeOrder() {
    if (savingAction) return false;
    if (!selectedCamper) {
      setAppMessage("Scan or select a camper before checkout.");
      focusCamperBarcode();
      return false;
    }
    if (!cartLines.length || cartTotalCents <= 0) {
      setAppMessage("Add at least one item before checkout.");
      focusItemBarcode();
      return false;
    }

    setSavingAction(true);
    setAppMessage("");

    if (!checkoutTokenRef.current) {
      checkoutTokenRef.current = globalThis.crypto.randomUUID();
    }

    try {
      const { data, error } = await supabase.rpc("complete_camper_order", {
        p_camper_id: selectedCamper.id,
        p_lines: cartLines.map((line) => ({
          item_id: line.itemId,
          quantity: line.quantity,
          custom_amount_cents: line.isCustom ? line.unitPriceCents : null,
          label: line.label,
        })),
        p_note: chargeNote || null,
        p_checkout_token: checkoutTokenRef.current,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        throw new Error(result?.message || "The order could not be completed.");
      }

      const successMessage =
        result.message ||
        `Order #${result.order_number} charged ${formatMoneyFromCents(
          result.total_cents
        )}.`;

      resetOrderState();
      await refreshData();
      setAppMessage(successMessage);
      focusCamperBarcode();
      return true;
    } catch (error) {
      setAppMessage(normalizeError(error, "Could not complete the order."));
      focusItemBarcode();
      return false;
    } finally {
      setSavingAction(false);
    }
  }

  function selectCamperForOrder(camper) {
    if (selectedCamperId && selectedCamperId !== camper.id && cartLines.length) {
      setCartLines([]);
      checkoutTokenRef.current = null;
      lastAddedCartKeyRef.current = "";
    }

    setSelectedCamperId(camper.id);
    setSearch(camper.camper_id);
    setCamperBarcodeInput("");
    setItemBarcodeInput("");
    setAppMessage(`Selected ${camper.full_name}.`);
    focusItemBarcode();
    return true;
  }

  function handleCamperBarcodeLookup(value) {
    const normalized = String(value ?? "").trim();
    setCamperBarcodeInput(normalized);
    if (!normalized) return;

    const command = identifyScannerCommand(normalized, SCANNER_COMMANDS);
    if (command) {
      return executeScannerCommand(command);
    }

    const camper = campers.find((entry) => {
      const barcode = entry.barcode_value || entry.camper_id;
      return barcode.toLowerCase() === normalized.toLowerCase();
    });

    if (!camper) {
      setAppMessage(`No camper found for barcode ${normalized}.`);
      focusCamperBarcode();
      return false;
    }

    return selectCamperForOrder(camper);
  }

  function handleItemBarcodeLookup(value) {
    const normalized = String(value ?? "").trim();
    setItemBarcodeInput(normalized);
    if (!normalized) return;

    const command = identifyScannerCommand(normalized, SCANNER_COMMANDS);
    if (command) {
      return executeScannerCommand(command);
    }

    const upperValue = normalized.toUpperCase();
    const now = Date.now();
    if (
      lastItemScanRef.current.value === upperValue &&
      now - lastItemScanRef.current.time < SCAN_DEBOUNCE_MS
    ) {
      setItemBarcodeInput("");
      focusItemBarcode();
      return false;
    }
    lastItemScanRef.current = { value: upperValue, time: now };

    const item = items.find((entry) => {
      const barcode = entry.barcode_value || "";
      return barcode.toLowerCase() === normalized.toLowerCase();
    });

    if (!item) {
      setSelectedItemId("");
      setItemBarcodeInput("");
      setAppMessage(`No item found for barcode ${normalized}.`);
      focusItemBarcode();
      return false;
    }

    return addItemToCart(item);
  }

  function executeScannerCommand(command) {
    setCamperBarcodeInput("");
    setItemBarcodeInput("");

    if (command === "checkout") {
      completeOrder();
      return true;
    }
    if (command === "undo") {
      return undoLastCartItem();
    }
    if (command === "cancel") {
      return cancelOrder();
    }

    return false;
  }

  async function startScanner() {
    setAppMessage("");

    if (scannerRef.current) {
      await stopScanner();
    }

    const scanner = new Html5Qrcode(scannerElementId);
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 140 } },
        async (decodedText) => {
          const matched =
            scannerTarget === "camper"
              ? handleCamperBarcodeLookup(decodedText)
              : handleItemBarcodeLookup(decodedText);

          if (matched) {
            await stopScanner();
          }
        },
        () => {}
      );
      setScannerActive(true);
    } catch (error) {
      setAppMessage(normalizeError(error, "Unable to start the camera scanner."));
      await stopScanner();
    }
  }

  async function stopScanner() {
    if (!scannerRef.current) {
      setScannerActive(false);
      return;
    }

    const scanner = scannerRef.current;
    scannerRef.current = null;

    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      await scanner.clear();
    } catch (_error) {
    } finally {
      setScannerActive(false);
    }
  }

  async function closeMobileScanner() {
    await stopScanner();
    setShowMobileScanner(false);
  }

  function exportTransactions() {
    const rows = [
      [
        "Timestamp",
        "Type",
        "Camper ID",
        "Camper Name",
        "Amount",
        "Note",
        "Order Number",
        "Item Count",
        "Item",
        "Item Barcode",
      ],
      ...filteredTransactions.map((entry) => [
        formatDate(entry.created_at),
        entry.transaction_type,
        entry.campers?.camper_id ?? "",
        entry.campers?.full_name ?? "",
        (entry.amount_cents / 100).toFixed(2),
        entry.note ?? "",
        entry.orders?.order_number ?? "",
        entry.orders?.item_count ?? "",
        entry.store_items?.item_name ?? "",
        entry.store_items?.barcode_value ?? "",
      ]),
    ];

    downloadCsv("camp-transactions-report.csv", rows);
  }

  function exportOrderItems() {
    const rows = [
      [
        "Timestamp",
        "Order Number",
        "Camper ID",
        "Camper Name",
        "Order Status",
        "Item",
        "Barcode",
        "Unit Price",
        "Quantity",
        "Line Total",
      ],
    ];

    filteredTransactions.forEach((entry) => {
      entry.orders?.order_items?.forEach((line) => {
        rows.push([
          formatDate(entry.created_at),
          entry.orders.order_number,
          entry.campers?.camper_id ?? "",
          entry.campers?.full_name ?? "",
          entry.orders.status,
          line.item_name,
          line.barcode_value ?? "",
          (line.unit_price_cents / 100).toFixed(2),
          line.quantity,
          (line.line_total_cents / 100).toFixed(2),
        ]);
      });
    });

    downloadCsv("camp-order-items-report.csv", rows);
  }

  if (!session) {
    return (
      <main className="page">
        <DevelopmentBanner />

      <section className="auth-card">
          <div>
            <h1>PBC Cashless System</h1>
            <p className="muted">
              Sign in for camper balances, barcode checkout, deposits, and reports.
            </p>
          </div>

          <div className="segmented">
            <button
              type="button"
              className={authMode === "sign-in" ? "active" : ""}
              onClick={() => setAuthMode("sign-in")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={authMode === "sign-up" ? "active" : ""}
              onClick={() => setAuthMode("sign-up")}
            >
              Create staff account
            </button>
          </div>

          <form className="stack" onSubmit={handleAuthSubmit}>
            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, email: event.target.value }))
                }
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, password: event.target.value }))
                }
                required
              />
            </label>

            <button type="submit" disabled={authLoading}>
              {authLoading ? "Working..." : authMode === "sign-up" ? "Create account" : "Sign in"}
            </button>
          </form>

          {authMessage ? <div className="notice">{authMessage}</div> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
       <DevelopmentBanner />

    <div className="app-shell">
        <header className="topbar">
          <div>
            <h1>PBC Cashless System</h1>
            <p className="muted">
              Camper lookup, barcode charging, deposits, and transaction reports.
            </p>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={refreshData} disabled={loadingData}>
              {loadingData ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <Workspace
          message={appMessage}
          scanner={{
            expanded: showMobileScanner,
            setExpanded: setShowMobileScanner,
            target: scannerTarget,
            setTarget: setScannerTarget,
            active: scannerActive,
            start: startScanner,
            stop: stopScanner,
            close: closeMobileScanner,
            elementId: scannerElementId,
          }}
          camper={{
            barcode: camperBarcodeInput,
            setBarcode: setCamperBarcodeInput,
            barcodeRef: camperBarcodeRef,
            findByBarcode: handleCamperBarcodeLookup,
            search,
            setSearch,
            filteredEntries: filteredCampers,
            selectedId: selectedCamperId,
            selected: selectedCamper,
            select: (camperId) => {
              const camper = campers.find((entry) => entry.id === camperId);
              if (camper) selectCamperForOrder(camper);
            },
            admin: {
              expanded: showCamperAdmin,
              setExpanded: setShowCamperAdmin,
              showForm: showAddCamper,
              setShowForm: setShowAddCamper,
            },
            form: camperForm,
            setForm: setCamperForm,
            create: createCamper,
            downloadTemplate: downloadCamperTemplate,
            importRef: camperImportRef,
            importCsv: importCampersCsv,
            saving: savingAction,
          }}
          purchase={{
            barcode: itemBarcodeInput,
            setBarcode: setItemBarcodeInput,
            barcodeRef: itemBarcodeRef,
            findByBarcode: handleItemBarcodeLookup,
            quickAmounts: QUICK_AMOUNTS,
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
            commands: SCANNER_COMMANDS,
            saving: savingAction,
            admin: {
              expanded: showPurchaseAdmin,
              setExpanded: setShowPurchaseAdmin,
              showForm: showAddItem,
              setShowForm: setShowAddItem,
            },
            depositAmount,
            setDepositAmount,
            depositNote,
            setDepositNote,
            downloadTemplate: downloadItemTemplate,
            importRef: itemImportRef,
            importCsv: importItemsCsv,
            itemForm,
            setItemForm,
            createItem,
          }}
          items={{
            entries: items,
            selectedId: selectedItemId,
            select: (itemId) => {
              const item = items.find((entry) => entry.id === itemId);
              if (item) addItemToCart(item);
            },
          }}
        />


        <section className="panel stack report-panel">
          <div className="section-head">
            <div>
              <h2>Transaction reports</h2>
              <p className="muted">Filter recent transactions and export them to CSV.</p>
            </div>
            <div className="inline-form wrap">
              <button type="button" onClick={exportTransactions}>
                Export transactions CSV
              </button>
              <button type="button" onClick={exportOrderItems}>
                Export order items CSV
              </button>
            </div>
          </div>

          <div className="grid-4">
            <label>
              Type
              <select
                value={reportFilter.type}
                onChange={(event) =>
                  setReportFilter((current) => ({ ...current, type: event.target.value }))
                }
              >
                <option value="all">All</option>
                <option value="charge">Charges</option>
                <option value="deposit">Deposits</option>
                <option value="void">Voids</option>
              </select>
            </label>

            <label>
              Start date
              <input
                type="date"
                value={reportFilter.startDate}
                onChange={(event) =>
                  setReportFilter((current) => ({ ...current, startDate: event.target.value }))
                }
              />
            </label>

            <label>
              End date
              <input
                type="date"
                value={reportFilter.endDate}
                onChange={(event) =>
                  setReportFilter((current) => ({ ...current, endDate: event.target.value }))
                }
              />
            </label>

            <div className="card summary-card">
              <div className="label">Filtered totals</div>
              <div className="muted">
                Charges: {reportSummary.chargeCount} /{" "}
                {formatMoneyFromCents(reportSummary.chargeTotal)}
              </div>
              <div className="muted">
                Deposits: {reportSummary.depositCount} /{" "}
                {formatMoneyFromCents(reportSummary.depositTotal)}
              </div>
            </div>
          </div>

          <div className="report-table">
            <div className="report-head">
              <div>Time</div>
              <div>Type</div>
              <div>Camper</div>
              <div>Item / Note</div>
              <div>Amount</div>
            </div>
            <div className="report-body">
             {filteredTransactions.map((entry) => {
  const canVoid = entry.transaction_type === "charge" && !entry.voided_at;
  const hasOrder = Boolean(entry.orders);
  const orderExpanded = expandedOrderIds.includes(entry.orders?.order_number);

  return (
    <div key={entry.id} className="report-entry">
      <div className="report-row">
        <div>{formatDate(entry.created_at)}</div>

        <div>
          <div className={`pill ${entry.transaction_type}`}>{entry.transaction_type}</div>
          {entry.voided_at ? <div className="muted">Voided</div> : null}
        </div>

        <div>
          <div>{entry.campers?.full_name ?? "Unknown camper"}</div>
          <div className="muted">{entry.campers?.camper_id ?? ""}</div>
        </div>

        <div>
          <div>
            {hasOrder
              ? `Order #${entry.orders.order_number} - ${entry.orders.item_count} item${
                  entry.orders.item_count === 1 ? "" : "s"
                }`
              : entry.store_items?.item_name || entry.note || "—"}
          </div>
          <div className="muted">
            {hasOrder
              ? entry.orders.note || entry.note || ""
              : entry.note && entry.store_items?.item_name
                ? entry.note
                : ""}
          </div>
          {hasOrder ? (
            <button
              type="button"
              className="details-button"
              onClick={() =>
                setExpandedOrderIds((current) =>
                  orderExpanded
                    ? current.filter((number) => number !== entry.orders.order_number)
                    : [...current, entry.orders.order_number]
                )
              }
            >
              {orderExpanded ? "Hide items" : "View items"}
            </button>
          ) : null}
        </div>

        <div>
          <div>{formatMoneyFromCents(entry.amount_cents)}</div>
          {canVoid ? (
            <button
              type="button"
              onClick={() => voidTransaction(entry.id)}
              disabled={savingAction}
              style={{ marginTop: "0.35rem" }}
            >
              Void
            </button>
          ) : null}
        </div>
      </div>

      {hasOrder && orderExpanded ? (
        <div className="order-details">
          {entry.orders.order_items.map((line) => (
            <div className="order-detail-line" key={line.id}>
              <span>
                {line.quantity} x {line.item_name}
              </span>
              <span className="muted">
                {formatMoneyFromCents(line.unit_price_cents)} each
              </span>
              <strong>{formatMoneyFromCents(line.line_total_cents)}</strong>
            </div>
          ))}
          <div className="order-detail-total">
            <strong>Order total</strong>
            <strong>{formatMoneyFromCents(entry.orders.total_cents)}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
})}
              {!filteredTransactions.length ? (
                <div className="empty">No transactions match the current filters.</div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
