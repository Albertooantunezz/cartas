// functions/index.js
const functions = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const cors = require("cors")({ origin: true });

admin.initializeApp();

const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---- Precio por tramos (EUR) ----
function getUnitPriceEUR(totalUnits) {
  if (totalUnits >= 50) return 0.75;
  if (totalUnits >= 40) return 1.0;
  if (totalUnits >= 20) return 1.5;
  return 2.0; // 0–19
}

// Utilidad: asegura auth en cabecera (enviar idToken desde cliente si quieres reforzar)
async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const m = authHeader.match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded.uid;
  } catch {
    return null;
  }
}

// 1) Crear sesión de checkout
exports.createCheckoutSession = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

      // Si quieres forzar login del lado servidor:
      const uid = await getUserFromRequest(req);
      if (!uid) return res.status(401).send("No autorizado");

      // Lee carrito del usuario desde Firestore (fuente de la verdad)
      const cartSnap = await db.collection("users").doc(uid).collection("cart").get();
      if (cartSnap.empty) return res.status(400).send("Carrito vacío.");

      const items = [];
      let totalUnits = 0;
      cartSnap.forEach((d) => {
        const data = d.data();
        const qty = Number(data.qty || 0);
        if (qty > 0) {
          totalUnits += qty;
          items.push({
            id: d.id,
            name: data.name || "Carta",
            set_name: data.set_name || "",
            set: data.set || "",
            collector_number: data.collector_number || "",
            image: data.image || "",
            qty,
          });
        }
      });

      if (items.length === 0) return res.status(400).send("Carrito vacío.");

      const unitPrice = getUnitPriceEUR(totalUnits); // EUR
      const unitAmount = Math.round(unitPrice * 100); // en céntimos

      // Construye líneas “de cortesía” (un solo precio, varias cantidades)
      // Opción A: 1 línea total (nombre genérico)
      const lineItems = [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Pedido de cartas",
              description: `${totalUnits} unidades · ${unitPrice.toFixed(2)} € c/u`,
            },
            unit_amount: unitAmount,
          },
          quantity: totalUnits,
        },
      ];

      // Metadatos: guardamos un resumen del carrito para tenerlo en el evento
      const metadata = {
        uid,
        unit_price_eur: unitPrice.toFixed(2),
        total_units: String(totalUnits),
        // ⚠️ longitud limitada en metadata; compactamos ids y qtys:
        items: items
          .map((it) => `${it.id}:${it.qty}`)
          .join(","), // id1:2,id2:5,...
      };

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems,
        success_url: `${process.env.FRONTEND_URL}/pedido-exitoso?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/carrito`,
        customer_creation: "if_required",
        metadata,
      });

      return res.status(200).json({ id: session.id, url: session.url });
    } catch (e) {
      console.error(e);
      return res.status(500).send("Error creando la sesión de pago.");
    }
  });
});

// 2) Webhook: confirmar pago, crear pedido y vaciar carrito
exports.stripeWebhook = onRequest(async (req, res) => {
  // IMPORTANTE: desactivar body-parser en firebase.json, o usar raw body.
  // En v2 ya viene raw. Añade STRIPE_WEBHOOK_SECRET en env.
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const rawBody = req.rawBody; // v2: raw body disponible
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      const totalUnits = Number(session.metadata?.total_units || 0);
      const unitPrice = Number(session.metadata?.unit_price_eur || 0);

      if (!uid) {
        console.warn("checkout.session.completed sin uid");
        return res.status(200).send("ok");
      }

      // Crea pedido
      const orderRef = db.collection("users").doc(uid).collection("orders").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();

      await orderRef.set({
        status: "pagado",
        createdAt: now,
        updatedAt: now,
        stripeSessionId: session.id,
        totalUnits,
        unitPriceEUR: unitPrice,
        totalEUR: Number((totalUnits * unitPrice).toFixed(2)),
        // Puedes guardar items más detallados si en vez de metadata lees line_items:
        // line_items: await stripe.checkout.sessions.listLineItems(session.id)
      });

      // Vaciar carrito
      const cartCol = db.collection("users").doc(uid).collection("cart");
      const cartSnap = await cartCol.get();
      const batch = db.batch();
      cartSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error("Error procesando webhook:", e);
    return res.status(500).send("Webhook handler error");
  }
});
