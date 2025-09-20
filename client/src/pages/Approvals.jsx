import { useEffect, useState } from "react";
import api from "../api";

export default function Approvals() {
    const [rows, setRows] = useState([]);
    const [hist, setHist] = useState([]);
    const role = localStorage.getItem("role") || "";

    const load = async () => {
        const { data } = await api.get("/approvals/pending");
        setRows(data);
        try {
            const { data: h } = await api.get("/approvals/my-history");
            setHist(h);
        } catch { setHist([]); }
    };

    useEffect(() => { load(); }, []);

    const act = async (id, action) => {
        await api.post(`/approvals/${id}/act`, { action, comment: "" });
        await load();
    };

    const apiBase = (api.defaults?.baseURL || "").replace(/\/$/, "");
    const token = localStorage.getItem("token") || "";

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Pending */}
                <section className="bg-white p-4 rounded-2xl shadow">
                    <div className="flex justify-between items-center mb-3">
                        <h1 className="text-xl font-semibold">Aprovime në pritje • {role}</h1>
                        <a className="text-sm underline" href="/login" onClick={() => localStorage.clear()}>
                            Dalje
                        </a>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left">
                                    <th className="p-2">ID</th>
                                    <th className="p-2">Agjenti</th>
                                    <th className="p-2">Artikulli</th>
                                    <th className="p-2">Blerësi/Objekti</th>
                                    <th className="p-2">Shuma</th>
                                    <th className="p-2">PDF</th>
                                    <th className="p-2">Veprim</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const pdf = `${apiBase}/requests/${r.id}/pdf?token=${encodeURIComponent(token)}`;
                                    return (
                                        <tr key={r.id} className="odd:bg-gray-50">
                                            <td className="p-2">{r.id}</td>
                                            <td className="p-2">{r.first_name} {r.last_name}</td>
                                            <td className="p-2">
                                                {r.items && r.items.length
                                                    ? r.items.map(it => `${it.sku} x${it.quantity}`).join(", ")
                                                    : (r.article_name || r.article_summary || "-")}
                                            </td>
                                            <td className="p-2">{r.buyer_code} / {r.site_name || "-"}</td>
                                            <td className="p-2">€{Number(r.amount).toFixed(2)}</td>
                                            <td className="p-2"><a className="underline" href={pdf} target="_blank" rel="noreferrer">Shiko</a></td>
                                            <td className="p-2 space-x-2">
                                                <button className="px-3 py-1 rounded bg-black text-white" onClick={() => act(r.id, "approved")}>Aprovo</button>
                                                <button className="px-3 py-1 rounded border" onClick={() => act(r.id, "rejected")}>Refuzo</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Historiku im si aprovues */}
                <section className="bg-white p-4 rounded-2xl shadow">
                    <h2 className="text-lg font-semibold mb-2">Historiku im</h2>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left">
                                    <th className="p-2">ReqID</th>
                                    <th className="p-2">Agjenti</th>
                                    <th className="p-2">Artikujt</th>
                                    <th className="p-2">Blerësi/Objekti</th>
                                    <th className="p-2">Shuma</th>
                                    <th className="p-2">Status</th>
                                    <th className="p-2">PDF</th>
                                    <th className="p-2">Data</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hist.length === 0 && (
                                    <tr><td className="p-2 italic opacity-70" colSpan={8}>S’ka ende histori për këtë rol.</td></tr>
                                )}
                                {hist.map((h) => {
                                    const pdf = `${apiBase}/requests/${h.request_id}/pdf?token=${encodeURIComponent(token)}`;
                                    return (
                                        <tr key={`${h.approval_id}-${h.request_id}`} className="odd:bg-gray-50">
                                            <td className="p-2">{h.request_id}</td>
                                            <td className="p-2">{h.first_name} {h.last_name}</td>
                                            <td className="p-2">{h.article_summary || "-"}</td>
                                            <td className="p-2">{h.buyer_code} / {h.buyer_name} {h.site_name ? `• ${h.site_name}` : ""}</td>
                                            <td className="p-2">€{Number(h.amount).toFixed(2)}</td>
                                            <td className="p-2">{h.status} ({h.action})</td>
                                            <td className="p-2"><a className="underline" href={pdf} target="_blank" rel="noreferrer">Shiko</a></td>
                                            <td className="p-2">{new Date(h.acted_at).toLocaleString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}
