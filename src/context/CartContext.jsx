// src/context/CartContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  increment,
  query,
  orderBy,
} from "firebase/firestore";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState([]); // [{ id, name, image, eur/usd, qty, ... , createdAt }]
  const [ready, setReady] = useState(false);

  // Suscripción al carrito del usuario (ORDENADA)
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((u) => {
      setReady(false);
      if (!u) {
        setItems([]);
        setReady(true);
        return;
      }
      const cartCol = collection(db, "users", u.uid, "cart");
      // 👇 MUY IMPORTANTE: ordenar por createdAt para mantener orden de inserción
      const qCart = query(cartCol, orderBy("createdAt", "asc"));


      const unsubCart = onSnapshot(qCart, (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setItems(list);
        setReady(true);
      });

      return () => unsubCart();
    });
    return () => unsubAuth();
  }, []);

  const totalQty = useMemo(() => items.reduce((a, b) => a + (b.qty || 0), 0), [items]);
  const totalEUR = useMemo(() => {
    return items.reduce((a, b) => {
      const p = parseFloat(b.eur || "0") || 0;
      return a + p * (b.qty || 0);
    }, 0);
  }, [items]);

  // Añadir (respetando createdAt si ya existe)
  async function add(card, qty = 1) {
    const u = auth.currentUser;
    if (!u) throw new Error("Debes iniciar sesión para añadir al carrito.");
    const ref = doc(db, "users", u.uid, "cart", card.id);

    const payload = {
      name: card.name,
      image:
        card.image_uris?.normal ||
        card.card_faces?.[0]?.image_uris?.normal ||
        "",
      eur: card.prices?.eur ?? null,
      usd: card.prices?.usd ?? null,
      set: (card.set || "").toUpperCase(),
      set_name: card.set_name,
      collector_number: card.collector_number,
      updatedAt: serverTimestamp(),
    };

    const snap = await getDoc(ref);
    if (snap.exists()) {
      // Ya existe: NO tocar createdAt, solo incrementar qty y updatedAt
      await setDoc(
        ref,
        { ...payload, qty: increment(qty) },
        { merge: true }
      );
    } else {
      // Nuevo doc: fija createdAt UNA sola vez
      await setDoc(ref, {
        ...payload,
        qty: qty,
        createdAt: serverTimestamp(),
      });
    }
  }

  // Establecer cantidad exacta (sin borrar/recrear)
  async function setQty(cardId, qty) {
    const u = auth.currentUser;
    if (!u) throw new Error("Debes iniciar sesión.");
    const ref = doc(db, "users", u.uid, "cart", cardId);
    if (qty <= 0) {
      await deleteDoc(ref);
      return;
    }
    await setDoc(ref, { qty, updatedAt: serverTimestamp() }, { merge: true });
  }

  // Quitar 1 (sin re-crear)
  async function removeOne(cardId) {
    const u = auth.currentUser;
    if (!u) throw new Error("Debes iniciar sesión.");
    const existing = items.find((i) => i.id === cardId);
    if (!existing) return;
    const ref = doc(db, "users", u.uid, "cart", cardId);
    if ((existing.qty || 0) <= 1) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { qty: increment(-1), updatedAt: serverTimestamp() }, { merge: true });
    }
  }

  // Quitar totalmente
  async function removeItem(cardId) {
    const u = auth.currentUser;
    if (!u) throw new Error("Debes iniciar sesión.");
    const ref = doc(db, "users", u.uid, "cart", cardId);
    await deleteDoc(ref);
  }

  // Vaciar carrito
  async function clearCart() {
    const u = auth.currentUser;
    if (!u) throw new Error("Debes iniciar sesión.");
    const batch = writeBatch(db);
    items.forEach((it) => {
      batch.delete(doc(db, "users", u.uid, "cart", it.id));
    });
    await batch.commit();
  }

  const value = {
    items,
    ready,
    totalQty,
    totalEUR,
    add,
    // API cómoda para el UI:
    setQty,          // 👈 ahora existe; úsalo en el componente para +/-
    removeOne,       // quitar 1
    removeItem,      // quitar del todo
    clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return ctx;
}
