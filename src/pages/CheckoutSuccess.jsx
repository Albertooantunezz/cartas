import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  onSnapshot,
  doc,
  getDocsFromCache,
  serverTimestamp,
  writeBatch,
  addDoc,
  orderBy,
} from "firebase/firestore";

/**
 * Reglas de precio por volumen (EUR por carta):
 *  ≤ 8   → 2.00
 *  ≥ 20  → 1.50
 *  ≥ 40  → 1.00
 *  ≥ 50  → 0.75
 */
function computeTierPricing(totalQty) {
  if (totalQty >= 50) return { unit: 0.75, tier: "≥50" };
  if (totalQty >= 40) return { unit: 1.0, tier: "≥40" };
  if (totalQty >= 20) return { unit: 1.5, tier: "≥20" };
  return { unit: 2.0, tier: "≤8" };
}

export default function CheckoutSuccess() {
  const [search] = useSearchParams();
  const sessionId = search.get("session_id") || "";
  const [user, setUser] = useState(null);

  // UI state
  const [status, setStatus] = useState("checking"); // checking | finalizing | success | error
  const [message, setMessage] = useState("Confirmando tu pago…");
  const [order, setOrder] = useState(null);

  // 1) Observa la sesión de usuario
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // 2) Suscríbete al pedido por sessionId (si el webhook ya lo creó, lo veremos enseguida)
  useEffect(() => {
    if (!user || !sessionId) return;

    const ordersRef = collection(db, "users", user.uid, "orders");
    const q = query(ordersRef, where("checkoutSessionId", "==", sessionId), limit(1));

    // Escucha en tiempo real por si el webhook lo crea unos ms después
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const data = { id: docSnap.id, ...docSnap.data() };
        setOrder(data);
        setStatus("success");
        setMessage("¡Pago confirmado!");
      }
    });

    return () => unsub();
  }, [user, sessionId]);

  // 3) Fallback: si tras ~2.4s no hay pedido, lo finalizamos desde el cliente:
  //    - Lee carrito
  //    - Calcula total por volumen
  //    - Crea pedido con checkoutSessionId
  //    - Vacía carrito
  useEffect(() => {
    if (!user || !sessionId) return;
    if (order) return; // ya encontrado por webhook

    let timeout = setTimeout(async () => {
      try {
        setStatus("finalizing");
        setMessage("Terminando de registrar tu pedido…");

        // Evita duplicados: mira de nuevo si existe el pedido antes de crear nada
        const existRef = collection(db, "users", user.uid, "orders");
        const existQ = query(existRef, where("checkoutSessionId", "==", sessionId), limit(1));
        const exist = await getDocs(existQ);
        if (!exist.empty) {
          const docSnap = exist.docs[0];
          const data = { id: docSnap.id, ...docSnap.data() };
          setOrder(data);
          setStatus("success");
          setMessage("¡Pago confirmado!");
          return;
        }

        // Lee carrito actual
        const cartRef = collection(db, "users", user.uid, "cart");
        // Ordenar no es crítico aquí; leemos todos
        const cartSnap = await getDocs(cartRef);
        const items = [];
        let totalQty = 0;

        cartSnap.forEach((d) => {
          const it = { id: d.id, ...d.data() };
          const qty = Number(it.qty || 0);
          if (qty > 0) {
            items.push({
              cardId: it.id,
              name: it.name,
              set: it.set,
              set_name: it.set_name,
              collector_number: it.collector_number,
              qty,
              // Precio referencia por carta (si quieres guardarlo), aunque el total final usa el tier global:
              eurRef: typeof it.eur === "number" ? it.eur : null,
            });
            totalQty += qty;
          }
        });

        // Si el carrito está vacío, asumimos que el webhook ya vació todo:
        if (totalQty === 0) {
          setStatus("success");
          setMessage("¡Pago confirmado!");
          // Intento de recuperar el último pedido reciente (opcional)
          const recentQ = query(
            collection(db, "users", user.uid, "orders"),
            orderBy("createdAt", "desc"),
            limit(1)
          );
          const recent = await getDocs(recentQ);
          if (!recent.empty) {
            const d0 = recent.docs[0];
            setOrder({ id: d0.id, ...d0.data() });
          }
          return;
        }

        const { unit, tier } = computeTierPricing(totalQty);
        const totalEUR = Number((unit * totalQty).toFixed(2));

        // Escribe pedido + vacía carrito con batch idempotente
        const batch = writeBatch(db);

        // Crea pedido
        const newOrderRef = collection(db, "users", user.uid, "orders");
        const newOrder = {
          createdAt: serverTimestamp(),
          status: "paid",
          totalEUR,
          totalQty,
          unitPrice: unit,
          tier, // "≤8" | "≥20" | "≥40" | "≥50"
          items,
          checkoutSessionId: sessionId,
          source: "success-fallback", // útil para auditar si vino del fallback
        };
        const orderDocRef = await addDoc(newOrderRef, newOrder);

        // Vacía carrito
        cartSnap.forEach((d) => batch.delete(doc(db, "users", user.uid, "cart", d.id)));
        await batch.commit();

        // Termina UI
        setOrder({ id: orderDocRef.id, ...newOrder });
        setStatus("success");
        setMessage("¡Pedido creado y carrito vaciado!");
      } catch (e) {
        console.error(e);
        setStatus("error");
        setMessage("Tu pago se confirmó, pero hubo un problema al registrar el pedido. Puedes reintentar.");
      }
    }, 2400);

    return () => clearTimeout(timeout);
  }, [user, sessionId, order]);

  // 4) Render
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white border border-gray-200 rounded-2xl shadow p-6 text-center">
          <h1 className="text-xl font-bold">Falta session_id</h1>
          <p className="text-gray-600 mt-1">Vuelve al carrito e inicia el pago de nuevo.</p>
          <div className="mt-4">
            <Link to="/carrito" className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800">Volver al carrito</Link>
          </div>
        </div>
      </div>
    );x
  }

  const isLoading = status === "checking" || status === "finalizing";

  return (
    <div className="min-h-screen bg-red-50 p-4 text-black">
      <div className="mx-auto max-w-3xl">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 border-b">
            <div className="flex items-start gap-3">
              <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${status === "success" ? "bg-green-100" : status === "error" ? "bg-red-100" : "bg-yellow-100"}`}>
                <span className={`text-lg ${status === "success" ? "text-green-700" : status === "error" ? "text-red-700" : "text-yellow-700"}`}>
                  {status === "success" ? "✓" : status === "error" ? "!" : "…"}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-bold">
                  {status === "success" ? "¡Pago completado!" : status === "error" ? "Incidencia al registrar el pedido" : "Confirmando tu pago…"}
                </h1>
                <p className="text-gray-600 mt-1">{message}</p>
                <p className="text-xs text-gray-400 mt-1">session_id: <code className="break-all">{sessionId}</code></p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Resumen del pedido */}
            {order ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-500">Nº de pedido</div>
                    <div className="font-semibold">#{order.id?.slice?.(-6)?.toUpperCase?.() || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">Total</div>
                    <div className="text-xl font-bold">{typeof order.totalEUR === "number" ? `${order.totalEUR.toFixed(2)} €` : "—"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">Estado</div>
                    <div className="font-medium">{order.status || "paid"}</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">Unidades</div>
                    <div className="font-medium">{order.totalQty || (order.items?.reduce?.((s,i)=>s+(i.qty||0),0) || 0)}</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">Tarifa por volumen</div>
                    <div className="font-medium">{order.tier ? `${order.tier} · ${order.unitPrice?.toFixed?.(2)} €` : "—"}</div>
                  </div>
                </div>

                <div>
                  <h2 className="font-semibold mb-2">Artículos</h2>
                  {order.items?.length ? (
                    <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
                      {order.items.map((it, idx) => (
                        <li key={idx} className="p-3 flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{it.name}</div>
                            <div className="text-xs text-gray-500 truncate">{it.set_name || it.set} · #{it.collector_number || it.cardId}</div>
                          </div>
                          <div className="text-sm text-gray-700">x{it.qty}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-gray-600">No hay items para mostrar.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-gray-600">
                {isLoading ? "Buscando tu pedido…" : "No encontramos el pedido todavía."}
              </div>
            )}

            {/* Acciones */}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                to="/catalogo"
                className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Seguir comprando
              </Link>
              <Link
                to="/cuenta"
                className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
              >
                Ver mis pedidos
              </Link>

              {status === "error" && (
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600"
                >
                  Reintentar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Nota de seguridad */}
        <p className="text-xs text-gray-500 mt-3">
          Si tu pedido no aparece al instante, puede tardar unos segundos en procesarse.
          Después lo verás también en <Link to="/cuenta" className="underline">Mi cuenta</Link>.
        </p>
      </div>
    </div>
  );
}
