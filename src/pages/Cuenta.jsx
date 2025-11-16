// src/pages/Cuenta.jsx
// Dashboard de cuenta con listado de pedidos, modal responsive
// y panel de admin (gestiona todos los pedidos + envío de emails)

import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase"; // ajusta si tu path es distinto

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
  collectionGroup,
  getDoc,
} from "firebase/firestore";

// ------ utils UI ------
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

function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
    return d ? d.toLocaleString() : "—";
  } catch {
    return "—";
  }
}

function formatMoney(n) {
  if (typeof n !== "number") return "—";
  return `${n.toFixed(2)} €`;
}

function statusBadgeClasses(status = "") {
  const s = String(status).toLowerCase();
  if (s.includes("paid") || s.includes("completed") || s.includes("success"))
    return "bg-green-100 text-green-700 border-green-200";
  if (s.includes("processing") || s.includes("pending"))
    return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (s.includes("canceled") || s.includes("refunded") || s.includes("failed"))
    return "bg-red-100 text-red-700 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

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

  // Perfil + pedidos propios
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);

  // UI
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Filtros/orden en pedidos de usuario
  const [q, setQ] = useState("");
  const [orderByField, setOrderByField] = useState("createdAt"); // createdAt | totalEUR | totalQty
  const [orderDir, setOrderDir] = useState("desc"); // asc | desc

  // Modal de detalles (para cualquier pedido: usuario o admin)
  const [openOrder, setOpenOrder] = useState(null); // objeto pedido seleccionado

  // ========= ADMIN =========
  const ADMIN_EMAILS = ["alber968968@gmail.com"]; // aquí puedes añadir más emails de admin

  const isAdmin = !!(user && user.email && ADMIN_EMAILS.includes(user.email.toLowerCase()));

  const [adminOrders, setAdminOrders] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminSearch, setAdminSearch] = useState("");

  // ==============
  // Observa Auth
  // ==============
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // ===========================
  // Cargar perfil + pedidos RT (usuario actual)
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
  }, [user, db]);

  // ===========================
  // Cargar pedidos globales (solo admin)
  // ===========================
  useEffect(() => {
    if (!user || !isAdmin) {
      setAdminOrders([]);
      return;
    }

    setAdminLoading(true);
    setAdminError("");

    const q = query(collectionGroup(db, "orders"), orderBy("createdAt", "desc"));

    let cancelled = false;
    const unsub = onSnapshot(
      q,
      async (snap) => {
        try {
          const tmp = [];
          const userCache = new Map(); // uid -> userData

          for (const d of snap.docs) {
            const data = { id: d.id, ...d.data() };

            // Derivamos el uid a partir de la ruta: users/{uid}/orders/{orderId}
            const parentUserRef = d.ref.parent?.parent;
            const uid = parentUserRef?.id;
            let userMeta = null;

            if (uid) {
              if (userCache.has(uid)) {
                userMeta = userCache.get(uid);
              } else {
                const uDoc = await getDoc(doc(db, "users", uid));
                userMeta = uDoc.exists()
                  ? { uid, ...uDoc.data() }
                  : { uid, name: "(sin perfil)", email: null };
                userCache.set(uid, userMeta);
              }
            }

            tmp.push({
              ...data,
              _user: userMeta, // info del cliente
            });
          }

          if (!cancelled) {
            setAdminOrders(tmp);
            setAdminLoading(false);
          }
        } catch (e) {
          console.error(e);
          if (!cancelled) {
            setAdminError("Error al cargar pedidos globales (revisa reglas de Firestore/índices).");
            setAdminLoading(false);
          }
        }
      },
      (err) => {
        console.error(err);
        if (!cancelled) {
          setAdminError(parseFirebaseErr(err));
          setAdminLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, isAdmin, db]);

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
        try {
          await deleteUser(cred.user);
        } catch { }
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
        try {
          await deleteUser(cred.user);
        } catch { }
        return;
      }

      // 4) Perfil en Auth y Firestore (ya con username reservado)
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
      setTab("login");
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

  // ============ Cerrar sesión ============
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
        totalQty: 5,
        unitPrice: 2.47,
        tier: "≤8",
        items: [
          {
            cardId: "demo-1",
            name: "Lightning Bolt",
            qty: 2,
            eurRef: 1.0,
            set: "m10",
            set_name: "Magic 2010",
            collector_number: "140",
          },
          {
            cardId: "demo-2",
            name: "Llanowar Elves",
            qty: 3,
            eurRef: 0.5,
            set: "m19",
            set_name: "Core Set 2019",
            collector_number: "314",
          },
        ],
        status: "processing",
        checkoutSessionId: "demo_session",
      });
    } catch (e2) {
      setErr(parseFirebaseErr(e2));
    } finally {
      setLoading(false);
    }
  };

  // ====== pedidos filtrados/ordenados en cliente (usuario) ======
  const filteredOrders = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = orders.slice();

    if (term) {
      arr = arr.filter((o) => {
        const id = o.id?.toLowerCase?.() || "";
        const status = o.status?.toLowerCase?.() || "";
        const session = o.checkoutSessionId?.toLowerCase?.() || "";
        const itemsText = (o.items || [])
          .map((it) => (it.name || it.cardId || "").toLowerCase())
          .join(" ");
        return (
          id.includes(term) ||
          status.includes(term) ||
          session.includes(term) ||
          itemsText.includes(term)
        );
      });
    }

    arr.sort((a, b) => {
      const dir = orderDir === "asc" ? 1 : -1;
      if (orderByField === "createdAt") {
        const av = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bv = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return (av - bv) * dir;
      }
      if (orderByField === "totalEUR") {
        return ((a.totalEUR || 0) - (b.totalEUR || 0)) * dir;
      }
      if (orderByField === "totalQty") {
        return ((a.totalQty || 0) - (b.totalQty || 0)) * dir;
      }
      return 0;
    });

    return arr;
  }, [orders, q, orderByField, orderDir]);

  // ====== pedidos admin filtrados ======
  const filteredAdminOrders = useMemo(() => {
    const term = adminSearch.trim().toLowerCase();
    if (!term) return adminOrders;

    return adminOrders.filter((o) => {
      const id = o.id?.toLowerCase?.() || "";
      const status = o.status?.toLowerCase?.() || "";
      const session = o.checkoutSessionId?.toLowerCase?.() || "";
      const email = o._user?.email?.toLowerCase?.() || "";
      const name = o._user?.name?.toLowerCase?.() || "";
      const itemsText = (o.items || [])
        .map((it) => (it.name || it.cardId || "").toLowerCase())
        .join(" ");
      return (
        id.includes(term) ||
        status.includes(term) ||
        session.includes(term) ||
        email.includes(term) ||
        name.includes(term) ||
        itemsText.includes(term)
      );
    });
  }, [adminOrders, adminSearch]);

  // ========= Envío de email admin =========
  const handleAdminEmail = async (order, type) => {
    const label = type === "shipped" ? "Enviado" : "Recibido";
    const customerEmail = order._user?.email;
    const customerName = order._user?.name || "(sin nombre)";
    const shortId = order.id?.slice?.(-6)?.toUpperCase?.() || order.id;

    if (!customerEmail) {
      alert("Este pedido no tiene email de cliente asociado.");
      return;
    }

    const ok = window.confirm(
      `¿Quieres enviar el email de "${label}" al cliente ${customerName} <${customerEmail}> para el pedido #${shortId}?`
    );
    if (!ok) return;

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        alert("No hay usuario autenticado.");
        return;
      }

      const idToken = await currentUser.getIdToken();

      const res = await fetch("/api/admin/send-order-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`, // 🔐 muy importante
        },
        body: JSON.stringify({
          type, // "shipped" | "delivered"
          orderId: order.id,
          user: {
            uid: order._user?.uid,
            email: customerEmail,
            name: customerName,
          },
          totalEUR: order.totalEUR,
          totalQty: order.totalQty,
          items: order.items || [],
          checkoutSessionId: order.checkoutSessionId || null,
        }),
      });

      if (!res.ok) {
        console.error("Error al enviar email:", await res.text());
        alert("Hubo un problema al enviar el email. Revisa los logs del backend.");
        return;
      }

      alert(`Email "${label}" enviado correctamente.`);
    } catch (e) {
      console.error(e);
      alert("Error de red al intentar enviar el email.");
    }
  };

  // ======== Render UI ========
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#242424] flex items-center justify-center">
        <div className="text-gray-200">Cargando…</div>
      </div>
    );
  }

  // ---- No autenticado: Login / Registro
  if (!user) {
    return (
      <div className="min-h-screen bg-[#242424] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow border border-gray-200 text-black">
          <div className="p-4 border-b">
            <h1 className="text-xl font-bold">Tu cuenta</h1>
            <p className="text-sm text-gray-600">Accede o crea una cuenta para ver tus pedidos.</p>
          </div>

          <div className="px-4 pt-3 text-black">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setTab("login")}
                className={`cursor-pointer px-3 py-2 rounded-lg text-sm border ${tab === "login"
                    ? "bg-[#0cd806] text-white hover:bg-[#09f202]"
                    : "bg-white border-gray-300"
                  }`}
              >
                Iniciar sesión
              </button>
              <button
                onClick={() => setTab("register")}
                className={`cursor-pointer px-3 py-2 rounded-lg text-sm border ${tab === "register"
                    ? "bg-[#0cd806] text-white hover:bg-[#09f202]"
                    : "bg-white border-gray-300"
                  }`}
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#09f202]"
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#09f202]"
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className=" cursor-pointer w-full mt-2 py-2 rounded-lg bg-[#0cd806] hover:bg-[#09f202] text-white disabled:opacity-60"
              >
                {loading ? "Entrando…" : "Entrar"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="px-4 pb-4 space-y-3 text-black">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Nombre de usuario
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#09f202]"
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#09f202]"
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#09f202]"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="cursor-pointer w-full mt-2 py-2 rounded-lg bg-[#0cd806] hover:bg-[#09f202] text-white disabled:opacity-60"
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
    <div className="min-h-screen bg-[#242424] p-4 text-black">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Mi cuenta</h1>
            <p className="text-sm text-gray-300">
              ¡Hola, {user.displayName || profile?.name || user.email}!
            </p>
            {isAdmin && (
              <p className="mt-1 text-xs inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-300/20 text-yellow-200 border border-yellow-400/60">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                Modo administrador
              </p>
            )}
          </div>
          <button
            onClick={handleLogout}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
          >
            Cerrar sesión
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Datos de perfil */}
          <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <h2 className="font-semibold mb-2">Datos</h2>
            <div className="text-sm text-gray-800 space-y-1">
              <div>
                <span className="text-gray-500">Nombre:</span>{" "}
                {profile?.name || user.displayName || "—"}
              </div>
              <div>
                <span className="text-gray-500">Email:</span> {profile?.email || user.email}
              </div>
              <div>
                <span className="text-gray-500">UID:</span>{" "}
                <code className="text-xs">{user.uid}</code>
              </div>
              <div>
                <span className="text-gray-500">Miembro desde:</span>{" "}
                {formatDate(profile?.createdAt)}
              </div>
            </div>
          </div>

          {/* Pedidos del usuario */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4 overflow-x-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <h2 className="font-semibold">Mis pedidos</h2>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por ID, carta, estado…"
                  className="w-full sm:w-60 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#09f202]"
                />
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-lg border border-gray-300 px-2 py-2"
                    value={orderByField}
                    onChange={(e) => setOrderByField(e.target.value)}
                  >
                    <option value="createdAt">Ordenar por fecha</option>
                    <option value="totalEUR">Ordenar por total</option>
                    <option value="totalQty">Ordenar por unidades</option>
                  </select>
                  <button
                    onClick={() => setOrderDir((d) => (d === "asc" ? "desc" : "asc"))}
                    className="px-2 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#09f202] cursor-pointer"
                    title="Cambiar dirección"
                  >
                    {orderDir === "asc" ? "Asc" : "Desc"}
                  </button>
                </div>

                <button
                  onClick={crearPedidoDemo}
                  className="text-xs px-3 py-2 rounded bg-[#0cd806]/10 text-[#0cd806] hover:bg-[#0cd806]/20 cursor-pointer"
                >
                  Añadir pedido demo
                </button>
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="text-sm text-gray-600">Aún no tienes pedidos.</div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Pedido</th>
                      <th className="text-left font-medium px-3 py-2">Fecha</th>
                      <th className="text-left font-medium px-3 py-2">Unidades</th>
                      <th className="text-left font-medium px-3 py-2">Total</th>
                      <th className="text-left font-medium px-3 py-2">Estado</th>
                      <th className="text-right font-medium px-3 py-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredOrders.map((o) => (
                      <tr
                        key={o.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => setOpenOrder(o)}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenOrder(o);
                          }
                        }}
                        aria-label={`Abrir detalles del pedido ${o.id.slice(-6).toUpperCase()}`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">#{o.id.slice(-6).toUpperCase()}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {o.items?.length || 0} artículos ·{" "}
                            {o.tier ? `${o.tier} · ${formatMoney(o.unitPrice || 0)}` : "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2">{formatDate(o.createdAt)}</td>
                        <td className="px-3 py-2">
                          {o.totalQty ??
                            (o.items?.reduce?.((s, it) => s + (it.qty || 0), 0) || 0)}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {formatMoney(o.totalEUR)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 border text-xs rounded-full ${statusBadgeClasses(
                              o.status
                            )}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                            {o.status || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // evita abrir dos veces
                              setOpenOrder(o);
                            }}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#09f202] cursor-pointer text-sm"
                          >
                            Ver detalles
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* PANEL ADMIN */}
        {isAdmin && (
          <div className="mt-8 bg-white rounded-xl border border-yellow-300/60 shadow-sm p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                Panel administrador
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">
                  Todos los pedidos
                </span>
              </h2>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  placeholder="Buscar por cliente, email, ID, estado…"
                  className="w-full sm:w-72 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
            </div>

            {adminError && (
              <div className="mb-3 text-sm text-red-700 bg-red-100 rounded px-3 py-2">
                {adminError}
              </div>
            )}

            {adminLoading ? (
              <div className="text-sm text-gray-600">Cargando pedidos globales…</div>
            ) : filteredAdminOrders.length === 0 ? (
              <div className="text-sm text-gray-600">
                No hay pedidos registrados todavía (o no coinciden con el filtro).
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-yellow-50 text-gray-700">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Pedido</th>
                      <th className="text-left font-medium px-3 py-2">Cliente</th>
                      <th className="text-left font-medium px-3 py-2">Fecha</th>
                      <th className="text-left font-medium px-3 py-2">Total</th>
                      <th className="text-left font-medium px-3 py-2">Estado</th>
                      <th className="text-right font-medium px-3 py-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredAdminOrders.map((o) => {
                      const shortId = o.id.slice(-6).toUpperCase();
                      const customerName = o._user?.name || "(sin nombre)";
                      const customerEmail = o._user?.email || "(sin email)";
                      return (
                        <tr
                          key={`${o._user?.uid || "nouid"}-${o.id}`}
                          className="hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 align-top">
                            <div className="font-medium">#{shortId}</div>
                            <div className="text-[11px] text-gray-500 break-all">
                              session: {o.checkoutSessionId || "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="font-medium truncate max-w-[160px]">
                              {customerName}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate max-w-[180px]">
                              {customerEmail}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              uid: {o._user?.uid || "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {formatDate(o.createdAt)}
                          </td>
                          <td className="px-3 py-2 align-top font-semibold">
                            {formatMoney(o.totalEUR)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 border text-xs rounded-full ${statusBadgeClasses(
                                o.status
                              )}`}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                              {o.status || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top text-right space-y-1">
                            <button
                              onClick={() => setOpenOrder(o)}
                              className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 text-xs cursor-pointer"
                            >
                              Ver detalles
                            </button>
                            <div className="flex flex-col sm:flex-row gap-1 mt-1 sm:justify-end">
                              <button
                                onClick={() => handleAdminEmail(o, "shipped")}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs cursor-pointer"
                              >
                                Enviado
                              </button>
                              <button
                                onClick={() => handleAdminEmail(o, "delivered")}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs cursor-pointer"
                              >
                                Recibido
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Modal Detalles Pedido - responsive bottom-sheet en móvil, modal centrado en desktop */}
        {openOrder && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center text-black"
            aria-modal="true"
            role="dialog"
            aria-labelledby="order-title"
          >
            {/* Capa oscura de fondo */}
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpenOrder(null)} />

            {/* Contenedor modal */}
            <div
              className="relative w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-lg border border-gray-200
                            h-[85vh] sm:h-auto sm:max-h-[85vh] overflow-hidden"
            >
              {/* Handle / tirador visual en móvil */}
              <div className="sm:hidden flex justify-center pt-2">
                <span className="h-1.5 w-12 rounded-full bg-gray-300" />
              </div>

              {/* Header sticky */}
              <div className="sticky top-0 bg-white border-b border-gray-200 p-4 sm:p-6">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 id="order-title" className="text-lg font-bold truncate">
                      Pedido #{openOrder.id.slice(-6).toUpperCase()}
                    </h3>
                    <p className="text-xs text-gray-500">
                      Fecha: {formatDate(openOrder.createdAt)}
                    </p>
                    {openOrder._user && (
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        Cliente:{" "}
                        <span className="font-medium">
                          {openOrder._user.name || "(sin nombre)"}
                        </span>{" "}
                        · {openOrder._user.email || "(sin email)"}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setOpenOrder(null)}
                    className="px-2 py-1 rounded-lg border border-gray-300 hover:bg-gray-50"
                    aria-label="Cerrar"
                  >
                    ✕
                  </button>
                </div>

                {/* KPIs */}
                <div className="grid sm:grid-cols-3 gap-3 mt-3">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">Estado</div>
                    <div className="mt-0.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 border text-xs rounded-full ${statusBadgeClasses(
                          openOrder.status
                        )}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        {openOrder.status || "paid"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">Unidades</div>
                    <div className="font-medium">
                      {openOrder.totalQty ??
                        (openOrder.items?.reduce?.((s, it) => s + (it.qty || 0), 0) || 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">Total</div>
                    <div className="font-medium">{formatMoney(openOrder.totalEUR)}</div>
                  </div>
                </div>
              </div>

              {/* Contenido scrollable */}
              <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
                <div className="rounded-lg border border-gray-200">
                  <div className="p-3 border-b flex items-center justify-between">
                    <div className="text-sm font-semibold">Artículos</div>
                    <div className="text-xs text-gray-500">
                      Tarifa:{" "}
                      {openOrder.tier
                        ? `${openOrder.tier} · ${formatMoney(openOrder.unitPrice || 0)}`
                        : "—"}
                    </div>
                  </div>
                  <ul className="max-h-72 overflow-auto divide-y divide-gray-200">
                    {(openOrder.items || []).map((it, idx) => (
                      <li key={idx} className="p-3 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {it.name || it.cardId}
                          </div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {it.set_name || it.set || "—"}{" "}
                            {it.collector_number ? `· #${it.collector_number}` : ""}
                          </div>
                        </div>
                        <div className="text-sm text-gray-700">x{it.qty || 0}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="text-xs text-gray-500 break-all space-y-1">
                  <div>
                    session_id: <code>{openOrder.checkoutSessionId || "—"}</code>
                  </div>
                  {openOrder.source ? (
                    <div>
                      source: <code>{openOrder.source}</code>
                    </div>
                  ) : null}
                  {openOrder._user?.uid && (
                    <div>
                      uid cliente: <code>{openOrder._user.uid}</code>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer sticky */}
              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 sm:p-6 flex items-center justify-end gap-2">
                <button
                  onClick={() => setOpenOrder(null)}
                  className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
                >
                  Cerrar
                </button>
                <a
                  href="/catalogo"
                  className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
                >
                  Seguir comprando
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
