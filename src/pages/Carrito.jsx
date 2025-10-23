// src/pages/Carrito.jsx
import React from "react";
import { useCart } from "../context/CartContext";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../firebase";

export default function Carrito() {
  const { items, ready, totalQty, totalEUR, add, removeOne, removeItem, clearCart } = useCart();
  const navigate = useNavigate();
  const user = auth.currentUser;

  if (!ready) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center">
        <div className="text-gray-700">Cargando carrito…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-red-50 p-6">
        <div className="max-w-3xl mx-auto bg-white border rounded-xl shadow p-6">
          <h1 className="text-2xl font-bold mb-2">Tu carrito</h1>
          <p className="text-gray-600 mb-4">Necesitas iniciar sesión para usar el carrito.</p>
          <Link
            to="/cuenta"
            className="inline-block px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded"
          >
            Ir a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-red-50 p-4 text-black">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-3 gap-4">
        {/* Lista */}
        <div className="lg:col-span-2 bg-white border rounded-xl shadow">
          <div className="p-4 border-b">
            <h1 className="text-2xl font-bold">Carrito</h1>
            <p className="text-sm text-gray-600">{totalQty} artículo(s)</p>
          </div>

          {items.length === 0 ? (
            <div className="p-6 text-gray-600">
              Tu carrito está vacío.{" "}
              <Link to="/catalogo" className="text-red-600 hover:underline">Ir al catálogo</Link>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.id} className="p-3 flex items-start gap-3">
                  <div className="w-24 h-32 bg-gray-50 border rounded flex items-center justify-center overflow-hidden">
                    {it.image ? (
                      <img src={it.image} alt={it.name} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xs text-gray-500">Sin imagen</span>
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{it.name}</div>
                        <div className="text-xs text-gray-600">
                          {it.set_name} ({it.set}) • #{it.collector_number}
                        </div>
                        <div className="text-sm text-gray-800 mt-1">
                          {it.eur ? `${it.eur} €` : it.usd ? `${it.usd} $` : "—"}
                        </div>
                      </div>
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => removeItem(it.id)}
                        title="Eliminar del carrito"
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                        onClick={() => removeOne(it.id)}
                        title="Quitar 1"
                      >
                        −
                      </button>
                      <span className="min-w-6 text-center text-sm">{it.qty || 0}</span>
                      <button
                        className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                        onClick={() => add({ id: it.id, name: it.name, image_uris: { normal: it.image }, prices: { eur: it.eur, usd: it.usd }, set: it.set, set_name: it.set_name, collector_number: it.collector_number }, 1)}
                        title="Añadir 1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Resumen */}
        <div className="bg-white border rounded-xl shadow p-4 h-fit">
          <h2 className="font-semibold mb-2">Resumen</h2>
          <div className="flex justify-between text-sm">
            <span>Artículos</span>
            <span>{totalQty}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span>Total estimado</span>
            <span>{totalEUR.toFixed(2)} €</span>
          </div>

          <button
            className="w-full mt-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white disabled:opacity-60"
            onClick={() => {
              // Aquí iniciarías tu flujo de pago/checkout
              alert("Proceder al pago (pendiente de integrar).");
            }}
            disabled={items.length === 0}
          >
            Proceder al pedido
          </button>

          <button
            className="w-full mt-2 py-2 rounded bg-gray-100 hover:bg-gray-200"
            onClick={clearCart}
            disabled={items.length === 0}
          >
            Vaciar carrito
          </button>
        </div>
      </div>
    </div>
  );
}
