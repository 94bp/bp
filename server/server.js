// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

import { q } from "./db.js";
import { signJWT, compare, hash, requireAuth, requireRole } from "./auth.js";
import { requiredRoleForAmount } from "./approvalLogic.js";

dotenv.config();

/* ----------------------------- ENV NORMALIZER ----------------------------- */
process.env.LEJIMET_EMAIL = (process.env.LEJIMET_EMAIL || process.env.FINAL_APPROVAL_EMAIL || "").trim();
process.env.MAIL_FROM = (process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();

console.log("[ENV] LEJIMET_EMAIL =", process.env.LEJIMET_EMAIL || "(empty)");
console.log("[ENV] MAIL_FROM     =", process.env.MAIL_FROM || "(empty)");

/* --------------------------------- APP ----------------------------------- */
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

/* -------------------------------- HELPERS -------------------------------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const fmtMoney = (n) => Number(n || 0).toFixed(2);
const cleanId = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Ngarkon të dhënat e plota të një kërkese për PDF/email */
async function loadRequestForPdf(reqId) {
    const rq = await q(
        `SELECT
       r.*,
       ag.first_name  AS agent_first,
       ag.last_name   AS agent_last,
       ag.email       AS agent_email,
       ag.pda_number  AS agent_pda,
       d.name         AS division_name,
       b.code         AS buyer_code,
       b.name         AS buyer_name,
       s.site_code,
       s.site_name,
       a.sku          AS single_sku,
       a.name         AS single_name,
       a.sell_price   AS single_price
     FROM requests r
     JOIN users ag         ON ag.id=r.agent_id
     LEFT JOIN divisions d ON d.id=r.division_id
     JOIN buyers b         ON b.id=r.buyer_id
     LEFT JOIN buyer_sites s ON s.id=r.site_id
     LEFT JOIN articles a  ON a.id=r.article_id
     WHERE r.id=$1`,
        [reqId]
    );
    if (!rq.rowCount) throw new Error("Request not found");
    const reqRow = rq.rows[0];

    const itemsRes = await q(
        `SELECT ri.article_id, ri.quantity, ri.line_amount,
            a.sku, a.name, a.sell_price
       FROM request_items ri
       JOIN articles a ON a.id=ri.article_id
      WHERE ri.request_id=$1
      ORDER BY ri.id`,
        [reqId]
    );
    let items = itemsRes.rows;
    if (!items.length && reqRow.article_id) {
        items = [
            {
                article_id: reqRow.article_id,
                quantity: reqRow.quantity || 1,
                line_amount: reqRow.amount,
                sku: reqRow.single_sku,
                name: reqRow.single_name,
                sell_price: reqRow.single_price,
            },
        ];
    }

    const approvals = await q(
        `SELECT a.*, u.first_name, u.last_name
       FROM approvals a
       JOIN users u ON u.id=a.approver_id
      WHERE a.request_id=$1
      ORDER BY a.acted_at`,
        [reqId]
    );

    return { reqRow, items, approvals: approvals.rows };
}

/** Nxjerr emailet e aprovuesve bazuar në rolin e kërkuar */
async function approverEmailsFor(reqRow) {
    if (reqRow.required_role === "team_lead") {
        const r = await q(
            "SELECT email FROM users WHERE role='team_lead' AND division_id=$1 AND email IS NOT NULL",
            [reqRow.division_id]
        );
        return r.rows.map((x) => x.email).filter(Boolean);
    }
    if (reqRow.required_role === "division_manager") {
        const r = await q(
            "SELECT email FROM users WHERE role='division_manager' AND division_id=$1 AND email IS NOT NULL",
            [reqRow.division_id]
        );
        return r.rows.map((x) => x.email).filter(Boolean);
    }
    const r = await q(
        "SELECT email FROM users WHERE role='sales_director' AND email IS NOT NULL"
    );
    return r.rows.map((x) => x.email).filter(Boolean);
}

/** Ndërton PDF dhe kthen Buffer */
function pdfFromRequestRows({ reqRow, items, approvals }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40 });
        const chunks = [];
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        doc.fontSize(16).text("KËRKESË LEJIM FINANCIAR", { align: "center" });
        doc.moveDown(0.5);
        doc
            .fontSize(10)
            .text(`#${reqRow.id} • ${new Date(reqRow.created_at).toLocaleString()}`, {
                align: "center",
            });
        doc.moveDown();

        doc
            .fontSize(11)
            .text(
                `Agjent: ${reqRow.agent_first} ${reqRow.agent_last}  •  PDA: ${reqRow.agent_pda || "-"
                }`
            );
        doc.text(`Divizioni: ${reqRow.division_name || "-"}`).moveDown(0.5);

        doc.text(`Blerësi: ${reqRow.buyer_code}  ${reqRow.buyer_name}`);
        doc.text(
            `Objekti: ${reqRow.site_code ? reqRow.site_code + " — " + (reqRow.site_name || "") : "-"
            }`
        ).moveDown(0.5);

        doc.text(`Nr. ndërlidhës i faturës: ${reqRow.invoice_ref || "-"}`);
        doc.text(`Arsyeja: ${reqRow.reason || "-"}`).moveDown();

        doc.fontSize(12).text("Artikujt", { underline: true }).moveDown(0.5);

        const startX = doc.x;
        const widths = [80, 180, 60, 40, 60, 70]; // SKU, Emri, Çmimi, Qty, Lejimi, Shuma
        const [wSku, wName, wPrice, wQty, wDisc, wTotal] = widths;

        doc.fontSize(10).font("Helvetica-Bold");
        doc.text("SKU", startX, doc.y, { width: wSku });
        doc.text("Artikulli", startX + wSku, doc.y, { width: wName });
        doc.text("Çmimi", startX + wSku + wName, doc.y, {
            width: wPrice,
            align: "right",
        });
        doc.text("Qty", startX + wSku + wName + wPrice, doc.y, {
            width: wQty,
            align: "right",
        });
        doc.text("Lejimi", startX + wSku + wName + wPrice + wQty, doc.y, {
            width: wDisc,
            align: "right",
        });
        doc.text("Shuma", startX + wSku + wName + wPrice + wQty + wDisc, doc.y, {
            width: wTotal,
            align: "right",
        });
        doc.moveDown(0.4).font("Helvetica");
        doc
            .moveTo(startX, doc.y)
            .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
            .stroke()
            .moveDown(0.3);

        let total = 0;
        items.forEach((it) => {
            const price = Number(it.sell_price || 0);
            const qty = Number(it.quantity || 1);
            const line = Number(it.line_amount || 0);
            total += line;

            const listTotal = price * qty;
            const discPct = listTotal > 0 ? Math.max(0, 1 - line / listTotal) * 100 : 0;

            const y = doc.y;
            doc.text(it.sku || "-", startX, y, { width: wSku });
            doc.text(it.name || "-", startX + wSku, y, { width: wName });
            doc.text(fmtMoney(price), startX + wSku + wName, y, {
                width: wPrice,
                align: "right",
            });
            doc.text(String(qty), startX + wSku + wName + wPrice, y, {
                width: wQty,
                align: "right",
            });
            doc.text(`${discPct.toFixed(2)}%`, startX + wSku + wName + wPrice + wQty, y, {
                width: wDisc,
                align: "right",
            });
            doc.text(fmtMoney(line), startX + wSku + wName + wPrice + wQty + wDisc, y, {
                width: wTotal,
                align: "right",
            });
            doc.moveDown(0.2);
        });

        doc.moveDown(0.3);
        doc
            .moveTo(startX, doc.y)
            .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
            .stroke()
            .moveDown(0.2);
        doc
            .font("Helvetica-Bold")
            .text(`Totali: €${fmtMoney(total)}`, { align: "right" })
            .font("Helvetica")
            .moveDown();

        doc.text(`Status: ${reqRow.status}  •  Kërkohet nga: ${reqRow.required_role}`).moveDown();

        doc.fontSize(12).text("Aprovime", { underline: true }).moveDown(0.5);
        if (!approvals.length) {
            doc.fontSize(10).text("— ende pa veprim —");
        } else {
            approvals.forEach((a) => {
                const nm = `${a.first_name || ""} ${a.last_name || ""}`.trim();
                doc
                    .fontSize(10)
                    .text(
                        `• ${new Date(a.acted_at).toLocaleString()} — ${nm} (${a.approver_role
                        }) — ${a.action}${a.comment ? " — " + a.comment : ""}`
                    );
            });
        }
        doc.end();
    });
}

