// Cuenta.jsx
// Página de cuenta con registro/login y dashboard del usuario.
// - En registro se reserva un username único en Firestore con transacción.
// - Perfil: users/{uid}
// - Pedidos: users/{uid}/orders
// Requiere: import { auth, db } from "../firebase"

import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase";

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  deleteUser,
} from "firebase/auth";

import {
  doc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  orderBy,
  query,
  addDoc,
  runTransaction,
} from "firebase/firestore";

export default function Cuenta() {
  // ======= Estado Auth =======
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Tabs: "login" | "register"
  const [tab, setTab] = useState("login");

  // Formularios
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  // Perfil + pedidos
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);

  // UI
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // ==============
  // Observa Auth
  // ==============
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // ===========================
  // Cargar perfil + pedidos RT
  // ===========================
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setOrders([]);
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const unsubProfile = onSnapshot(userRef, (snap) => {
      setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });

    const ordersRef = collection(db, "users", user.uid, "orders");
    const q = query(ordersRef, orderBy("createdAt", "desc"));
    const unsubOrders = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setOrders(list);
    });

    return () => {
      unsubProfile();
      unsubOrders();
    };
  }, [user]);

  // ======================
  // Registro con username
  // ======================
  const handleRegister = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      // 1) Crea usuario en Auth
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);

      // 2) Normaliza y exige nombre
      const uname = (name || "").trim();
      if (!uname) {
        setErr("Debes indicar un nombre de usuario.");
        try { await deleteUser(cred.user); } catch {}
        return;
      }
      const unameKey = uname.toLowerCase();

      // 3) Transacción: reservar username único en /usernames/{unameKey}
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "usernames", unameKey);
          const snap = await tx.get(ref);
          if (snap.exists()) {
            throw new Error("USERNAME_TAKEN");
          }
          tx.set(ref, { uid: cred.user.uid, createdAt: serverTimestamp() });
        });
      } catch (e2) {
        if (String(e2?.message).includes("USERNAME_TAKEN")) {
          setErr("Ese nombre ya está en uso, por favor elige otro.");
        } else {
          setErr("No se pudo reservar el nombre. Revisa reglas de Firestore y vuelve a intentar.");
        }
        // Evita dejar usuario “huérfano” si falló la reserva
        try { await deleteUser(cred.user); } catch {}
        return;
      }

      // 4) Perfil en Auth y Firestore (una sola vez, ya con username reservado)
      await updateProfile(cred.user, { displayName: uname });

      await setDoc(doc(db, "users", cred.user.uid), {
        name: uname,
        nameLower: unameKey,
        email: cred.user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 5) Limpia formularios
      setName("");
      setEmail("");
      setPass("");
      setTab("login"); // opcional: puedes dejarlo en "login" o mantener sesión iniciada
    } catch (eAll) {
      setErr(parseFirebaseErr(eAll));
    } finally {
      setLoading(false);
    }
  };

  // ===============
  // Inicio de sesión
  // ===============
  const handleLogin = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
      setEmail("");
      setPass("");
    } catch (e2) {
      setErr(parseFirebaseErr(e2));
    } finally {
      setLoading(false);
    }
  };

  // ============
  // Cerrar sesión
  // ============
  const handleLogout = async () => {
    setErr("");
    setLoading(true);
    try {
      await signOut(auth);
    } catch (e2) {
      setErr(parseFirebaseErr(e2));
    } finally {
      setLoading(false);
    }
  };

  // ============================
  // Crear pedido de demostración
  // ============================
  const crearPedidoDemo = async () => {
    if (!user) return;
    setErr("");
    setLoading(true);
    try {
      const ref = collection(db, "users", user.uid, "orders");
      await addDoc(ref, {
        createdAt: serverTimestamp(),
        totalEUR: 12.34,
        items: [
          { cardId: "demo-1", name: "Lightning Bolt", qty: 2, eur: "1.00" },
          { cardId: "demo-2", name: "Llanowar Elves", qty: 3, eur: "0.50" },
        ],
        status: "processing",
      });
    } catch (e2) {
      setErr(parseFirebaseErr(e2));
    } finally {
      setLoading(false);
    }
  };

  // ========
  // Render UI
  // ========
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center">
        <div className="text-gray-700">Cargando…</div>
      </div>
    );
  }

  // ---- No autenticado: Login / Registro
  if (!user) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow border border-gray-200">
          <div className="p-4 border-b">
            <h1 className="text-xl font-bold">Tu cuenta</h1>
            <p className="text-sm text-gray-600">Accede o crea una cuenta para ver tus pedidos.</p>
          </div>

          <div className="px-4 pt-3 text-black">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setTab("login")}
                className={`px-3 py-2 rounded-lg text-sm border ${tab === "login" ? "bg-red-500 text-white border-red-500" : "bg-white border-gray-300"}`}
              >
                Iniciar sesión
              </button>
              <button
                onClick={() => setTab("register")}
                className={`px-3 py-2 rounded-lg text-sm border ${tab === "register" ? "bg-red-500 text-white border-red-500" : "bg-white border-gray-300"}`}
              >
                Registrarse
              </button>
            </div>

            {err && (
              <div className="mb-3 rounded bg-red-100 text-red-800 px-3 py-2 text-sm">
                {err}
              </div>
            )}
          </div>

          {tab === "login" ? (
            <form onSubmit={handleLogin} className="px-4 pb-4 space-y-3 text-black">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="tu@email.com"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña</label>
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white disabled:opacity-60"
              >
                {loading ? "Entrando…" : "Entrar"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="px-4 pb-4 space-y-3 text-black">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre de usuario</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="Tu nombre (único)"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="tu@email.com"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña</label>
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white disabled:opacity-60"
              >
                {loading ? "Creando cuenta…" : "Crear cuenta"}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ---- Autenticado: Dashboard
  return (
    <div className="min-h-screen bg-red-50 p-4">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Mi cuenta</h1>
            <p className="text-sm text-gray-600">
              ¡Hola, {user.displayName || profile?.name || user.email}!
            </p>
          </div>
          <button
            onClick={handleLogout}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
          >
            Cerrar sesión
          </button>
        </div>

        {/* Datos de perfil */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <h2 className="font-semibold mb-2">Datos</h2>
            <div className="text-sm text-gray-800 space-y-1">
              <div><span className="text-gray-500">Nombre:</span> {profile?.name || user.displayName || "—"}</div>
              <div><span className="text-gray-500">Email:</span> {profile?.email || user.email}</div>
              <div><span className="text-gray-500">UID:</span> <code className="text-xs">{user.uid}</code></div>
            </div>
          </div>

          {/* Pedidos */}
          <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Pedidos</h2>
              <button
                onClick={crearPedidoDemo}
                className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
              >
                Añadir pedido demo
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="text-sm text-gray-600">Aún no tienes pedidos.</div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {orders.map((o) => (
                  <li key={o.id} className="py-3 flex items-start justify-between">
                    <div className="text-sm">
                      <div className="font-medium">Pedido #{o.id.slice(-6).toUpperCase()}</div>
                      <div className="text-gray-600">
                        {o.items?.length || 0} artículos • Total {o.totalEUR ? `${o.totalEUR} €` : "—"} • {o.status || "—"}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================
// Utilidad de errores
// ==================
function parseFirebaseErr(e) {
  const code = e?.code || "";
  const msg = e?.message || "";
  if (code.includes("auth/invalid-email")) return "Email inválido.";
  if (code.includes("auth/weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("auth/email-already-in-use")) return "Ese email ya está en uso.";
  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password"))
    return "Credenciales incorrectas.";
  if (code.includes("permission-denied"))
    return "Permisos de Firestore denegados. Revisa y publica las reglas.";
  return msg || "Ha ocurrido un error.";
}
