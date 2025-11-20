// /api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import nodemailer from "nodemailer";
import { db } from "./_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Transport SMTP
const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Email de "hemos recibido tu pedido"
async function sendOrderReceivedEmail({ session, lineItems }) {
  try {
    const to =
      session?.customer_details?.email ||
      session?.customer_email ||
      null;

    if (!to) {
      console.warn(
        "[stripe-webhook] No email de cliente en la sesión, no se envía correo de pedido recibido."
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
        ${itemsLinesHtml
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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      if (!uid) throw new Error("UID ausente en metadata");

      const discountCode = session.metadata?.discountCode || "";
      const discountPercent = Number(session.metadata?.discountPercent || 0);
      const unitEUR = Number(session.metadata?.unitEUR || 0);
      const unitEUROriginal = Number(
        session.metadata?.unitEUROriginal || unitEUR
      );

      // Line items desde Stripe
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
      });

      const orderRef = db
        .collection("users")
        .doc(uid)
        .collection("orders")
        .doc(session.id);

      const existing = await orderRef.get();

      // 1) Crear pedido solo si no existe
      if (!existing.exists) {
        await orderRef.set({
          createdAt: new Date(),
          stripeSessionId: session.id,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          unitEUR,
          unitEUROriginal,
          totalQty: Number(session.metadata?.totalQty || 0),
          discountCode: discountCode || null,
          discountPercent,
          items: lineItems.data.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            amount_subtotal: li.amount_subtotal,
            amount_total: li.amount_total,
            price: li.price?.id || null,
          })),
          shippingStatus: "pending",
        });

        // Vaciar carrito
        const cartSnap = await db
          .collection("users")
          .doc(uid)
          .collection("cart")
          .get();
        const batch = db.batch();
        cartSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        // Email de confirmación
        await sendOrderReceivedEmail({ session, lineItems });
      }

      // 2) Marcar código como usado SIEMPRE que haya discountCode
      // Marcar código como usado (si hay)
      // 2) Marcar código como usado SIEMPRE que haya discountCode
      if (discountCode) {
        console.log(
          "[stripe-webhook] Paso 1 → discountCode recibido:",
          discountCode
        );

        const codesRef = db.collection("discountCodes");
        const qs = await codesRef.where("code", "==", discountCode).limit(1).get();

        console.log(
          "[stripe-webhook] Paso 2 → nº docs con ese code:",
          qs.size
        );

        if (qs.empty) {
          console.warn(
            "[stripe-webhook] Paso 3 → Código NO encontrado por campo code:",
            discountCode
          );
        } else {
          const codeRef = qs.docs[0].ref;
          console.log(
            "[stripe-webhook] Paso 3 → ID real del doc encontrado:",
            codeRef.path
          );

          await db.runTransaction(async (tx) => {
            const snap = await tx.get(codeRef);
            console.log(
              "[stripe-webhook] Paso 4 → Snapshot existe dentro de la tx:",
              snap.exists
            );
            if (!snap.exists) return;

            const data = snap.data();
            console.log(
              "[stripe-webhook] Paso 5 → Valor actual de 'used' antes de update:",
              data.used
            );

            if (data.used) {
              console.log(
                "[stripe-webhook] Paso 6 → Ya estaba usado, no actualizo."
              );
              return;
            }

            tx.update(codeRef, {
              used: true,
              usedAt: new Date(),
              usedByUid: uid,
              lastSessionId: session.id,
            });

            console.log(
              "[stripe-webhook] Paso 6 → Marcando como usado en la transacción."
            );
          });
        }
      }else{
        console.log("Ausente discountCode, no se marca ningún código como usado.");
      }


    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