/* ------------------------------- SMTP / EMAIL ------------------------------ */
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE =
    String(process.env.SMTP_SECURE ?? (SMTP_PORT === 465)).toLowerCase() === "true";

const mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    greetingTimeout: 15000,
    connectionTimeout: 15000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: true, servername: process.env.SMTP_HOST },
    logger: true,
    debug: true,
});

mailTransport.verify().then(
    () =>
        console.log("SMTP OK:", {
            host: process.env.SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
        }),
    (e) => console.error("SMTP ERR:", e?.message || e)
);

async function sendMail({ to, cc, subject, html, attachments }) {
    let toList = Array.isArray(to) ? to : to ? [to] : [];
    if (!toList.length && process.env.LEJIMET_EMAIL) {
        console.warn("sendMail: pa marrës — fallback te LEJIMET_EMAIL");
        toList = [process.env.LEJIMET_EMAIL];
    }
    if (!toList.length) {
        console.warn("sendMail: pa marrës dhe s’ka LEJIMET_EMAIL — anashkalohet");
        return;
    }
    const info = await mailTransport.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: toList,
        cc,
        subject,
        html,
        attachments,
    });
    console.log("MAIL_OK:", info.messageId, "=>", toList.join(", "));
}

/* --------------------------------- HEALTH -------------------------------- */
app.get("/", (_req, res) => res.send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---------------------------------- AUTH --------------------------------- */
app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body ?? {};
        if (!email || !password)
            return res.status(400).json({ error: "Missing email or password" });

        const r = await q("SELECT * FROM users WHERE email=$1", [email]);
        if (!r.rowCount) return res.status(401).json({ error: "Invalid creds" });

        const u = r.rows[0];
        if (!u.password_hash) return res.status(401).json({ error: "Invalid creds" });

        const ok = await compare(password, u.password_hash);
        if (!ok) return res.status(401).json({ error: "Invalid creds" });

        // last_login: krijo kolonën nëse mungon, pastaj përditëso
        try {
            await q("UPDATE users SET last_login = NOW() WHERE id=$1", [u.id]);
        } catch (err) {
            if (err.code === "42703") {
                try {
                    await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ");
                    await q("UPDATE users SET last_login = NOW() WHERE id=$1", [u.id]);
                } catch (e2) {
                    console.warn("LAST_LOGIN_ADD_FAIL:", e2.message);
                }
            } else {
                console.warn("LAST_LOGIN_WARN:", err.message);
            }
        }

        res.json({
            token: signJWT(u),
            profile: {
                id: u.id,
                first_name: u.first_name,
                last_name: u.last_name,
                role: u.role,
                division_id: u.division_id,
                pda_number: u.pda_number,
            },
        });
    } catch (e) {
        console.error("LOGIN_ERR:", e);
        res.status(500).json({ error: "server", detail: e.message });
    }
});

