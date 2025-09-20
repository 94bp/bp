import { useEffect, useMemo, useState } from "react";
import api from "../api";

function euro(n) {
    const v = Number(n || 0);
    return `€${v.toFixed(2)}`;
}

function roleForAmount(total) {
    if (total <= 99) return "team_lead";
    if (total <= 199) return "division_manager";
    return "sales_director";
}

export default function Agent() {
    const [meta, setMeta] = useState(null);

    // ====== Buyer ======
    const [buyerCode, setBuyerCode] = useState("");
    const [buyerId, setBuyerId] = useState("");
    const [buyerName, setBuyerName] = useState("");
    const [siteId, setSiteId] = useState("");

    // ====== Add-item form (single row) ======
    const [query, setQuery] = useState("");
    const [pickedArticle, setPickedArticle] = useState(null); // {id, sku, name, sell_price}
    const [qty, setQty] = useState(1);
    const [discount, setDiscount] = useState(0);

    // ====== Added items (table) ======
    const [items, setItems] = useState([]);

    // other fields
    const [invoiceRef, setInvoiceRef] = useState("");
    const [reason, setReason] = useState("");

    const [history, setHistory] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    // ===== Load meta + history =====
    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/meta");
                setMeta(data);
                await reloadHistory();
            } catch (e) {
                if (e?.response?.status === 401) {
                    localStorage.clear();
                    window.location.href = "/login";
                    return;
                }
                console.error("META_ERR:", e);
            }
        })();
    }, []);

    const reloadHistory = async () => {
        const { data } = await api.get("/requests/my");
        setHistory(data);
    };

    // ===== Derived lists =====
    const buyersByCode = useMemo(() => {
        const m = new Map();
        (meta?.buyers || []).forEach((b) => m.set(b.code, b));
        return m;
    }, [meta]);

    const buyerSites = useMemo(() => {
        if (!meta || !buyerId) return [];
        return meta.sites.filter((s) => s.buyer_id === Number(buyerId));
    }, [meta, buyerId]);

    const allArticles = useMemo(() => meta?.articles ?? [], [meta]);

    // Auto-fill buyer by code
    useEffect(() => {
        if (!buyerCode) {
            setBuyerId("");
            setBuyerName("");
            setSiteId("");
            return;
        }
        const b = buyersByCode.get(buyerCode);
        if (b) {
            setBuyerId(String(b.id));
            setBuyerName(b.name);
        } else {
            setBuyerId("");
            setBuyerName("");
        }
        setSiteId("");
    }, [buyerCode, buyersByCode]);

    // ===== Article search helpers =====
    const searchArticles = (q) => {
        const s = (q || "").toLowerCase().trim();
        if (!s) return allArticles.slice(0, 10);
        return allArticles
            .filter(
                (a) =>
                    a.sku.toLowerCase().includes(s) ||
                    a.name.toLowerCase().includes(s)
            )
            .slice(0, 12);
    };

    const suggestions = useMemo(() => searchArticles(query), [query, allArticles]);

    // pick an article
    const pickArticle = (a) => {
        setPickedArticle(a);
        setQuery(`${a.sku} — ${a.name}`);
    };

    // line calculations (read-only fields)
    const unitPrice = pickedArticle ? Number(pickedArticle.sell_price || 0) : 0;
    const lineTotal = (() => {
        const q = Number(qty || 0);
        const d = Number(discount || 0);
        const base = unitPrice * q;
        const res = base * (1 - d / 100);
        return Number.isFinite(res) ? res : 0;
    })();

    // add item into table
    const addItem = () => {
        if (!pickedArticle) {
            alert("Zgjidh një artikull (me kërkim) para se të shtosh.");
            return;
        }
        if (!qty || Number(qty) <= 0) {
            alert("Sasia duhet të jetë > 0.");
            return;
        }
        const row = {
            article_id: pickedArticle.id,
            sku: pickedArticle.sku,
            name: pickedArticle.name,
            price: unitPrice,
            quantity: Number(qty),
            discount: Number(discount || 0),
            line_amount: Number(lineTotal.toFixed(2)),
        };
        setItems((prev) => [...prev, row]);

        // reset only entry fields, forma ngelet
        setQuery("");
        setPickedArticle(null);
        setQty(1);
        setDiscount(0);
    };

    const removeItem = (idx) => {
        setItems((prev) => prev.filter((_, i) => i !== idx));
    };

    // total + role
    const total = items.reduce((s, it) => s + Number(it.line_amount || 0), 0);
    const requiredRole = roleForAmount(total);

    const submit = async () => {
        if (!buyerId) {
            alert("Zgjedh blerësin (shkruaj kodin p.sh. 0012).");
            return;
        }
        if (!items.length) {
            alert("Shto të paktën një artikull.");
            return;
        }
        setSubmitting(true);
        try {
            await api.post("/requests", {
                buyer_id: Number(buyerId),
                site_id: siteId ? Number(siteId) : null,
                invoice_ref: invoiceRef || null,
                reason: reason || null,
                items: items.map((r) => ({
                    article_id: r.article_id,
                    quantity: r.quantity,
                    line_amount: r.line_amount,
                })),
            });
            // reset forma + lista
            setInvoiceRef("");
            setReason("");
            setItems([]);
            setQuery("");
            setPickedArticle(null);
            setQty(1);
            setDiscount(0);
            await reloadHistory();
            alert("Kërkesa u dërgua.");
        } finally {
            setSubmitting(false);
        }
    };

    if (!meta) return null;

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">Kërkesë Lejim Financiar</h1>
                        <p className="text-xs opacity-70">
                            {meta.me.first_name} {meta.me.last_name} · PDA:{" "}
                            {meta.me.pda_number || "-"} · Divizioni:{" "}
                            {meta.me.division_name || "-"}
                        </p>
                    </div>
                    <a
                        className="text-sm underline"
                        href="/login"
                        onClick={() => localStorage.clear()}
                    >
                        Dalje
                    </a>
                </header>

                {/* ===== Blerësi ===== */}
                <section className="bg-white p-4 rounded-2xl shadow space-y-2">
                    <h2 className="font-medium">Blerësi</h2>
                    <div className="grid md:grid-cols-3 gap-2">
                        <input
                            className="border p-2 rounded"
                            placeholder="Kodi i blerësit (p.sh. 0012)"
                            value={buyerCode}
                            onChange={(e) => setBuyerCode(e.target.value)}
                            list="buyer-codes"
                        />
                        <datalist id="buyer-codes">
                            {meta.buyers.map((b) => (
                                <option key={b.id} value={b.code}>
                                    {b.name}
                                </option>
                            ))}
                        </datalist>

                        <input
                            className="border p-2 rounded"
                            value={buyerName}
                            readOnly
                            placeholder="Emri i blerësit (auto)"
                        />

                        <select
                            className="border p-2 rounded"
                            value={siteId}
                            onChange={(e) => setSiteId(e.target.value)}
                            disabled={!buyerId}
                        >
                            <option value="">(pa objekt)</option>
                            {buyerSites.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.site_code} — {s.site_name}
                                </option>
                            ))}
                        </select>
                    </div>
                </section>

                {/* ===== Artikujt ===== */}
                <section className="bg-white p-4 rounded-2xl shadow space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-medium">Artikujt</h2>
                        {/* vend i lirë për veprime të tjera në të ardhmen */}
                    </div>

                    {/* Forma e shtimit (nuk zhduket) */}
                    <div className="grid md:grid-cols-12 gap-2 items-start relative">
                        {/* Kërko / Pick */}
                        <div className="md:col-span-5 relative">
                            <input
                                className="border p-2 rounded w-full"
                                placeholder="Kërko me SKU ose emër (p.sh. jam)"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setPickedArticle(null);
                                }}
                            />
                            {query && suggestions.length > 0 && !pickedArticle && (
                                <div className="absolute z-10 bg-white border rounded mt-1 w-full max-h-56 overflow-auto">
                                    {suggestions.map((s) => (
                                        <div
                                            key={s.id}
                                            className="px-2 py-1 hover:bg-gray-100 cursor-pointer"
                                            onClick={() => pickArticle(s)}
                                        >
                                            {s.sku} — {s.name} · {euro(s.sell_price)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Cmimi (read-only) */}
                        <input
                            className="border p-2 rounded md:col-span-2 bg-gray-50"
                            value={pickedArticle ? unitPrice : ""}
                            readOnly
                            placeholder="Çm. shitës"
                        />

                        {/* Sasia */}
                        <input
                            className="border p-2 rounded md:col-span-2"
                            type="number"
                            min="1"
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, Number(e.target.value || 1)))}
                            placeholder="Sasia"
                        />

                        {/* Lejimi (%) */}
                        <input
                            className="border p-2 rounded md:col-span-1"
                            type="number"
                            min="0"
                            max="100"
                            value={discount}
                            onChange={(e) =>
                                setDiscount(Math.max(0, Math.min(100, Number(e.target.value || 0))))
                            }
                            placeholder="%"
                        />

                        {/* Shuma rreshti (read-only) */}
                        <input
                            className="border p-2 rounded md:col-span-2 bg-gray-50"
                            value={lineTotal ? lineTotal.toFixed(2) : ""}
                            readOnly
                            placeholder="Shuma rreshti (€)"
                        />

                        <div className="md:col-span-12">
                            <button
                                className="text-sm underline"
                                onClick={addItem}
                                disabled={!pickedArticle}
                            >
                                Shto
                            </button>
                        </div>
                    </div>

                    {/* Tabela e artikujve të shtuar */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left">
                                    <th className="p-2">Artikulli</th>
                                    <th className="p-2">Çmimi</th>
                                    <th className="p-2">Sasia</th>
                                    <th className="p-2">Lejimi %</th>
                                    <th className="p-2">Shuma</th>
                                    <th className="p-2">Veprim</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((r, idx) => (
                                    <tr key={idx} className="odd:bg-gray-50">
                                        <td className="p-2">
                                            {r.sku} — {r.name}
                                        </td>
                                        <td className="p-2">{euro(r.price)}</td>
                                        <td className="p-2">{r.quantity}</td>
                                        <td className="p-2">{r.discount}</td>
                                        <td className="p-2">{euro(r.line_amount)}</td>
                                        <td className="p-2">
                                            <button
                                                className="text-red-600"
                                                onClick={() => removeItem(idx)}
                                            >
                                                Fshi
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {!items.length && (
                                    <tr>
                                        <td className="p-2 text-gray-500" colSpan={6}>
                                            Nuk ka artikuj të shtuar ende.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Fatura nderlidhëse + Arsyeja */}
                    <div className="grid md:grid-cols-2 gap-2">
                        <input
                            className="border p-2 rounded"
                            placeholder="Nr. ndërlidhës i faturës"
                            value={invoiceRef}
                            onChange={(e) => setInvoiceRef(e.target.value)}
                        />
                        <textarea
                            className="border p-2 rounded"
                            rows={1}
                            placeholder="Arsyeja (koment)"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </div>

                    {/* Totali + roli që kërkohet (poshtë, anash totalit) */}
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                            Shkon për aprovim te:{" "}
                            <b>{requiredRole.replace("_", " ")}</b>
                        </div>
                        <div className="text-right font-semibold">Totali: {euro(total)}</div>
                    </div>

                    <button
                        className="bg-black text-white rounded w-full py-2"
                        onClick={submit}
                        disabled={submitting || !items.length || !buyerId}
                    >
                        {submitting ? "Duke dërguar..." : "Dërgo Kërkesën"}
                    </button>
                </section>

                {/* ===== Historiku im ===== */}
                <section className="bg-white p-4 rounded-2xl shadow">
                    <h2 className="font-medium mb-2">Historiku im</h2>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left">
                                    <th className="p-2">ID</th>
                                    <th className="p-2">Blerësi</th>
                                    <th className="p-2">Objekti</th>
                                    <th className="p-2">Artikulli/Items</th>
                                    <th className="p-2">Shuma</th>
                                    <th className="p-2">Status</th>
                                    <th className="p-2">Kërkohet nga</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((r) => (
                                    <tr key={r.id} className="odd:bg-gray-50">
                                        <td className="p-2">{r.id}</td>
                                        <td className="p-2">
                                            {r.buyer_code} {r.buyer_name}
                                        </td>
                                        <td className="p-2">{r.site_name || "-"}</td>
                                        <td className="p-2">
                                            {r.items && r.items.length
                                                ? r.items
                                                    .map((it) => `${it.sku} x${it.quantity}`)
                                                    .join(", ")
                                                : r.article_summary || "-"}
                                        </td>
                                        <td className="p-2">{euro(Number(r.amount))}</td>
                                        <td className="p-2">{r.status}</td>
                                        <td className="p-2">{r.required_role}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}
