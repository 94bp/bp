// client/src/pages/Admin.jsx
import { useEffect, useState } from "react";
import api from "../api";

// === Helpers për JWT & /meta ===
const decodeJwt = () => {
    const t = localStorage.getItem("token");
    if (!t) return null;
    try {
        return JSON.parse(atob(t.split(".")[1] || ""));
    } catch {
        return null;
    }
};

const mergeMetaWithJwt = (data) => {
    const payload = decodeJwt();
    if (!payload) return data || {};
    const me = { ...(data?.me || {}) };
    if (!me.role && payload.role) me.role = payload.role;
    if (me.division_id == null && payload.division_id != null) me.division_id = payload.division_id;
    if (!me.id && payload.id) me.id = payload.id;
    return { ...(data || {}), me };
};

export default function Admin() {
    // guard / meta
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [banner, setBanner] = useState("");

    // forma – divizion / artikull / blerës & objekt
    const [divName, setDivName] = useState("");
    const [art, setArt] = useState({ sku: "", name: "", sell_price: "" });
    const [buyer, setBuyer] = useState({ code: "", name: "" });
    const [site, setSite] = useState({ buyer_id: "", site_code: "", site_name: "" });

    // users (create + edit)
    const [createUser, setCreateUser] = useState({
        first_name: "",
        last_name: "",
        email: "",
        password: "",
        role: "agent",
        division_id: "",
        pda_number: "",
    });
    const [editingId, setEditingId] = useState(null);
    const [editUser, setEditUser] = useState({
        first_name: "",
        last_name: "",
        email: "",
        password: "",
        role: "agent",
        division_id: "",
        pda_number: "",
    });

    // lista
    const [divisions, setDivisions] = useState([]);
    const [listDivs, setListDivs] = useState([]);
    const [listArts, setListArts] = useState([]);
    const [listBuyers, setListBuyers] = useState([]);
    const [listSites, setListSites] = useState([]);
    const [listUsers, setListUsers] = useState([]);

    const toNumOrNull = (v) => (v === "" || v === undefined || v === null ? null : Number(v));

    const safeGet = async (path, fallback = []) => {
        try {
            const { data } = await api.get(path);
            return data ?? fallback;
        } catch (e) {
            const st = e?.response?.status;
            if (st === 404) setBanner((b) => b || "Gabim në ngarkimin e listave.");
            else if (st === 401 || st === 403) setBanner((b) => b || "Sesioni skadoi ose mungojnë të drejtat.");
            else setBanner((b) => b || "Gabim në ngarkimin e listave.");
            return fallback;
        }
    };

    // ===== Bootstrap: /meta -> gjithmonë bashko me JWT nëse /meta s’ka role =====
    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/meta");
                const merged = mergeMetaWithJwt(data || {});
                setMeta(merged);
            } catch {
                // Fallback kur /meta dështon: ndërto meta minimal nga JWT
                const payload = decodeJwt();
                if (payload?.role) {
                    setMeta({
                        me: {
                            id: payload.id,
                            role: payload.role,
                            division_id: payload.division_id ?? null,
                        },
                        buyers: [],
                        sites: [],
                        articles: [],
                    });
                } else {
                    setMeta(null);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    // Kur je admin, ngarko listat (tolerancë 404/401)
    useEffect(() => {
        if (!loading && meta?.me?.role === "admin") {
            (async () => {
                const [divs, arts, buyers, users, sites] = await Promise.all([
                    safeGet("/admin/divisions"),
                    safeGet("/admin/articles"),
                    safeGet("/admin/buyers"),
                    safeGet("/admin/users"),
                    safeGet("/admin/buyer-sites"),
                ]);
                setDivisions(divs);
                setListDivs(divs);
                setListArts(arts);
                setListBuyers(buyers);
                setListUsers(users);
                setListSites(sites);
            })();
        }
    }, [loading, meta]); // eslint-disable-line

    const reloadDivs = async () => setListDivs(await safeGet("/admin/divisions"));
    const reloadArts = async () => setListArts(await safeGet("/admin/articles"));
    const reloadBuyers = async () => {
        setListBuyers(await safeGet("/admin/buyers"));
        setListSites(await safeGet("/admin/buyer-sites"));
    };
    const reloadUsers = async () => setListUsers(await safeGet("/admin/users"));

    if (loading) return null;

    if (!meta?.me || meta.me.role !== "admin") {
        return (
            <div className="p-6">
                <h3 className="text-lg font-semibold">Admin Panel</h3>
                <p className="text-red-600 mt-1">
                    Kjo faqe kërkon rol <b>admin</b>. Dil dhe hyr me llogari admin.
                </p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex justify-between">
                    <h1 className="text-2xl font-semibold">Admin Panel</h1>
                    <a className="text-sm underline" href="/login" onClick={() => localStorage.clear()}>
                        Dalje
                    </a>
                </header>

                {banner && (
                    <div className="bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded">
                        {banner}
                    </div>
                )}

                {/* ================= Divizioni ================= */}
                <section className="bg-white p-4 rounded-2xl shadow space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Divizioni</h2>
                        <button className="text-sm underline" onClick={reloadDivs}>
                            Shfaq të gjithë
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <input
                            className="border p-2 rounded flex-1"
                            placeholder="Emri i divizionit"
                            value={divName}
                            onChange={(e) => setDivName(e.target.value)}
                        />
                        <button
                            className="bg-black text-white px-3 rounded"
                            onClick={async () => {
                                try {
                                    if (!divName.trim()) return;
                                    await api.post("/admin/divisions", { name: divName.trim() });
                                    setDivName("");
                                    await reloadDivs();
                                } catch {
                                    alert("Nuk u ruajt divizioni.");
                                }
                            }}
                        >
                            Ruaj
                        </button>
                    </div>

                    {listDivs.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm mt-3">
                                <thead>
                                    <tr className="text-left">
                                        <th className="p-2">ID</th>
                                        <th className="p-2">Emri</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {listDivs.map((d) => (
                                        <tr key={d.id} className="odd:bg-gray-50">
                                            <td className="p-2">{d.id}</td>
                                            <td className="p-2">{d.name}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* ================= Artikull ================= */}
                <section className="bg-white p-4 rounded-2xl shadow space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Artikull</h2>
                        <button className="text-sm underline" onClick={reloadArts}>
                            Shfaq të gjithë
                        </button>
                    </div>
                    <div className="grid md:grid-cols-4 gap-2">
                        <input
                            className="border p-2 rounded"
                            placeholder="SKU"
                            value={art.sku}
                            onChange={(e) => setArt((a) => ({ ...a, sku: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Emri"
                            value={art.name}
                            onChange={(e) => setArt((a) => ({ ...a, name: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Çmimi"
                            value={art.sell_price}
                            onChange={(e) => setArt((a) => ({ ...a, sell_price: e.target.value }))}
                        />
                        <button
                            className="bg-black text-white rounded"
                            onClick={async () => {
                                try {
                                    if (!art.sku.trim() || !art.name.trim()) {
                                        alert("Shkruaj SKU dhe Emrin.");
                                        return;
                                    }
                                    await api.post("/admin/articles", {
                                        sku: art.sku.trim(),
                                        name: art.name.trim(),
                                        sell_price: art.sell_price === "" ? null : Number(art.sell_price),
                                    });
                                    setArt({ sku: "", name: "", sell_price: "" });
                                    await reloadArts();
                                } catch {
                                    alert("Nuk u ruajt artikulli.");
                                }
                            }}
                        >
                            Ruaj
                        </button>
                    </div>

                    {listArts.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm mt-3">
                                <thead>
                                    <tr className="text-left">
                                        <th className="p-2">ID</th>
                                        <th className="p-2">SKU</th>
                                        <th className="p-2">Emri</th>
                                        <th className="p-2">Çmimi</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {listArts.map((a) => (
                                        <tr key={a.id} className="odd:bg-gray-50">
                                            <td className="p-2">{a.id}</td>
                                            <td className="p-2">{a.sku}</td>
                                            <td className="p-2">{a.name}</td>
                                            <td className="p-2">€{a.sell_price}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* ================= Blerësi & Objekti ================= */}
                <section className="bg-white p-4 rounded-2xl shadow space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Blerësi & Objekti</h2>
                        <button className="text-sm underline" onClick={reloadBuyers}>
                            Shfaq të gjithë
                        </button>
                    </div>

                    <div className="grid md:grid-cols-3 gap-2">
                        <input
                            className="border p-2 rounded"
                            placeholder="Kodi (p.sh. 0012)"
                            value={buyer.code}
                            onChange={(e) => setBuyer((b) => ({ ...b, code: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Emri"
                            value={buyer.name}
                            onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
                        />
                        <button
                            className="bg-black text-white rounded"
                            onClick={async () => {
                                try {
                                    if (!buyer.code.trim() || !buyer.name.trim()) {
                                        alert("Shkruaj kodin dhe emrin e blerësit.");
                                        return;
                                    }
                                    await api.post("/admin/buyers", {
                                        code: buyer.code.trim(),
                                        name: buyer.name.trim(),
                                    });
                                    setBuyer({ code: "", name: "" });
                                    await reloadBuyers();
                                } catch {
                                    alert("Nuk u ruajt blerësi.");
                                }
                            }}
                        >
                            Ruaj Blerësin
                        </button>
                    </div>

                    <div className="grid md:grid-cols-4 gap-2">
                        <select
                            className="border p-2 rounded"
                            value={site.buyer_id}
                            onChange={(e) => setSite((s) => ({ ...s, buyer_id: e.target.value }))}
                        >
                            <option value="">Zgjedh blerësin</option>
                            {(listBuyers.length ? listBuyers : meta.buyers || []).map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.id} - {b.code} {b.name}
                                </option>
                            ))}
                        </select>
                        <input
                            className="border p-2 rounded"
                            placeholder="Kodi i objektit (p.sh. 12)"
                            value={site.site_code}
                            onChange={(e) => setSite((s) => ({ ...s, site_code: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Emri i objektit"
                            value={site.site_name}
                            onChange={(e) => setSite((s) => ({ ...s, site_name: e.target.value }))}
                        />
                        <button
                            className="bg-black text-white rounded"
                            onClick={async () => {
                                try {
                                    if (!site.buyer_id) {
                                        alert("Zgjedh blerësin për objektin.");
                                        return;
                                    }
                                    await api.post("/admin/buyer-sites", {
                                        buyer_id: Number(site.buyer_id),
                                        site_code: site.site_code.trim(),
                                        site_name: site.site_name.trim(),
                                    });
                                    setSite({ buyer_id: "", site_code: "", site_name: "" });
                                    await reloadBuyers();
                                } catch {
                                    alert("Nuk u ruajt objekti.");
                                }
                            }}
                        >
                            Ruaj Objektin
                        </button>
                    </div>

                    {(listBuyers.length > 0 || listSites.length > 0) && (
                        <div className="grid md:grid-cols-2 gap-4 mt-3">
                            <div className="overflow-x-auto">
                                <h3 className="font-medium mb-2">Blerësit</h3>
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left">
                                            <th className="p-2">ID</th>
                                            <th className="p-2">Kodi</th>
                                            <th className="p-2">Emri</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {listBuyers.map((b) => (
                                            <tr key={b.id} className="odd:bg-gray-50">
                                                <td className="p-2">{b.id}</td>
                                                <td className="p-2">{b.code}</td>
                                                <td className="p-2">{b.name}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="overflow-x-auto">
                                <h3 className="font-medium mb-2">Objektet</h3>
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left">
                                            <th className="p-2">ID</th>
                                            <th className="p-2">BuyerID</th>
                                            <th className="p-2">Kodi</th>
                                            <th className="p-2">Emri</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {listSites.map((s) => (
                                            <tr key={s.id} className="odd:bg-gray-50">
                                                <td className="p-2">{s.id}</td>
                                                <td className="p-2">{s.buyer_id}</td>
                                                <td className="p-2">{s.site_code}</td>
                                                <td className="p-2">{s.site_name}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>

                {/* ================= Përdoruesi ================= */}
                <section className="bg-white p-4 rounded-2xl shadow space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Përdoruesi</h2>
                        <button className="text-sm underline" onClick={reloadUsers}>
                            Shfaq të gjithë
                        </button>
                    </div>

                    {/* CREATE */}
                    <div className="grid md:grid-cols-7 gap-2">
                        <input
                            className="border p-2 rounded"
                            placeholder="Emri"
                            value={createUser.first_name}
                            onChange={(e) => setCreateUser((u) => ({ ...u, first_name: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Mbiemri"
                            value={createUser.last_name}
                            onChange={(e) => setCreateUser((u) => ({ ...u, last_name: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Email"
                            value={createUser.email}
                            onChange={(e) => setCreateUser((u) => ({ ...u, email: e.target.value }))}
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Password"
                            type="password"
                            value={createUser.password}
                            onChange={(e) => setCreateUser((u) => ({ ...u, password: e.target.value }))}
                        />
                        <select
                            className="border p-2 rounded"
                            value={createUser.role}
                            onChange={(e) => setCreateUser((u) => ({ ...u, role: e.target.value }))}
                        >
                            {["agent", "team_lead", "division_manager", "sales_director", "admin"].map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                        <select
                            className="border p-2 rounded"
                            value={createUser.division_id}
                            onChange={(e) => setCreateUser((u) => ({ ...u, division_id: e.target.value }))}
                        >
                            <option value="">Divizioni (id - emri)</option>
                            {divisions.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.id} - {d.name}
                                </option>
                            ))}
                        </select>
                        <input
                            className="border p-2 rounded"
                            placeholder="PDA (vetëm agent)"
                            value={createUser.pda_number}
                            onChange={(e) => setCreateUser((u) => ({ ...u, pda_number: e.target.value }))}
                        />

                        <button
                            className="bg-black text-white rounded md:col-span-7"
                            onClick={async () => {
                                try {
                                    if (!createUser.email?.trim() || !createUser.password?.trim()) {
                                        alert("Shkruaj Email dhe Password");
                                        return;
                                    }
                                    const payload = {
                                        ...createUser,
                                        division_id: createUser.division_id ? Number(createUser.division_id) : null,
                                    };
                                    await api.post("/admin/users", payload);
                                    setCreateUser({
                                        first_name: "",
                                        last_name: "",
                                        email: "",
                                        password: "",
                                        role: "agent",
                                        division_id: "",
                                        pda_number: "",
                                    });
                                    await reloadUsers();
                                } catch (e) {
                                    const msg =
                                        e?.response?.data?.error === "Ky email ekziston"
                                            ? "Ky email ekziston!"
                                            : e?.response?.data?.error || "Gabim gjatë krijimit.";
                                    alert(msg);
                                }
                            }}
                        >
                            Krijo Përdorues
                        </button>
                    </div>

                    {/* LIST + EDIT/DELETE */}
                    {listUsers.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm mt-3">
                                <thead>
                                    <tr className="text-left">
                                        <th className="p-2">ID</th>
                                        <th className="p-2">Emri</th>
                                        <th className="p-2">Email</th>
                                        <th className="p-2">Roli</th>
                                        <th className="p-2">Divizion (ID)</th>
                                        <th className="p-2">PDA</th>
                                        <th className="p-2">Krijuar</th>
                                        <th className="p-2">Veprime</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {listUsers.map((u) => {
                                        const isEdit = editingId === u.id;
                                        return (
                                            <tr key={u.id} className="odd:bg-gray-50 align-top">
                                                <td className="p-2">{u.id}</td>

                                                {/* Emri + Mbiemri */}
                                                <td className="p-2">
                                                    {isEdit ? (
                                                        <div className="flex gap-1">
                                                            <input
                                                                className="border p-1 rounded w-28"
                                                                value={editUser.first_name}
                                                                onChange={(e) => setEditUser((v) => ({ ...v, first_name: e.target.value }))}
                                                                placeholder="Emri"
                                                            />
                                                            <input
                                                                className="border p-1 rounded w-28"
                                                                value={editUser.last_name}
                                                                onChange={(e) => setEditUser((v) => ({ ...v, last_name: e.target.value }))}
                                                                placeholder="Mbiemri"
                                                            />
                                                        </div>
                                                    ) : (
                                                        `${u.first_name} ${u.last_name}`.trim()
                                                    )}
                                                </td>

                                                {/* Email */}
                                                <td className="p-2">
                                                    {isEdit ? (
                                                        <input
                                                            className="border p-1 rounded w-52"
                                                            value={editUser.email}
                                                            onChange={(e) => setEditUser((v) => ({ ...v, email: e.target.value }))}
                                                            placeholder="Email"
                                                        />
                                                    ) : (
                                                        u.email
                                                    )}
                                                </td>

                                                {/* Role */}
                                                <td className="p-2">
                                                    {isEdit ? (
                                                        <select
                                                            className="border p-1 rounded"
                                                            value={editUser.role}
                                                            onChange={(e) => setEditUser((v) => ({ ...v, role: e.target.value }))}
                                                        >
                                                            {["agent", "team_lead", "division_manager", "sales_director", "admin"].map((r) => (
                                                                <option key={r} value={r}>{r}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        u.role
                                                    )}
                                                </td>

                                                {/* Division */}
                                                <td className="p-2">
                                                    {isEdit ? (
                                                        <select
                                                            className="border p-1 rounded"
                                                            value={editUser.division_id}
                                                            onChange={(e) => setEditUser((v) => ({ ...v, division_id: e.target.value }))}
                                                        >
                                                            <option value="">(asnjë)</option>
                                                            {divisions.map((d) => (
                                                                <option key={d.id} value={d.id}>
                                                                    {d.id} - {d.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <>
                                                            {u.division_id ?? ""} {u.division_name ? `- ${u.division_name}` : ""}
                                                        </>
                                                    )}
                                                </td>

                                                {/* PDA */}
                                                <td className="p-2">
                                                    {isEdit ? (
                                                        <input
                                                            className="border p-1 rounded w-24"
                                                            value={editUser.pda_number ?? ""}
                                                            onChange={(e) => setEditUser((v) => ({ ...v, pda_number: e.target.value }))}
                                                            placeholder="PDA"
                                                        />
                                                    ) : (
                                                        u.pda_number ?? ""
                                                    )}
                                                </td>

                                                {/* Created */}
                                                <td className="p-2">{new Date(u.created_at).toLocaleString()}</td>

                                                {/* Actions */}
                                                <td className="p-2">
                                                    {isEdit ? (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                className="border p-1 rounded w-36"
                                                                type="password"
                                                                placeholder="Password i ri (ops.)"
                                                                value={editUser.password}
                                                                onChange={(e) => setEditUser((v) => ({ ...v, password: e.target.value }))}
                                                            />
                                                            <button
                                                                className="px-3 py-1 rounded bg-black text-white"
                                                                onClick={async () => {
                                                                    try {
                                                                        const payload = {
                                                                            first_name: editUser.first_name,
                                                                            last_name: editUser.last_name,
                                                                            email: editUser.email,
                                                                            role: editUser.role,
                                                                            division_id: toNumOrNull(editUser.division_id),
                                                                            pda_number: editUser.pda_number ?? "",
                                                                        };
                                                                        if (editUser.password?.trim())
                                                                            payload.password = editUser.password.trim();
                                                                        await api.put(`/admin/users/${u.id}`, payload);
                                                                        setEditingId(null);
                                                                        setEditUser({
                                                                            first_name: "",
                                                                            last_name: "",
                                                                            email: "",
                                                                            password: "",
                                                                            role: "agent",
                                                                            division_id: "",
                                                                            pda_number: "",
                                                                        });
                                                                        await reloadUsers();
                                                                    } catch (e) {
                                                                        const msg =
                                                                            e?.response?.data?.error === "Ky email ekziston"
                                                                                ? "Ky email ekziston!"
                                                                                : e?.response?.data?.error || "Gabim gjatë ruajtjes.";
                                                                        alert(msg);
                                                                    }
                                                                }}
                                                            >
                                                                Ruaj
                                                            </button>
                                                            <button
                                                                className="px-3 py-1 rounded border"
                                                                onClick={() => {
                                                                    setEditingId(null);
                                                                    setEditUser({
                                                                        first_name: "",
                                                                        last_name: "",
                                                                        email: "",
                                                                        password: "",
                                                                        role: "agent",
                                                                        division_id: "",
                                                                        pda_number: "",
                                                                    });
                                                                }}
                                                            >
                                                                Anulo
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                className="text-blue-600 underline"
                                                                onClick={() => {
                                                                    setEditingId(u.id);
                                                                    setEditUser({
                                                                        first_name: u.first_name || "",
                                                                        last_name: u.last_name || "",
                                                                        email: u.email || "",
                                                                        password: "",
                                                                        role: u.role || "agent",
                                                                        division_id: u.division_id ? String(u.division_id) : "",
                                                                        pda_number: u.pda_number ?? "",
                                                                    });
                                                                }}
                                                            >
                                                                Edit
                                                            </button>
                                                            <button
                                                                className="text-red-600 underline"
                                                                onClick={async () => {
                                                                    if (!window.confirm("Fshi këtë përdorues?")) return;
                                                                    try {
                                                                        await api.delete(`/admin/users/${u.id}`);
                                                                        await reloadUsers();
                                                                    } catch (e) {
                                                                        const msg = e?.response?.data?.error || "Gabim gjatë fshirjes.";
                                                                        alert(msg);
                                                                    }
                                                                }}
                                                            >
                                                                Fshi
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