/* ----------------------------- ADMIN LIST/CRUD ---------------------------- */
/** DIVISIONS */
app.get("/admin/divisions", requireAuth, requireRole("admin"), async (_req, res) => {
    const r = await q("SELECT id,name FROM divisions ORDER BY id");
    res.json(r.rows);
});
app.post("/admin/divisions", requireAuth, requireRole("admin"), async (req, res) => {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Emri mungon" });
    const r = await q("INSERT INTO divisions(name) VALUES($1) RETURNING id", [name]);
    res.json({ id: r.rows[0].id });
});

/** ARTICLES */
app.get("/admin/articles", requireAuth, requireRole("admin"), async (_req, res) => {
    const r = await q("SELECT id,sku,name,sell_price FROM articles ORDER BY id");
    res.json(r.rows);
});
app.post("/admin/articles", requireAuth, requireRole("admin"), async (req, res) => {
    const sku = (req.body?.sku || "").trim();
    const name = (req.body?.name || "").trim();
    const price =
        req.body?.sell_price === "" || req.body?.sell_price == null
            ? null
            : Number(req.body.sell_price);
    if (!sku || !name)
        return res.status(400).json({ error: "SKU dhe Emri janë të detyrueshme" });
    const r = await q(
        "INSERT INTO articles(sku,name,sell_price) VALUES($1,$2,$3) RETURNING id",
        [sku, name, price]
    );
    res.json({ id: r.rows[0].id });
});

