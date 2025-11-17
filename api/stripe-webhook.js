// /api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import nodemailer from "nodemailer";
import { db } from "./_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Transport SMTP (igual que en /api/admin/send-order-email)
const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Email de "Hemos recibido tu pedido"
 * Usa los items del carrito para mostrar nombres de cartas.
 */
async function sendOrderReceivedEmail({ session, cartItems }) {
  try {
    const to =
      session?.customer_details?.email ||
      session?.customer_email ||
      null;

    if (!to) {
      console.warn(
        "[stripe-webhook] No se encontró email de cliente en la sesión, no se envía correo de pedido recibido."
      );
      return;
    }

    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    const orderId = session.id;
    const unitEUR = Number(session.metadata?.unitEUR || 0);
    const totalQty = Number(session.metadata?.totalQty || 0);
    const totalEUR = unitEUR * totalQty;

    const itemsLinesText = (cartItems || [])
      .map((it) => `${it.qty}x ${it.name || "(sin nombre)"}`)
      .join("\n");

    const itemsLinesHtml = (cartItems || [])
      .map(
        (it) =>
          `<li><strong>${it.qty}x</strong> ${it.name || "(sin nombre)"}</li>`
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
  }
}

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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      if (!uid) throw new Error("UID ausente en metadata");

      const unitEUR = Number(session.metadata?.unitEUR || 0);
      const totalQty = Number(session.metadata?.totalQty || 0);
      const totalEUR = unitEUR * totalQty;

      // Snap del carrito en Firestore (con tus campos: name, image, eur, qty, etc.)
      const cartRef = db
        .collection("users")
        .doc(uid)
        .collection("cart");

      const cartSnap = await cartRef.get();

      const cartItems = cartSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const orderRef = db
        .collection("users")
        .doc(uid)
        .collection("orders")
        .doc(session.id);

      const existing = await orderRef.get();

      if (!existing.exists) {
        // Aquí dejamos el pedido con una estructura amigable para tu UI
        await orderRef.set({
          createdAt: new Date(),
          checkoutSessionId: session.id,
          payment_status: session.payment_status, // "paid"
          amount_total: session.amount_total,      // en cents
          currency: session.currency,              // "eur"
          unitEUR,                                 // precio por carta
          totalQty,                                // unidades totales
          totalEUR,                                // total en €
          shippingStatus: "pending",               // estado inicial de envío
          items: cartItems,                        // mismo formato que tu carrito
        });

        // Vaciar carrito
        const batch = db.batch();
        cartSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        // Email al cliente
        await sendOrderReceivedEmail({ session, cartItems });
      } else {
        console.log(
          "[stripe-webhook] Pedido ya existía, no se recrea ni se envía email."
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
