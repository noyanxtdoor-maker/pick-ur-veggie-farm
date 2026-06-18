import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { VegetablePrice, SalesItem, Transaction, User, hasFeatureAccess } from '../lib/types';
import { Numpad } from '../components/Numpad';
import { formatPeso, farmPerKg, lineTotal, retailLine, DISCOUNT } from '../lib/money';
import { ShoppingCart, Tag, Receipt, CheckCircle, Search, AlertCircle, Trash2, Printer, Sprout } from 'lucide-react';

const getCropImage = (name: string): string | null => {
  const n = name.toLowerCase();
  if (n.includes('potato')) return 'https://lh3.googleusercontent.com/aida-public/AB6AXuD3RiWFNHDJu8Mxwo5tSZpxRawSp-SL9R4cNB6dfqDljk8j0lmbAHmMBqE5oO_eHxVmi4j3QHoe7EBRE3avr-kE0orxfRgxk-tr2vlbveuoD6e0K_IWvvEor2tZAAmcse4Ze1Q_xhHFxr6rijMYnA2wUJjRe0ByPkEnSDYVuR_KwqSNR1V8CR1tlJgKugFRUxYwUQNsqRH0uje4s6BHTh7bh4YWNt1iXfRHdvM3hDtpxV2wG0TYhu-E2v1tRmzPDNGSOWGhljCXWtO3';
  if (n.includes('carrot')) return 'https://lh3.googleusercontent.com/aida-public/AB6AXuCWihRdlcs1H9Yi8TJcrK8gcZQBOYYpIkJGr7eCPShW8DVYpXAwauqadddmYPL3vFw84egb022YClJ5EUvGFHpZg6R67BMG5MZIlrxstBiDIZqBe4JhatHK4rWM9FJ4ugPJYuGrRh02kBh01kt5fIIdK_iguB15HBrmzwpCa3BO3wKjF2KwOlRZfTY16kq9QCxd0aPLh-Fqry65ZMfasQyrFQbFCrGLfZDiWkYvPaLK_YSQI6G9X9pDsR0DWral9fAnTOssaUQcotiX';
  if (n.includes('onion')) return 'https://lh3.googleusercontent.com/aida-public/AB6AXuA8MEz7ysj9iKLiWLfJEsh2o8YNeyQdm-WDgQL5S0YP8QwagJ54kfNluXL3ItQmVA6B_DpwUnd8I5GJir-iRwkRkFSo5KLf1r11QtBlFUXID5VkT20IqZwvS8RWWouY9H5ZtdfH4ZuljowtShZ7H6J0bKV8m2sT-pxh_sFvnItAQE0XFdIYbHrF7UBIlY9nhLz9oElFjo0vfYfUd5M3u2lo5LjVYPgEE1XwjMlOxiYnP8q1Db4XqYOt01trTW2vbq1V5vJWeoC2AH-l';
  return null;
};

interface POSProps {
  currentUser: User;
  onRefresh: () => void;
}