/** BUYERS */
app.get("/admin/buyers", requireAuth, requireRole("admin"), async (_req, res) => {
    const r = await q("SELECT id,code,name FROM buyers ORDER BY id");
    res.json(r.rows);
});
app.post("/admin/buyers", requireAuth, requireRole("admin"), async (req, res) => {
    const code = (req.body?.code || "").trim();
    const name = (req.body?.name || "").trim();
    if (!code || !name)
        return res.status(400).json({ error: "Kodi dhe Emri janë të detyrueshme" });
    const r = await q(
        "INSERT INTO buyers(code,name) VALUES($1,$2) RETURNING id",
        [code, name]
    );
    res.json({ id: r.rows[0].id });
});

/** BUYER SITES */
app.get("/admin/buyer-sites", requireAuth, requireRole("admin"), async (req, res) => {
    const { buyer_id } = req.query;
    const sql =
        "SELECT id,buyer_id,site_code,site_name FROM buyer_sites " +
        (buyer_id ? "WHERE buyer_id=$1 " : "") +
        "ORDER BY id";
    const r = await q(sql, buyer_id ? [Number(buyer_id)] : []);
    res.json(r.rows);
});
app.post("/admin/buyer-sites", requireAuth, requireRole("admin"), async (req, res) => {
    const buyer_id = Number(req.body?.buyer_id);
    const site_code = (req.body?.site_code || "").trim();
    const site_name = (req.body?.site_name || "").trim();
    if (!buyer_id) return res.status(400).json({ error: "buyer_id mungon" });
    if (!site_code || !site_name)
        return res.status(400).json({ error: "Kodi/Emri i objektit mungon" });
    const r = await q(
        "INSERT INTO buyer_sites(buyer_id,site_code,site_name) VALUES($1,$2,$3) RETURNING id",
        [buyer_id, site_code, site_name]
    );
    res.json({ id: r.rows[0].id });
});

/** USERS (create/list/edit/delete) */
app.post("/admin/users", requireAuth, requireRole("admin"), async (req, res) => {
    try {
        const {
            first_name,
            last_name,
            email,
            password,
            role,
            division_id,
            pda_number,
        } = req.body ?? {};
        if (!email?.trim() || !password?.trim())
            return res
                .status(400)
                .json({ error: "Email dhe password janë të detyrueshme" });
        const ph = await hash(password);
        const r = await q(
            "INSERT INTO users(first_name,last_name,email,password_hash,role,division_id,pda_number) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [first_name || "", last_name || "", email.trim(), ph, role, division_id || null, pda_number || null]
        );
        res.json({ id: r.rows[0].id });
    } catch (e) {
        if (e.code === "23505") return res.status(409).json({ error: "Ky email ekziston" });
        console.error("ADMIN_CREATE_USER_ERR:", e);
        res.status(500).json({ error: "server" });
    }
});

app.get("/admin/users", requireAuth, requireRole("admin"), async (_req, res) => {
    const r = await q(
        `SELECT u.id,u.first_name,u.last_name,u.email,u.role,u.division_id,
            d.name AS division_name,u.pda_number,u.created_at
       FROM users u
       LEFT JOIN divisions d ON d.id=u.division_id
      ORDER BY u.id`
    );
    res.json(r.rows);
});

