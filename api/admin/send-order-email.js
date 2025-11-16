// /api/admin/send-order-email.js

const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

const ADMIN_EMAILS = ["alber968968@gmail.com", "NVproxys.com@gmail.com"];

// Inicializar Firebase Admin solo una vez
if (!admin.apps.length) {
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, "\n") : undefined;

  console.log("[send-order-email] init admin app, project:", process.env.FIREBASE_PROJECT_ID);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

function createTransporter() {
  console.log("[send-order-email] createTransporter", {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    // NO logueamos la password
  });

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function buildEmailContent(type, { orderId, user, totalEUR, totalQty, items }) {
  const shortId = orderId?.slice?.(-6)?.toUpperCase?.() || orderId;
  const safeName = user?.name || "cliente";

  if (type === "shipped") {
    const subject = `Tu pedido #${shortId} ha sido enviado`;
    const text = `
Hola ${safeName},

Tu pedido #${shortId} ya ha sido ENVIADO.

Resumen:
- Total: ${typeof totalEUR === "number" ? totalEUR.toFixed(2) + " €" : "—"}
- Unidades: ${totalQty ?? 0}

Pronto recibirás más información de seguimiento.

Un saludo,
NV Proxy
`.trim();

    const html = `
<p>Hola ${safeName},</p>
<p>Tu pedido <strong>#${shortId}</strong> ya ha sido <strong>ENVIADO</strong>.</p>
<p><strong>Resumen:</strong></p>
<ul>
  <li>Total: <strong>${typeof totalEUR === "number" ? totalEUR.toFixed(2) + " €" : "—"}</strong></li>
  <li>Unidades: <strong>${totalQty ?? 0}</strong></li>
</ul>
${items?.length
  ? `<p><strong>Artículos:</strong></p>
<ul>
  ${items
    .map(
      (it) =>
        `<li>${(it.qty || 0) + " x " + (it.name || it.cardId || "Carta")}${
          it.set_name || it.set ? " (" + (it.set_name || it.set) + ")" : ""
        }</li>`
    )
    .join("")}
</ul>`
  : ""
}
<p>Pronto recibirás más información de seguimiento.</p>
<p>Un saludo,<br/>NV Proxy</p>
`.trim();

    return { subject, text, html };
  }

  const subject = `Tu pedido #${shortId} ha sido entregado`;
  const text = `
Hola ${safeName},

Te confirmamos que tu pedido #${shortId} ha sido RECIBIDO / ENTREGADO.

Esperamos que disfrutes de tus cartas.
Si tienes cualquier duda o problema, responde a este email.

Un saludo,
NV Proxy
`.trim();

  const html = `
<p>Hola ${safeName},</p>
<p>Te confirmamos que tu pedido <strong>#${shortId}</strong> ha sido <strong>RECIBIDO / ENTREGADO</strong>.</p>
<p>Esperamos que disfrutes de tus cartas.</p>
<p>Si tienes cualquier duda o problema, responde a este email.</p>
<p>Un saludo,<br/>NV Proxy</p>
`.trim();

  return { subject, text, html };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("[send-order-email] incoming request");

    // ---- 1. Auth ----
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      console.log("[send-order-email] missing token");
      return res.status(401).json({ error: "No auth token provided" });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (e) {
      console.error("[send-order-email] verifyIdToken error", e);
      return res.status(401).json({ error: "Invalid auth token", details: String(e) });
    }

    const userEmail = (decoded.email || "").toLowerCase();
    console.log("[send-order-email] authed as", userEmail);

    if (!ADMIN_EMAILS.includes(userEmail)) {
      console.log("[send-order-email] not admin");
      return res.status(403).json({ error: "Not authorized (admin only)" });
    }

    // ---- 2. Body ----
    const { type, orderId, user, totalEUR, totalQty, items, checkoutSessionId } =
      req.body || {};

    console.log("[send-order-email] body", { type, orderId, userEmail: user?.email });

    if (!type || !["shipped", "delivered"].includes(type)) {
      return res.status(400).json({ error: "Invalid type (shipped | delivered)" });
    }

    if (!orderId || !user || !user.email) {
      return res.status(400).json({
        error: "Missing orderId or user.email in body",
      });
    }

    const mailFrom = process.env.MAIL_FROM || "NVproxy.com@gmail.com";
    const mailTo = user.email;

    const { subject, text, html } = buildEmailContent(type, {
      orderId,
      user,
      totalEUR,
      totalQty,
      items,
      checkoutSessionId,
    });

    const transporter = createTransporter();

    console.log("[send-order-email] sending mail", {
      from: mailFrom,
      to: mailTo,
      subject,
    });

    await transporter.sendMail({
      from: `"NV Proxy" <${mailFrom}>`,
      to: mailTo,
      subject,
      text,
      html,
    });

    console.log("[send-order-email] mail sent ok");

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[send-order-email] ERROR", e);
    return res.status(500).json({ error: String(e) });
  }
};