export function POS({ currentUser, onRefresh }: POSProps) {
  const [crops, setCrops] = useState<VegetablePrice[]>([]);
  const [selectedCrop, setSelectedVeg] = useState<VegetablePrice | null>(null);
  const [weightInput, setWeightInput] = useState<string>('');
  const [cart, setCart] = useState<SalesItem[]>([]);
  
  // Checkout Modal State
  const [showCheckout, setShowCheckout] = useState<boolean>(false);
  const [cashInput, setCashInput] = useState<string>('');
  const [checkoutStatus, setCheckoutStatus] = useState<'paid' | 'preorder'>('paid');
  const [vendorNote, setVendorNote] = useState<string>('');

  // Pre-order dynamic billing states (10% discount & custom delivery fees)
  const [preorderHasDiscount, setPreorderHasDiscount] = useState<boolean>(true);
  const [preorderHasDelivery, setPreorderHasDelivery] = useState<boolean>(false);
  const [preorderDeliveryFee, setPreorderDeliveryFee] = useState<number>(0);

  // Slip Printing View Modal
  const [printedSlip, setPrintedSlip] = useState<Transaction | null>(null);

  // Journal and Filtering
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchDate, setSearchDate] = useState<string>('');
  const [searchType, setSearchType] = useState<string>('all');
  const [searchStatus, setSearchStatus] = useState<string>('all');

  // Delivery Update State
  const [editingDeliveryTxn, setEditingDeliveryTxn] = useState<Transaction | null>(null);
  const [deliveryPaidInput, setDeliveryPaidAmountInput] = useState<string>('');

  // Crop / Prices catalog management state
  const [showCropManager, setShowCropManager] = useState<boolean>(false);
  const [newCropName, setNewCropName] = useState<string>('');
  const [newCropPrice, setNewCropPrice] = useState<string>('');
  const [editingCropId, setEditingCropId] = useState<string | null>(null);
  const [editingCropPrice, setEditingCropPrice] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const listCrops = await db.prices.toArray();
    setCrops(listCrops);

    const listTxns = await db.transactions.toArray();
    setTransactions(listTxns.sort((a,b) => b.datetime.localeCompare(a.datetime)));
  };

  const stampChange = async () => {
    await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
    onRefresh();
  };

  // Add Item to active cart
  const handleAddToSlip = () => {
    if (!selectedCrop) return;
    const w = parseFloat(weightInput);
    if (isNaN(w) || w <= 0) {
      alert('Please enter a weight greater than 0 kg.');
      return;
    }

    const farmRate = farmPerKg(selectedCrop.retailPerKg);
    const itemTotal = lineTotal(w, selectedCrop.retailPerKg);
    const itemRetailTotal = retailLine(w, selectedCrop.retailPerKg);

    const newItem: SalesItem = {
      name: selectedCrop.name,
      weightKg: w,
      retailPerKg: selectedCrop.retailPerKg,
      farmPerKg: farmRate,
      lineTotal: itemTotal,
      retailLine: itemRetailTotal
    };

    setCart([...cart, newItem]);
    setWeightInput('');
    setSelectedVeg(null);
  };

  // Skip Numpad Weight for Quick Wholesale pre-orders
  const handlePreorderSkipWeighAdd = () => {
    if (!selectedCrop) return;
    // For bulk wholesale pre-orders, allow adding item directly with a flat price
    const flatPriceStr = prompt(`Enter flat wholesale price (₱) for ${selectedCrop.name} bulk batch:`, "0");
    if (!flatPriceStr) return;
    const flatPrice = parseFloat(flatPriceStr);
    if (isNaN(flatPrice) || flatPrice <= 0) return;

    const newItem: SalesItem = {
      name: `${selectedCrop.name} (Bulk Pre-order)`,
      weightKg: null, // skipped
      retailPerKg: null,
      farmPerKg: null,
      lineTotal: flatPrice,
      retailLine: flatPrice
    };

    setCart([...cart, newItem]);
    setSelectedVeg(null);
  };

  const handleRemoveFromCart = (index: number) => {
    setCart(cart.filter((_, idx) => idx !== index));
  };

  const handleClearCart = () => {
    if (confirm('Clear the current cashier slip?')) {
      setCart([]);
      setSelectedVeg(null);
      setWeightInput('');
    }
  };

  // Total sums
  const cartTotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const cartRetailTotal = cart.reduce((sum, item) => sum + item.retailLine, 0);
  const savedAmt = cartRetailTotal - cartTotal;

  const handleCheckoutOpen = () => {
    if (cart.length === 0) return;
    setCashInput('');
    setCheckoutStatus('paid');
    setVendorNote('');
    setPreorderHasDiscount(true);
    setPreorderHasDelivery(false);
    setPreorderDeliveryFee(0);
    setShowCheckout(true);
  };

  // Record Transaction
  const handleProcessCheckout = async () => {
    const rawCash = parseFloat(cashInput);
    if (checkoutStatus === 'paid') {
      if (isNaN(rawCash) || rawCash < cartTotal) {
        alert('Insufficient cash payment entered.');
        return;
      }
    }

    const nextSlipRow = await db.meta.get('nextSlipNo');
    const slipNo = nextSlipRow ? nextSlipRow.value : 101;
    await db.meta.put({ key: 'nextSlipNo', value: slipNo + 1 });

    let finalItems = cart;
    let finalTotal = cartTotal;
    let finalSaved = savedAmt;
    let finalChange = 0;
    let preorderDisc = 0;
    let preorderDel = 0;

    if (checkoutStatus === 'preorder') {
      const sub = cartTotal;
      const discountVal = preorderHasDiscount ? (sub * 0.10) : 0;
      const deliveryVal = preorderHasDelivery ? preorderDeliveryFee : 0;
      
      finalTotal = sub - discountVal + deliveryVal;
      finalSaved = preorderHasDiscount ? (savedAmt + discountVal) : savedAmt;
      finalChange = 0;
      preorderDisc = discountVal;
      preorderDel = preorderHasDelivery ? preorderDeliveryFee : 0;
    } else {
      finalChange = isNaN(rawCash) ? 0 : (rawCash - cartTotal);
    }

    const newTxn: Transaction = {
      id: `txn_${Date.now()}`,
      datetime: new Date().toISOString(),
      type: finalItems.some(i => i.weightKg === null) ? 'wholesale' : 'retail',
      items: finalItems,
      total: finalTotal,
      retailTotal: cartRetailTotal,
      saved: finalSaved,
      cash: checkoutStatus === 'paid' ? rawCash : 0,
      change: finalChange,
      note: vendorNote,
      slipNo,
      voided: false,
      postedBy: currentUser.username,
      status: checkoutStatus,
      deliveryFee: preorderDel,
      discountAmount: preorderDisc
    };

    await db.transactions.add(newTxn);
    await stampChange();
    loadData();

    setCart([]);
    setShowCheckout(false);
    setPrintedSlip(newTxn);
  };

  // Handle Delivery Paid Balance update
  const handleUpdateDeliveryPaid = async () => {
    if (!editingDeliveryTxn) return;
    const paidAmt = parseFloat(deliveryPaidInput);
    if (isNaN(paidAmt) || paidAmt < editingDeliveryTxn.total) {
      alert('Paid cash must cover the total delivery amount.');
      return;
    }

    const changeAmt = paidAmt - editingDeliveryTxn.total;

    await db.transactions.update(editingDeliveryTxn.id, {
      status: 'paid',
      cash: paidAmt,
      change: changeAmt,
      deliveryPaidAmount: paidAmt,
      deliveryChangeAmount: changeAmt
    });

    await stampChange();
    loadData();
    setEditingDeliveryTxn(null);
  };

  const handleVoidTxn = async (id: string, slipNo: number) => {
    if (confirm(`Are you absolutely sure you want to VOID slip #${slipNo}? This will revert any financial impacts.`)) {
      await db.transactions.update(id, { voided: true });
      await stampChange();
      loadData();
    }
  };

  const handleAddCrop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCropName.trim() || !newCropPrice) {
      alert('Please enter vegetable name and normal retail price.');
      return;
    }
    const rPrice = parseFloat(newCropPrice);
    if (isNaN(rPrice) || rPrice <= 0) {
      alert('Price must be a valid positive number.');
      return;
    }

    const newCrop: VegetablePrice = {
      id: `crop_${Date.now()}`,
      name: newCropName.trim(),
      retailPerKg: rPrice
    };

    await db.prices.add(newCrop);
    await stampChange();
    loadData();

    setNewCropName('');
    setNewCropPrice('');
  };

  const handleUpdateCropPrice = async (id: string) => {
    const rPrice = parseFloat(editingCropPrice);
    if (isNaN(rPrice) || rPrice <= 0) {
      alert('Price must be a valid positive number.');
      return;
    }

    await db.prices.update(id, { retailPerKg: rPrice });
    await stampChange();
    loadData();

    setEditingCropId(null);
    setEditingCropPrice('');
  };

  const handleDeleteCrop = async (id: string, name: string) => {
    if (confirm(`Are you absolutely sure you want to completely remove '${name}' crop item from catalog and keyboard layout?`)) {
      await db.prices.delete(id);
      await stampChange();
      loadData();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Left Hand side: Vegetable Selector and Weigh Pad */}
        <div className="flex-1 space-y-6">
          <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-farm-green flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-farm-green" />
                <span>Weighed Crop Cashier Grid</span>
              </h3>
              <div className="flex items-center gap-2">
                {hasFeatureAccess(currentUser, 'pos', 'edit') && (
                  <button
                    onClick={() => {
                      setShowCropManager(true);
                      setNewCropName('');
                      setNewCropPrice('');
                      setEditingCropId(null);
                    }}
                    className="bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition shadow-xs"
                  >
                    ⚙️ Crop Pricing Menu
                  </button>
                )}
                <span className="text-xs text-farm-green font-bold bg-farm-accent-soft px-3 py-1 rounded-full">
                  POS Mode: Active Offline
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {crops.map((c, idx) => {
                const imgUrl = getCropImage(c.name);
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedVeg(c);
                      setWeightInput('');
                    }}
                    className={`relative p-3 rounded-2xl border text-center transition select-none flex flex-col items-center justify-center gap-2 h-40 cursor-pointer group ${selectedCrop?.id === c.id ? 'border-farm-green bg-farm-accent-soft ring-2 ring-farm-green shadow-sm' : 'border-farm-accent-soft bg-white hover:border-farm-green hover:bg-farm-bg/50 shadow-xs'}`}
                  >
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-farm-accent-soft text-farm-green text-[9px] font-black rounded font-mono">
                      #{101 + idx}
                    </div>
                    {imgUrl ? (
                      <img 
                        src={imgUrl} 
                        alt={c.name} 
                        referrerPolicy="no-referrer"
                        className="w-16 h-16 object-cover rounded-full group-hover:scale-105 transition-transform border border-farm-accent-soft shadow-xs"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-farm-accent-soft flex items-center justify-center text-farm-green group-hover:scale-105 transition-transform">
                        <Sprout className="w-6 h-6" />
                      </div>
                    )}
                    <div className="text-center w-full">
                      <span className="font-extrabold text-xs text-farm-ink block leading-tight truncate max-w-[130px] mx-auto">{c.name}</span>
                      <div className="text-[11px] text-farm-green font-black mt-1">
                        {formatPeso(farmPerKg(c.retailPerKg))}/kg
                      </div>
                      <div className="text-[9px] text-farm-muted line-through">
                        Reg: {formatPeso(c.retailPerKg)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          Selected Item panel
          {selectedCrop && (
            <div className="bg-white rounded-2xl shadow-xl border border-farm-green p-6 animate-fade-in">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h4 className="font-bold text-farm-green text-lg">Inputting Weight for: <span className="underline">{selectedCrop.name}</span></h4>
                  <p className="text-xs text-farm-muted">Active Price: {formatPeso(farmPerKg(selectedCrop.retailPerKg))} farm price per kg</p>
                </div>
                <button
                  onClick={() => handlePreorderSkipWeighAdd()}
                  className="bg-amber-50 hover:bg-amber-100 text-farm-warn text-xs border border-amber-200 font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  Skip Weigh (Bulk Flat Price)
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Weight (in kg)</label>
                  <input
                    type="text"
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                    placeholder="Enter or touch weight..."
                    className="w-full text-right font-black text-2xl px-4 py-3 rounded-xl border border-farm-green bg-farm-bg outline-none"
                  />
                  <div className="mt-3 text-xs bg-farm-accent-soft p-3 rounded-lg flex items-center justify-between text-farm-green">
                    <span>Discounted Farm cost:</span>
                    <span className="font-black text-sm">
                      {formatPeso(lineTotal(parseFloat(weightInput) || 0, selectedCrop.retailPerKg))}
                    </span>
                  </div>
                  <button
                    onClick={handleAddToSlip}
                    className="w-full bg-farm-green hover:bg-farm-green-700 text-white font-black py-4 px-6 rounded-xl mt-4 transition cursor-pointer"
                  >
                    ADD TO ACTIVE SLIP
                  </button>
                </div>
                <div>
                  <Numpad value={weightInput} onChange={setWeightInput} type="weight" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Hand side: Current Active Checkout Slip */}
        <div className="w-full xl:w-96 space-y-6">
          <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6 flex flex-col justify-between min-h-[400px]">
            <div>
              <h3 className="text-lg font-bold text-farm-green mb-4 pb-2 border-b border-farm-accent-soft flex items-center justify-between">
                <span>Active Slip Counter</span>
                <span className="text-xs text-farm-muted font-normal">items: {cart.length}</span>
              </h3>

              {cart.length === 0 ? (
                <div className="text-center py-20 text-farm-muted flex flex-col items-center justify-center">
                  <AlertCircle className="w-10 h-10 text-farm-accent mb-2" />
                  <span className="text-sm">Empty slip. Choose a crop to get started.</span>
                </div>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {cart.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs p-2 rounded-xl bg-farm-bg border border-farm-accent-soft">
                      <div>
                        <div className="font-bold text-farm-green">{item.name}</div>
                        <div className="text-[10px] text-farm-muted">
                          {item.weightKg !== null ? (
                            `${item.weightKg} kg × ${formatPeso(item.farmPerKg!)}/kg`
                          ) : (
                            'Bulk pre-order price'
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-farm-ink">{formatPeso(item.lineTotal)}</span>
                        <button
                          onClick={() => handleRemoveFromCart(idx)}
                          className="text-farm-danger hover:bg-red-50 p-1 rounded transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-farm-accent-soft pt-4 mt-4 space-y-4">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold text-farm-muted">Total Due:</span>
                <span className="text-3xl font-black text-farm-green tabular">{formatPeso(cartTotal)}</span>
              </div>
              {savedAmt > 0 && (
                <div className="text-xs text-emerald-600 font-bold text-right flex items-center justify-end gap-1">
                  <Tag className="w-3.5 h-3.5" />
                  <span>Farm Discount Saved: {formatPeso(savedAmt)}</span>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleClearCart}
                  disabled={cart.length === 0}
                  className="px-3 bg-red-50 text-farm-danger hover:bg-red-100 rounded-xl transition duration-100 cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCheckoutOpen}
                  disabled={cart.length === 0}
                  className="flex-1 bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3.5 rounded-xl transition duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  PROCEED CHECKOUT
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sales Journal and Search Filters */}
      <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold text-farm-green">Historical Sales Journal</h3>
            <p className="text-xs text-farm-muted">Failsafe registry tracking retail weigh-outs and pending wholesale pre-orders.</p>
          </div>
          <button
            onClick={() => {
              // Simple exported CSV trigger
              if (transactions.length === 0) {
                alert('No listings to export.');
                return;
              }
              let csvContent = "data:text/csv;charset=utf-8,Date,Slip,Type,PostedBy,Total,RetailTotal,Saved,Status,Note\n";
              transactions.forEach(t => {
                csvContent += `${t.datetime},#${t.slipNo},${t.type},${t.postedBy},${t.total},${t.retailTotal},${t.saved},${t.status},"${t.note}"\n`;
              });
              const encodedUri = encodeURI(csvContent);
              const link = document.createElement("a");
              link.setAttribute("href", encodedUri);
              link.setAttribute("download", "pickurveggie_sales_journal.csv");
              document.body.appendChild(link);
              link.click();
              link.remove();
            }}
            className="text-xs font-bold bg-farm-bg hover:bg-farm-accent-soft text-farm-green border border-farm-accent p-2 rounded-xl transition cursor-pointer"
          >
            Export Journal (CSV)
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-farm-bg/50 p-4 rounded-xl mb-4 border border-farm-accent-soft">
          <div>
            <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1">Filter Date</label>
            <input
              type="date"
              value={searchDate}
              onChange={(e) => setSearchDate(e.target.value)}
              className="w-full text-xs font-semibold p-2 border border-farm-accent-soft rounded bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1">Sale Type</label>
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded bg-white focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="retail">Retail (Discounted Weight)</option>
              <option value="wholesale">Wholesale (Bulk pre-orders)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1">Payment Status</label>
            <select
              value={searchStatus}
              onChange={(e) => setSearchStatus(e.target.value)}
              className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded bg-white focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="paid">Paid (Cleared)</option>
              <option value="preorder">Pre-orders (Deliveries)</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchDate('');
                setSearchType('all');
                setSearchStatus('all');
              }}
              className="w-full text-xs font-bold p-2.5 bg-white border border-farm-accent text-farm-green hover:bg-farm-accent-soft rounded-lg transition"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Journal Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                <th className="pb-3">Datetime</th>
                <th className="pb-3">Slip #</th>
                <th className="pb-3">Type</th>
                <th className="pb-3">Posted By</th>
                <th className="pb-3">Details / Notes</th>
                <th className="pb-3 text-right">Total</th>
                <th className="pb-3 text-center">Status</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-farm-accent-soft text-sm">
              {transactions
                .filter(t => {
                  if (searchDate && t.datetime.slice(0, 10) !== searchDate) return false;
                  if (searchType !== 'all' && t.type !== searchType) return false;
                  if (searchStatus !== 'all' && t.status !== searchStatus) return false;
                  return true;
                })
                .map((t) => (
                  <tr key={t.id} className={`hover:bg-farm-bg/30 ${t.voided ? 'text-farm-muted line-through bg-red-50/10' : ''}`}>
                    <td className="py-3 text-xs num">{new Date(t.datetime).toLocaleString('en-PH')}</td>
                    <td className="py-3 font-mono font-bold">#{String(t.slipNo).padStart(5, '0')}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${t.type === 'retail' ? 'bg-farm-accent-soft text-farm-green' : 'bg-amber-100 text-amber-800'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-xs">{t.postedBy}</td>
                    <td className="py-3 max-w-xs text-xs truncate" title={t.note || undefined}>
                      {t.note ? (
                        <span className="italic">{t.note}</span>
                      ) : (
                        <span className="text-farm-muted">{t.items.map(i => i.name).join(', ')}</span>
                      )}
                    </td>
                    <td className="py-3 text-right font-bold tabular">{formatPeso(t.total)}</td>
                    <td className="py-3 text-center">
                      {t.voided ? (
                        <span className="px-2 py-0.5 rounded bg-red-100 text-farm-danger text-xs font-bold">VOID</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.status === 'paid' ? 'bg-green-150 bg-farm-accent-soft text-farm-green' : 'bg-amber-100 text-amber-800'}`}>
                          {t.status === 'paid' ? 'Paid' : 'Pre-order / Unpaid'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setPrintedSlip(t)}
                          className="p-1 px-2.5 rounded bg-farm-bg hover:bg-farm-accent-soft border border-farm-accent text-farm-green text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" /> Printable Slip
                        </button>
                        {!t.voided && t.status === 'preorder' && (
                          <button
                            onClick={() => {
                              setEditingDeliveryTxn(t);
                              setDeliveryPaidAmountInput(t.total.toString());
                            }}
                            className="p-1 px-2.5 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 text-farm-warn text-xs font-bold cursor-pointer"
                          >
                            Mark Paid
                          </button>
                        )}
                        {!t.voided && (
                          <button
                            onClick={() => handleVoidTxn(t.id, t.slipNo)}
                            className="p-1 px-2 text-farm-danger hover:bg-red-50 hover:text-farm-danger rounded-lg transition text-xs font-semibold cursor-pointer"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Checkout Modal */}
      {/* Checkout Modal */}
      {showCheckout && (() => {
        const dynDiscountAmount = preorderHasDiscount ? (cartTotal * 0.10) : 0;
        const dynDeliveryFee = preorderHasDelivery ? preorderDeliveryFee : 0;
        const dynGrandTotalDue = checkoutStatus === 'preorder'
          ? (cartTotal - dynDiscountAmount + dynDeliveryFee)
          : cartTotal;

        return (
          <div className="overlay show">
            <div className="modal max-w-xl">
              <div className="slip">
                <h3 className="text-xl font-bold text-farm-green text-center">Process Farm Transaction</h3>
                <p className="text-xs text-farm-muted text-center mb-6">Setup payment classification and vendor logging.</p>

                <div className="grid grid-cols-2 gap-3 mb-6 bg-farm-bg p-2 rounded-xl border border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setCheckoutStatus('paid')}
                    className={`py-3.5 px-4 font-bold text-sm tracking-wide rounded-xl border cursor-pointer select-none text-center ${checkoutStatus === 'paid' ? 'bg-farm-green text-white border-transparent' : 'bg-transparent text-farm-muted border-transparent hover:text-farm-green'}`}
                  >
                    Direct Cash Clearance
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckoutStatus('preorder')}
                    className={`py-3.5 px-4 font-bold text-sm tracking-wide rounded-xl border cursor-pointer select-none text-center ${checkoutStatus === 'preorder' ? 'bg-farm-green text-white border-transparent' : 'bg-transparent text-farm-muted border-transparent hover:text-farm-green'}`}
                  >
                    Pre-order (Unpaid Delivery)
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Grand Total Due:</label>
                    <div className="text-3xl font-black text-farm-green text-right tabular bg-farm-bg border border-farm-accent-soft p-3 rounded-xl">
                      {formatPeso(dynGrandTotalDue)}
                    </div>
                  </div>

                  {checkoutStatus === 'paid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Cash Received (₱)</label>
                        <input
                          type="text"
                          value={cashInput}
                          onChange={(e) => setCashInput(e.target.value)}
                          placeholder="0.00"
                          className="w-full text-right font-black text-xl px-4 py-3 rounded-xl border border-farm-green outline-none"
                        />
                        <div className="mt-3 text-xs text-farm-muted flex items-center justify-between">
                          <span>Change due back:</span>
                          <span className="font-extrabold text-sm text-farm-green">
                            {formatPeso(Math.max(0, (parseFloat(cashInput) || 0) - cartTotal))}
                          </span>
                        </div>
                      </div>
                      <div>
                        <Numpad value={cashInput} onChange={setCashInput} type="cash" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Interactive Pre-order Billing Adjusters */}
                      <div className="p-4 bg-emerald-50/50 border border-farm-accent-soft/50 rounded-xl space-y-3">
                        <div className="flex items-center justify-between border-b border-farm-accent-soft/40 pb-2">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={preorderHasDiscount}
                              onChange={(e) => setPreorderHasDiscount(e.target.checked)}
                              className="w-4 h-4 accent-farm-green cursor-pointer"
                            />
                            <span className="text-xs font-bold text-farm-ink">Include 10% Discount</span>
                          </label>
                          {preorderHasDiscount && (
                            <span className="text-xs font-extrabold text-farm-green">- {formatPeso(dynDiscountAmount)}</span>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={preorderHasDelivery}
                                onChange={(e) => {
                                  setPreorderHasDelivery(e.target.checked);
                                  if (!e.target.checked) {
                                    setPreorderDeliveryFee(0);
                                  }
                                }}
                                className="w-4 h-4 accent-farm-green cursor-pointer"
                              />
                              <span className="text-xs font-bold text-farm-ink">Add Delivery Fee</span>
                            </label>
                            {preorderHasDelivery && (
                              <span className="text-xs font-extrabold text-farm-green">+ {formatPeso(preorderDeliveryFee)}</span>
                            )}
                          </div>

                          {preorderHasDelivery && (
                            <div className="flex items-center gap-2 pl-6 mt-1">
                              <span className="text-xs text-farm-muted font-bold font-mono">Fee Amount (₱):</span>
                              <input
                                type="number"
                                min="0"
                                value={preorderDeliveryFee || ''}
                                placeholder="0.00"
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  setPreorderDeliveryFee(isNaN(val) ? 0 : val);
                                }}
                                className="w-28 p-1.5 text-right font-bold text-xs bg-white rounded border border-farm-accent outline-none"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Delivery note / vendor address</label>
                        <textarea
                          value={vendorNote}
                          onChange={(e) => setVendorNote(e.target.value)}
                          placeholder="Input delivery route/vendor name (e.g. Deliver to Aling Sandra at Public Market at 2 PM)"
                          className="w-full text-sm p-3 rounded-xl border border-farm-accent-soft h-24 focus:outline-none bg-farm-bg/50"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-actions border-t border-farm-accent-soft pt-4 mt-4">
                <button
                  onClick={() => setShowCheckout(false)}
                  className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProcessCheckout}
                  disabled={checkoutStatus === 'paid' && (isNaN(parseFloat(cashInput)) || parseFloat(cashInput) < cartTotal)}
                  className="bg-farm-green hover:bg-farm-green-700 disabled:opacity-40 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer flex-1"
                >
                  RECORD TRANSACTION
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delivery Update Modal */}
      {editingDeliveryTxn && (
        <div className="overlay show">
          <div className="modal max-w-md">
            <div className="slip">
              <h3 className="text-lg font-bold text-farm-green text-center">Offset Unpaid pre-order</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Process received cash and record delivery completion.</p>

              <div className="space-y-4">
                <div>
                  <div className="text-xs text-farm-muted">Delivery slip:</div>
                  <div className="font-mono font-bold">#{String(editingDeliveryTxn.slipNo).padStart(5, '0')}</div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Amount outstanding:</label>
                  <div className="text-2xl font-black text-farm-green text-right tabular">{formatPeso(editingDeliveryTxn.total)}</div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Cash Paid by Vendor (₱)</label>
                    <input
                      type="text"
                      value={deliveryPaidInput}
                      onChange={(e) => setDeliveryPaidAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full text-right font-black text-xl px-4 py-3 rounded-xl border border-farm-green outline-none"
                    />
                    <div className="mt-2 text-xs text-farm-muted flex items-center justify-between">
                      <span>Change given:</span>
                      <span className="font-extrabold text-sm text-farm-green">
                        {formatPeso(Math.max(0, (parseFloat(deliveryPaidInput) || 0) - editingDeliveryTxn.total))}
                      </span>
                    </div>
                  </div>
                  <Numpad value={deliveryPaidInput} onChange={setDeliveryPaidAmountInput} type="cash" />
                </div>
              </div>
            </div>

            <div className="modal-actions border-t border-farm-accent-soft pt-4">
              <button
                onClick={() => setEditingDeliveryTxn(null)}
                className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleUpdateDeliveryPaid}
                disabled={isNaN(parseFloat(deliveryPaidInput)) || parseFloat(deliveryPaidInput) < editingDeliveryTxn.total}
                className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer disabled:opacity-45"
              >
                CONFIRM RECONCILIATION
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slip Print Preview Modal */}
      {printedSlip && (
        <div className="overlay show select-none">
          <div className="modal max-w-sm">
            <div id="thermal-slip-view" className="slip printable font-mono bg-white p-6 rounded-lg text-xs leading-tight">
              <div className="text-center font-bold text-base uppercase text-farm-green tracking-wide">Pick Ur Veggie Farm</div>
              <div className="text-center text-[10px] text-farm-muted italic mb-4">"Fresh from our Harvest Poly-Tunnels to you"</div>
              
              <div className="text-[10px] text-farm-muted mb-4 space-y-0.5">
                <div>Date: {new Date(printedSlip.datetime).toLocaleString()}</div>
                <div>Slip #{String(printedSlip.slipNo).padStart(5, '0')}</div>
                <div>Cashier: <span className="font-semibold text-farm-ink">{printedSlip.postedBy}</span></div>
                <div className="font-bold flex items-center gap-1.5 text-farm-green mt-1">
                  <span>Permit Type:</span>
                  <span className="uppercase text-[9px] px-1 bg-farm-accent-soft tracking-wider">{printedSlip.status === 'preorder' ? 'Pre-Order delivery' : 'Retail PAID Receipt'}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-farm-muted/30 py-3 space-y-1.5">
                {printedSlip.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-start gap-4">
                    <span className="leading-tight block">
                      {it.name}
                      {it.weightKg !== null && (
                        <span className="block text-[10px] text-farm-muted">{it.weightKg} kg × {formatPeso(it.farmPerKg || 0)}/kg</span>
                      )}
                    </span>
                    <span className="font-bold tabular">{formatPeso(it.lineTotal)}</span>
                  </div>
                ))}
              </div>

              {printedSlip.saved > 0 && (
                <div className="text-right text-[10px] text-farm-green font-bold bg-farm-accent-soft p-1.5 rounded mt-3">
                  Applied 10% farm discount — saved {formatPeso(printedSlip.saved)}!
                </div>
              )}

              <div className="border-t border-dashed border-farm-muted/30 pt-3 mt-4 space-y-1">
                <div className="flex justify-between font-black text-sm">
                  <span>TOTAL</span>
                  <span className="tabular">{formatPeso(printedSlip.total)}</span>
                </div>
                {printedSlip.status === 'paid' ? (
                  <>
                    <div className="flex justify-between text-[11px]">
                      <span>Cash Paid</span>
                      <span className="tabular">{formatPeso(printedSlip.cash)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-bold">
                      <span>Change Given</span>
                      <span className="tabular">{formatPeso(printedSlip.change)}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] italic text-farm-warn bg-amber-50 p-1.5 border border-amber-200 mt-2 font-semibold">
                    Delivery preorder. Cash collection is pending.
                  </div>
                )}
              </div>

              {printedSlip.note && (
                <div className="mt-4 p-2 bg-farm-bg rounded text-[10px] tracking-wide text-farm-green font-bold">
                  Note: {printedSlip.note}
                </div>
              )}

              <div className="mt-6 text-center text-[10px] text-farm-muted border-t border-dashed border-farm-accent-soft pt-3">
                This is a sales record slip, not an official receipt.<br />
                Salamat po for pickin' ur organic veggies!
              </div>
            </div>

            <div className="modal-actions border-t border-farm-accent-soft pt-4">
              <button
                onClick={() => setPrintedSlip(null)}
                className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl cursor-pointer"
              >
                Close Receipt View
              </button>
              <button
                onClick={() => window.print()}
                className="bg-farm-accent-soft hover:bg-farm-accent text-farm-green font-semibold py-3 px-6 rounded-xl flex items-center justify-center gap-1 cursor-pointer"
              >
                🖶 Print Slip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Catalog Manager Dialog */}
      {showCropManager && (
        <div className="overlay show select-none">
          <div className="modal max-w-xl w-full">
            <div className="p-6">
              <div className="flex justify-between items-center border-b border-farm-accent-soft pb-3 mb-4">
                <h3 className="text-lg font-black text-indigo-950 flex items-center gap-1.5">
                  <span>🥬 POS Vegetable Catalog Administrator</span>
                </h3>
                <button
                  onClick={() => setShowCropManager(false)}
                  className="p-1 text-stone-400 hover:text-stone-700 font-extrabold text-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-farm-ink font-semibold">
                
                {/* Form to Add New Vegetable */}
                <div className="space-y-4 border-r border-farm-accent-soft/50 pr-0 md:pr-4">
                  <h4 className="text-xs font-black uppercase text-farm-green tracking-wider">➕ Register New Vegetable Item</h4>
                  <form onSubmit={handleAddCrop} className="space-y-3">
                    <div>
                      <label className="block text-[10px] uppercase text-farm-muted mb-1 font-bold">Crop / Vegetable Name</label>
                      <input
                        type="text"
                        value={newCropName}
                        onChange={(e) => setNewCropName(e.target.value)}
                        placeholder="e.g. Red Cherry Tomatoes"
                        className="w-full p-2 rounded border border-farm-accent bg-farm-bg outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase text-farm-muted mb-1 font-bold">Base Retail Price (₱ per kg)</label>
                      <input
                        type="text"
                        value={newCropPrice}
                        onChange={(e) => setNewCropPrice(e.target.value)}
                        placeholder="e.g. 150"
                        className="w-full p-2 rounded border border-farm-accent bg-farm-bg outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-farm-green hover:bg-farm-green-700 text-white font-bold p-2.5 rounded-lg transition text-xs uppercase cursor-pointer"
                    >
                      Save to Cashier Grid
                    </button>
                  </form>
                </div>

                {/* Edit Existing Vegetables & Rates */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-indigo-900 tracking-wider">✏️ Edit Normal Retail Prices</h4>
                  <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1">
                    {crops.map(c => (
                      <div key={c.id} className="p-2.5 bg-farm-bg border border-farm-accent-soft rounded-lg flex flex-col justify-between gap-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-stone-800">{c.name}</span>
                          <span className="font-mono text-[10px] text-zinc-500">Retail: {formatPeso(c.retailPerKg)}</span>
                        </div>

                        {editingCropId === c.id ? (
                          <div className="flex gap-1">
                            <input
                              type="number"
                              value={editingCropPrice}
                              onChange={(e) => setEditingCropPrice(e.target.value)}
                              className="flex-1 text-xs border border-farm-accent p-1 rounded bg-white outline-none"
                              placeholder="New rate..."
                            />
                            <button
                              onClick={() => handleUpdateCropPrice(c.id)}
                              className="bg-farm-green text-white font-bold px-2 py-1 rounded text-[10px]"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => setEditingCropId(null)}
                              className="bg-stone-200 text-stone-600 px-2 py-1 rounded text-[10px]"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1.5 self-end">
                            <button
                              onClick={() => {
                                setEditingCropId(c.id);
                                setEditingCropPrice(String(c.retailPerKg));
                              }}
                              className="text-[10px] text-indigo-600 hover:underline"
                            >
                              ✏️ Edit Price
                            </button>
                            <button
                              onClick={() => handleDeleteCrop(c.id, c.name)}
                              className="text-[10px] text-farm-danger hover:underline"
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {crops.length === 0 && (
                      <div className="text-center py-8 text-stone-400 italic">No crops available to manage.</div>
                    )}
                  </div>
                </div>

              </div>

              <div className="border-t border-farm-accent-soft pt-4 mt-6 text-right">
                <button
                  onClick={() => setShowCropManager(false)}
                  className="bg-indigo-950 hover:bg-stone-800 text-white font-bold py-2.5 px-6 rounded-xl transition text-xs uppercase cursor-pointer"
                >
                  Done &amp; Apply
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