app.put("/admin/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const id = Number(req.params.id);
    const {
        first_name = "",
        last_name = "",
        email = "",
        password = "",
        role,
        division_id,
        pda_number,
    } = req.body || {};
    if (!id) return res.status(400).json({ error: "id" });

    try {
        if (email) {
            const chk = await q("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [email, id]);
            if (chk.rowCount) return res.status(409).json({ error: "Ky email ekziston" });
        }

        if (password && password.trim()) {
            const ph = await hash(password.trim());
            await q(
                "UPDATE users SET first_name=$1,last_name=$2,email=$3,password_hash=$4,role=$5,division_id=$6,pda_number=$7 WHERE id=$8",
                [first_name, last_name, email, ph, role, division_id || null, pda_number || null, id]
            );
        } else {
            await q(
                "UPDATE users SET first_name=$1,last_name=$2,email=$3,role=$4,division_id=$5,pda_number=$6 WHERE id=$7",
                [first_name, last_name, email, role, division_id || null, pda_number || null, id]
            );
        }
        res.json({ ok: true });
    } catch (e) {
        console.error("ADMIN_UPDATE_USER_ERR:", e);
        res.status(500).json({ error: "server" });
    }
});

app.delete("/admin/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id" });
    try {
        await q("DELETE FROM users WHERE id=$1", [id]);
        res.json({ ok: true });
    } catch (e) {
        console.error("ADMIN_DELETE_USER_ERR:", e);
        res.status(500).json({ error: "server" });
    }
});

/* ----------------------------------- META -------------------------------- */
app.get("/meta", requireAuth, async (req, res) => {
    const [buyers, sites, articles, me] = await Promise.all([
        q("SELECT id,code,name FROM buyers ORDER BY code"),
        q("SELECT id,buyer_id,site_code,site_name FROM buyer_sites ORDER BY site_code"),
        q("SELECT id,sku,name,sell_price FROM articles ORDER BY sku"),
        q(
            "SELECT u.id,u.first_name,u.last_name,u.pda_number,u.division_id,d.name as division_name FROM users u LEFT JOIN divisions d ON d.id=u.division_id WHERE u.id=$1",
            [req.user.id]
        ),
    ]);
    res.json({
        buyers: buyers.rows,
        sites: sites.rows,
        articles: articles.rows,
        me: me.rows[0],
    });
});

