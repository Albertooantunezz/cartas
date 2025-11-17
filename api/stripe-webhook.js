// /api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import nodemailer from "nodemailer";
import { db } from "./_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } }; // necesario

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Transport de Nodemailer (mismo SMTP que usas en /api/admin/send-order-email)
const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // con 587 se usa STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Envía email automático de "Hemos recibido tu pedido"
 * No lanza error hacia arriba: si falla, solo loguea.
 */
async function sendOrderReceivedEmail({ session, lineItems }) {
  try {
    console.log("[sendOrderReceivedEmail] Preparando email...");

    const to =
      session?.customer_details?.email ||
      session?.customer_email ||
      null;

    console.log("[sendOrderReceivedEmail] to:", to);
    console.log(
      "[sendOrderReceivedEmail] SMTP_HOST/USER:",
      process.env.SMTP_HOST,
      process.env.SMTP_USER
    );

    if (!to) {
      console.warn(
        "[stripe-webhook] No se encontró email de cliente en la sesión, no se envía correo de pedido recibido."
      );
      return;
    }

    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    const orderId = session.id;
    const totalEUR = (session.amount_total || 0) / 100;
    const totalQty = Number(session.metadata?.totalQty || 0);

    const itemsLinesText = (lineItems?.data || [])
      .map((li) => `${li.quantity}x ${li.description}`)
      .join("\n");

    const itemsLinesHtml = (lineItems?.data || [])
      .map(
        (li) =>
          `<li><strong>${li.quantity}x</strong> ${li.description}</li>`
      )
      .join("");

    const subject = `Hemos recibido tu pedido #${orderId}`;

    const text = [
      "¡Gracias por tu pedido! 🧙‍♂️",
      "",
      "Hemos recibido tu pedido y empezaremos a prepararlo en breve.",
      "",
      `ID de pedido: ${orderId}`,
      `Total: ${totalEUR.toFixed(2)} €`,
      `Unidades: ${totalQty}`,
      "",
      "Detalle de cartas:",
      itemsLinesText || "(Sin detalle disponible)",
      "",
      "Te avisaremos de nuevo por email cuando tu pedido sea enviado.",
      "",
      "Un saludo,",
      "El equipo de tu tienda de Magic",
    ].join("\n");

    const html = `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.5; color:#111827;">
        <h1 style="font-size:20px; margin-bottom:8px;">¡Gracias por tu pedido! 🧙‍♂️</h1>
        <p>Hemos recibido tu pedido y empezaremos a prepararlo en breve.</p>

        <p><strong>ID de pedido:</strong> ${orderId}<br/>
        <strong>Total:</strong> ${totalEUR.toFixed(2)} €<br/>
        <strong>Unidades:</strong> ${totalQty}</p>

        <h2 style="font-size:16px; margin-top:16px;">Detalle de cartas</h2>
        ${
          itemsLinesHtml
            ? `<ul>${itemsLinesHtml}</ul>`
            : "<p>(Sin detalle disponible)</p>"
        }

        <p style="margin-top:16px;">
          Te avisaremos de nuevo por email cuando tu pedido sea <strong>enviado</strong>.
        </p>

        <p style="margin-top:16px;">
          Un saludo,<br/>
          <span>El equipo de tu tienda de Magic</span>
        </p>
      </div>
    `;

    await mailTransport.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    console.log(
      `[stripe-webhook] Email de pedido recibido enviado a ${to} para pedido ${orderId}`
    );
  } catch (err) {
    console.error(
      "[stripe-webhook] Error al enviar email de pedido recibido:",
      err
    );
    // No relanzamos: el webhook debe seguir siendo exitoso
  }
}

const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  let event;
  try {
    const raw = await getRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(raw, sig, stripeWebhookSecret);
  } catch (err) {
    console.error("❌ Webhook signature verification failed", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log("[stripe-webhook] Event type:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      console.log("[stripe-webhook] checkout.session.completed para uid:", uid);

      if (!uid) throw new Error("UID ausente en metadata");

      // Line items (opcional, útil para snapshot y para el email)
      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { limit: 100 }
      );

      console.log(
        "[stripe-webhook] lineItems count:",
        lineItems?.data?.length || 0
      );

      const orderRef = db
        .collection("users")
        .doc(uid)
        .collection("orders")
        .doc(session.id);

      const existing = await orderRef.get();
      console.log(
        "[stripe-webhook] existing order?",
        existing.exists ? "sí" : "no"
      );

      if (!existing.exists) {
        await orderRef.set({
          createdAt: new Date(),
          stripeSessionId: session.id,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          unitEUR: Number(session.metadata?.unitEUR || 0),
          totalQty: Number(session.metadata?.totalQty || 0),
          items: lineItems.data.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            amount_subtotal: li.amount_subtotal,
            amount_total: li.amount_total,
            price: li.price?.id || null,
          })),
        });

        console.log("[stripe-webhook] Pedido creado, vaciando carrito...");

        const cartSnap = await db
          .collection("users")
          .doc(uid)
          .collection("cart")
          .get();
        const batch = db.batch();
        cartSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        console.log(
          "[stripe-webhook] Carrito vaciado, enviando email de pedido recibido..."
        );

        // 🚀 Enviar email de "Hemos recibido tu pedido"
        await sendOrderReceivedEmail({ session, lineItems });
      } else {
        console.log(
          "[stripe-webhook] Pedido ya existía, no se vuelve a crear ni se envía email."
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