/* --------------------------- REQUESTS / APPROVALS -------------------------- */
// CREATE request (single/multi-line)
app.post(
    "/requests",
    requireAuth,
    requireRole("agent", "admin"),
    async (req, res) => {
        const {
            buyer_id,
            site_id,
            article_id,
            quantity = 1,
            amount,
            invoice_ref,
            reason,
            items,
        } = req.body;

        const buyerIdClean = cleanId(buyer_id);
        if (!buyerIdClean) return res.status(400).json({ error: "Zgjedh blerësin (buyer_id)" });
        const siteIdClean = cleanId(site_id);

        const me = await q("SELECT division_id,email,first_name,last_name FROM users WHERE id=$1", [req.user.id]);
        const division_id = me.rows[0].division_id;

        let totalAmount = 0;
        let normalizedItems = [];

        if (Array.isArray(items) && items.length > 0) {
            const ids = [...new Set(items.map((i) => Number(i.article_id)).filter(Boolean))];
            const priceById = new Map();
            if (ids.length) {
                const prices = await q("SELECT id, sell_price FROM articles WHERE id = ANY($1::int[])", [ids]);
                prices.rows.forEach((r) => priceById.set(r.id, Number(r.sell_price)));
            }
            normalizedItems = items.map((i) => {
                const qty = Number(i.quantity || 1);
                const aid = Number(i.article_id);
                const la =
                    i.line_amount != null
                        ? Number(i.line_amount)
                        : Number((priceById.get(aid) || 0) * qty);
                return { article_id: aid, quantity: qty, line_amount: la };
            });
            totalAmount = normalizedItems.reduce(
                (s, it) => s + (Number(it.line_amount) || 0),
                0
            );
        } else {
            totalAmount = Number(amount || 0);
        }

        const needed = requiredRoleForAmount(totalAmount);

        const r = await q(
            `INSERT INTO requests(agent_id,division_id,buyer_id,site_id,article_id,quantity,amount,invoice_ref,reason,required_role)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [
                req.user.id,
                division_id,
                buyerIdClean,
                siteIdClean,
                Array.isArray(items) && items.length > 0 ? null : article_id || null,
                Array.isArray(items) && items.length > 0 ? null : quantity || 1,
                totalAmount,
                invoice_ref || null,
                reason || null,
                needed,
            ]
        );
        const reqId = r.rows[0].id;

        if (normalizedItems.length) {
            const values = normalizedItems.flatMap((it) => [
                reqId,
                it.article_id,
                it.quantity,
                it.line_amount,
            ]);
            const placeholders = normalizedItems
                .map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`)
                .join(",");
            await q(
                `INSERT INTO request_items(request_id,article_id,quantity,line_amount) VALUES ${placeholders}`,
                values
            );
        }

        // Email te aprovuesit (me PDF)
        try {
            const { reqRow, items: its, approvals } = await loadRequestForPdf(reqId);
            let to = await approverEmailsFor(reqRow);
            if (!to || !to.length) {
                console.warn("Nuk u gjetën aprovues me email; dërgo te LEJIMET_EMAIL");
                to = process.env.LEJIMET_EMAIL ? [process.env.LEJIMET_EMAIL] : [];
            }
            const pdfBuf = await pdfFromRequestRows({ reqRow, items: its, approvals });
            await sendMail({
                to,
                cc: reqRow.agent_email,
                subject: `[Fin Approvals] Kërkesë #${reqRow.id} • ${reqRow.buyer_code} ${reqRow.buyer_name} • €${fmtMoney(
                    reqRow.amount
                )}`,
                html: `
          <p>Përshëndetje,</p>
          <p>Kërkesë e re nga <b>${reqRow.agent_first} ${reqRow.agent_last}</b> (Divizioni: ${reqRow.division_name || "-"
                    }).</p>
          <p><b>Totali:</b> €${fmtMoney(
                        reqRow.amount
                    )} · <b>Kërkohet nga:</b> ${reqRow.required_role}</p>
          <p><a href="${APP_URL}/approvals" target="_blank">Hape listën e aprovimeve</a></p>`,
                attachments: [
                    {
                        filename: `kerkes-${reqRow.id}.pdf`,
                        content: pdfBuf,
                        contentType: "application/pdf",
                    },
                ],
            });
        } catch (e) {
            console.error("EMAIL_ON_CREATE_ERR:", e?.message || e);
        }

        res.json({ id: reqId });
    }
);

// PDF endpoint
app.get("/requests/:id/pdf", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    try {
        const { reqRow, items, approvals } = await loadRequestForPdf(id);
        const buf = await pdfFromRequestRows({ reqRow, items, approvals });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="kerkes-${id}.pdf"`);
        res.send(buf);
    } catch (e) {
        console.error("PDF_ERR:", e?.message || e);
        res.status(404).json({ error: "Not found" });
    }
});

// Lista e kërkesave të agjentit
app.get(
    "/requests/my",
    requireAuth,
    requireRole("agent", "admin"),
    async (req, res) => {
        const r = await q(
            `SELECT
        r.*,
        b.code  AS buyer_code, b.name AS buyer_name,
        s.site_name,
        a.sku, a.name AS article_name,
        COALESCE(
          (SELECT json_agg(json_build_object(
              'article_id', ri.article_id,
              'sku', aa.sku,
              'name', aa.name,
              'quantity', ri.quantity,
              'line_amount', ri.line_amount
          ) ORDER BY ri.id)
          FROM request_items ri
          JOIN articles aa ON aa.id=ri.article_id
          WHERE ri.request_id=r.id), '[]'::json
        ) AS items,
        CASE
          WHEN EXISTS (SELECT 1 FROM request_items x WHERE x.request_id=r.id)
          THEN (SELECT string_agg(aa.sku || ' x' || ri.quantity, ', ')
                FROM request_items ri JOIN articles aa ON aa.id=ri.article_id
                WHERE ri.request_id=r.id)
          ELSE a.name
        END AS article_summary
     FROM requests r
     JOIN buyers b ON b.id=r.buyer_id
     LEFT JOIN buyer_sites s ON s.id=r.site_id
     LEFT JOIN articles a ON a.id=r.article_id
     WHERE r.agent_id=$1
     ORDER BY r.id DESC`,
            [req.user.id]
        );
        res.json(r.rows);
    }
);

// Pending për aprovuesit
app.get(
    "/approvals/pending",
    requireAuth,
    requireRole("team_lead", "division_manager", "sales_director"),
    async (req, res) => {
        const whereDiv =
            req.user.role === "team_lead" || req.user.role === "division_manager"
                ? "AND r.division_id=$2"
                : "";
        const params =
            req.user.role === "sales_director"
                ? [req.user.role]
                : [req.user.role, req.user.division_id];
        const r = await q(
            `SELECT
        r.*,
        u.first_name,u.last_name,
        a.sku, a.name AS article_name,
        b.code AS buyer_code,
        s.site_name,
        COALESCE(
          (SELECT json_agg(json_build_object(
              'article_id', ri.article_id,
              'sku', aa.sku,
              'name', aa.name,
              'quantity', ri.quantity,
              'line_amount', ri.line_amount
          ) ORDER BY ri.id)
          FROM request_items ri
          JOIN articles aa ON aa.id=ri.article_id
          WHERE ri.request_id=r.id), '[]'::json
        ) AS items,
        CASE
          WHEN EXISTS (SELECT 1 FROM request_items x WHERE x.request_id=r.id)
          THEN (SELECT string_agg(aa.sku || ' x' || ri.quantity, ', ')
                FROM request_items ri JOIN articles aa ON aa.id=ri.article_id
                WHERE ri.request_id=r.id)
          ELSE a.name
        END AS article_summary
     FROM requests r
     JOIN users u   ON u.id=r.agent_id
     JOIN buyers b  ON b.id=r.buyer_id
     LEFT JOIN buyer_sites s ON s.id=r.site_id
     LEFT JOIN articles a ON a.id=r.article_id
     WHERE r.status='pending' AND r.required_role=$1 ${whereDiv}
     ORDER BY r.created_at DESC`,
            params
        );
        res.json(r.rows);
    }
);

// Veprimi i aprovuesit (+ email te LEJIMET + CC agjentit)
app.post(
    "/approvals/:id/act",
    requireAuth,
    requireRole("team_lead", "division_manager", "sales_director"),
    async (req, res) => {
        const id = Number(req.params.id);
        const { action, comment } = req.body || {};
        if (!id || !["approved", "rejected"].includes(action))
            return res.status(400).json({ error: "Bad request" });

        const rr = await q("SELECT * FROM requests WHERE id=$1", [id]);
        if (!rr.rowCount) return res.status(404).json({ error: "Not found" });
        const reqRow = rr.rows[0];

        if (reqRow.required_role !== req.user.role || reqRow.status !== "pending")
            return res.status(403).json({ error: "Not your turn" });

        await q(
            "INSERT INTO approvals(request_id,approver_id,approver_role,action,comment) VALUES($1,$2,$3,$4,$5)",
            [id, req.user.id, req.user.role, action, comment || null]
        );

        if (action === "rejected") {
            await q("UPDATE requests SET status='rejected' WHERE id=$1", [id]);
            return res.json({ ok: true });
        }

        if (reqRow.required_role === "team_lead") {
            if (reqRow.amount <= 99)
                await q("UPDATE requests SET status='approved' WHERE id=$1", [id]);
            else
                await q("UPDATE requests SET required_role='division_manager' WHERE id=$1", [
                    id,
                ]);
        } else if (reqRow.required_role === "division_manager") {
            if (reqRow.amount <= 199)
                await q("UPDATE requests SET status='approved' WHERE id=$1", [id]);
            else
                await q("UPDATE requests SET required_role='sales_director' WHERE id=$1", [
                    id,
                ]);
        } else {
            await q("UPDATE requests SET status='approved' WHERE id=$1", [id]);
        }

        // njoftimi me PDF
        try {
            const { reqRow: rq, items, approvals } = await loadRequestForPdf(id);
            const pdfBuf = await pdfFromRequestRows({ reqRow: rq, items, approvals });
            const approver = await q("SELECT first_name,last_name FROM users WHERE id=$1", [
                req.user.id,
            ]);
            const apprName = `${approver.rows[0]?.first_name || ""} ${approver.rows[0]?.last_name || ""
                }`.trim();

            await sendMail({
                to: process.env.LEJIMET_EMAIL,
                cc: rq.agent_email,
                subject: `[Fin Approvals] APROVIM • #${rq.id} • €${fmtMoney(rq.amount)}`,
                html: `<p>Kërkesa #${rq.id} u <b>aprovua</b> nga ${apprName} (${req.user.role}).</p>
               <p>Blerësi: ${rq.buyer_code} / ${rq.buyer_name} · Totali: €${fmtMoney(
                    rq.amount
                )}</p>`,
                attachments: [
                    {
                        filename: `kerkes-${rq.id}.pdf`,
                        content: pdfBuf,
                        contentType: "application/pdf",
                    },
                ],
            });
        } catch (e) {
            console.error("EMAIL_ON_APPROVE_ERR:", e?.message || e);
        }

        res.json({ ok: true });
    }
);

// Historia e një kërkese
app.get("/approvals/history/:reqId", requireAuth, async (req, res) => {
    const r = await q(
        `SELECT a.*, u.first_name,u.last_name
       FROM approvals a
       JOIN users u ON u.id=a.approver_id
      WHERE request_id=$1
      ORDER BY acted_at`,
        [req.params.reqId]
    );
    res.json(r.rows);
});

// Historiku i aprovuesit (my-history)
app.get(
    "/approvals/my-history",
    requireAuth,
    requireRole("team_lead", "division_manager", "sales_director"),
    async (req, res) => {
        const r = await q(
            `SELECT
          a.request_id AS id, a.action, a.comment, a.acted_at,
          r.amount, r.status, r.required_role,
          b.code AS buyer_code, b.name AS buyer_name,
          s.site_name
       FROM approvals a
       JOIN requests r ON r.id=a.request_id
       JOIN buyers   b ON b.id=r.buyer_id
       LEFT JOIN buyer_sites s ON s.id=r.site_id
       WHERE a.approver_id=$1
       ORDER BY a.acted_at DESC`,
            [req.user.id]
        );
        res.json(r.rows);
    }
);

/* --------------------------- DEBUG ROUTE (optional) ------------------------ */
app.post("/debug/email-test", async (req, res) => {
    try {
        const to = req.body?.to || process.env.LEJIMET_EMAIL;
        await sendMail({
            to,
            subject: "Test email nga Fin Approvals",
            html: `<p>Test OK @ ${new Date().toISOString()}</p>`,
        });
        res.json({ ok: true });
    } catch (e) {
        console.error("Send Error:", e?.message || e);
        res.status(500).json({ error: e?.message || "send fail" });
    }
});

/* --------------------------- PRINT REGISTERED ROUTES ----------------------- */
function printRoutes(app) {
    const routes = [];
    app._router?.stack?.forEach((m) => {
        if (m.route) {
            const methods = Object.keys(m.route.methods)
                .map((x) => x.toUpperCase())
                .join(",");
            routes.push(`${methods} ${m.route.path}`);
        } else if (m.name === "router" && m.handle?.stack) {
            m.handle.stack.forEach((h) => {
                const r = h.route;
                if (r) {
                    const methods = Object.keys(r.methods)
                        .map((x) => x.toUpperCase())
                        .join(",");
                    routes.push(`${methods} ${r.path}`);
                }
            });
        }
    });
    console.log("\n=== ROUTES REGISTERED ===");
    routes.sort().forEach((r) => console.log(r));
    console.log("=========================\n");
}
printRoutes(app);

/* ---------------------------------- START --------------------------------- */
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log("API on", PORT));
