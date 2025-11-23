import React, { useState, useEffect, useMemo, useRef } from "react";
import { useCart } from "../context/CartContext";
import ManaText from "../components/ManaText";
import { db, auth } from "../firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import SEO from "../components/SEO";

const SCRYFALL_API = "https://api.scryfall.com";
const DECK_STORAGE_KEY = "currentDeck";

const DECK_LIMITS = {
  commander: 100,
  standard: 60,
  modern: 60,
  legacy: 60,
  vintage: 60,
};

export default function ConstruirMazo() {
  // ===== AUTH STATE =====
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // ===== DECK STATE =====
  const [deckName, setDeckName] = useState("Mi Mazo");
  const [deckFormat, setDeckFormat] = useState("commander");
  const [deckDescription, setDeckDescription] = useState("");
  const [deckCards, setDeckCards] = useState([]); // {card, quantity, category}
  const [currentDeckId, setCurrentDeckId] = useState(null);
  const [savedDecks, setSavedDecks] = useState([]);

  const deckLimit = DECK_LIMITS[deckFormat] || 60;

  // ===== SEARCH STATE =====
  const [searchName, setSearchName] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [nextPage, setNextPage] = useState(null);
  const controllerRef = useRef(null);

  // ===== UI STATE =====
  const [expandedCategories, setExpandedCategories] = useState({
    commander: true,
    creatures: true,
    planeswalkers: true,
    instants: true,
    sorceries: true,
    artifacts: true,
    enchantments: true,
    lands: true,
    other: true,
  });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showCardDetail, setShowCardDetail] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [buttonError, setButtonError] = useState(null); // no usado de momento
  const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' }
  const [isLoaded, setIsLoaded] = useState(false); // Flag para saber si ya se cargaron los datos

  const showToast = (message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ===== CART INTEGRATION =====
  const { add: addToCart } = useCart();

  // ===== LOCAL STORAGE PERSISTENCE =====
  // Cargar datos al montar el componente (solo una vez)
  useEffect(() => {
    const savedData = localStorage.getItem(DECK_STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        setDeckName(parsed.name || "Mi Mazo");
        setDeckFormat(parsed.format || "commander");
        setDeckDescription(parsed.description || "");
        setDeckCards(parsed.cards || []);
        setCurrentDeckId(parsed.deckId || null);
      } catch (err) {
        console.error("Error loading deck from localStorage:", err);
      }
    }
    setIsLoaded(true); // Marcar como cargado
  }, []);

  // Guardar datos cada vez que cambien (solo después de cargar)
  useEffect(() => {
    if (!isLoaded) return; // No guardar hasta que se hayan cargado los datos

    const deckData = {
      name: deckName,
      format: deckFormat,
      description: deckDescription,
      cards: deckCards,
      deckId: currentDeckId,
    };
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deckData));
  }, [deckName, deckFormat, deckDescription, deckCards, currentDeckId, isLoaded]);

  // ===== AUTO SEARCH WITH DEBOUNCE =====
  useEffect(() => {
    // Si el campo está vacío, limpiar resultados inmediatamente
    if (!searchName.trim()) {
      setSearchResults([]);
      setSearchError("");
      return;
    }

    // Debounce: esperar 500ms después de que el usuario deje de escribir
    const timeoutId = setTimeout(() => {
      searchCards();
    }, 500);

    // Limpiar el timeout si el usuario sigue escribiendo
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchName]);


  // ===== HELPERS =====
  const getCardImage = (c, size = "small") => {
    try {
      if (c.image_uris?.[size]) return c.image_uris[size];
      if (Array.isArray(c.card_faces) && c.card_faces[0]?.image_uris?.[size]) {
        return c.card_faces[0].image_uris[size];
      }
    } catch { }
    return "";
  };

  const getManaCost = (c) => {
    if (c.mana_cost) return c.mana_cost;
    if (Array.isArray(c.card_faces) && c.card_faces[0]?.mana_cost) {
      return c.card_faces[0].mana_cost;
    }
    return "";
  };

  const getCMC = (c) => c.cmc || 0;

  const getOracleText = (c) => {
    if (c?.oracle_text) return c.oracle_text;
    if (Array.isArray(c?.card_faces)) {
      return c.card_faces
        .map((f) => f.oracle_text)
        .filter(Boolean)
        .join("\n—\n");
    }
    return "";
  };

  const categorizeCard = (card) => {
    const typeLine = (card.type_line || "").toLowerCase();

    if (
      typeLine.includes("legendary") &&
      typeLine.includes("creature") &&
      deckFormat === "commander"
    ) {
      return "commander";
    }
    if (typeLine.includes("creature")) return "creatures";
    if (typeLine.includes("planeswalker")) return "planeswalkers";
    if (typeLine.includes("instant")) return "instants";
    if (typeLine.includes("sorcery")) return "sorceries";
    if (typeLine.includes("artifact")) return "artifacts";
    if (typeLine.includes("enchantment")) return "enchantments";
    if (typeLine.includes("land")) return "lands";
    return "other";
  };

  const getCardColors = (card) => {
    if (card.colors && card.colors.length > 0) return card.colors;
    if (card.color_identity && card.color_identity.length > 0)
      return card.color_identity;
    return [];
  };

  // ===== DECK MANIPULATION =====
  const addCardToDeck = (card) => {
    const category = categorizeCard(card);
    const currentTotal = deckCards.reduce(
      (sum, dc) => sum + (Number(dc.quantity) || 0),
      0
    );

    // Límite de cartas del mazo
    if (currentTotal >= deckLimit) {
      showToast(`El mazo ha alcanzado el límite de ${deckLimit} cartas.`);
      return;
    }

    // Regla de comandante: solo 1 comandante
    if (category === "commander") {
      const alreadyCommander = deckCards.some(
        (dc) => dc.category === "commander"
      );
      if (alreadyCommander) {
        showToast("Ya tienes un comandante en el mazo.");
        return;
      }
    }

    // Verificar si es una tierra básica
    const typeLine = (card.type_line || "").toLowerCase();
    const isBasicLand = typeLine.includes("basic") && typeLine.includes("land");

    setDeckCards((prev) => {
      const existing = prev.find((dc) => dc.card.id === card.id);
      if (existing) {
        // En formato Commander, solo se puede tener 1 copia de cada carta (excepto tierras básicas)
        if (deckFormat === "commander" && !isBasicLand) {
          showToast("En formato Commander solo puedes tener 1 copia de cada carta (excepto tierras básicas).");
          return prev;
        }

        // Verificar límite del mazo
        const totalWithoutThis = prev.reduce(
          (sum, dc) =>
            dc.card.id === card.id
              ? sum
              : sum + (Number(dc.quantity) || 0),
          0
        );
        const maxAdd = deckLimit - totalWithoutThis;
        if (existing.quantity >= maxAdd) {
          showToast(`El mazo ha alcanzado el límite de ${deckLimit} cartas.`);
          return prev;
        }

        // En otros formatos, permitir hasta 4 copias (excepto tierras básicas que no tienen límite)
        if (deckFormat !== "commander" && !isBasicLand && existing.quantity >= 4) {
          showToast("Solo puedes tener hasta 4 copias de cada carta (excepto tierras básicas).");
          return prev;
        }

        return prev.map((dc) =>
          dc.card.id === card.id
            ? { ...dc, quantity: dc.quantity + 1 }
            : dc
        );
      }
      return [...prev, { card, quantity: 1, category }];
    });
  };

  const updateCardQuantity = (cardId, delta) => {
    const currentTotal = deckCards.reduce(
      (sum, dc) => sum + (Number(dc.quantity) || 0),
      0
    );

    if (delta > 0 && currentTotal >= deckLimit) {
      showToast(`El mazo ha alcanzado el límite de ${deckLimit} cartas.`);
      return;
    }

    setDeckCards((prev) =>
      prev
        .map((dc) => {
          if (dc.card.id === cardId) {
            const newQty = dc.quantity + delta;

            // Verificar si es una tierra básica
            const typeLine = (dc.card.type_line || "").toLowerCase();
            const isBasicLand = typeLine.includes("basic") && typeLine.includes("land");

            // En formato Commander, solo 1 copia de cada carta (excepto tierras básicas)
            if (delta > 0 && deckFormat === "commander" && !isBasicLand && newQty > 1) {
              showToast("En formato Commander solo puedes tener 1 copia de cada carta (excepto tierras básicas).");
              return dc;
            }

            // En otros formatos, máximo 4 copias (excepto tierras básicas)
            if (delta > 0 && deckFormat !== "commander" && !isBasicLand && newQty > 4) {
              showToast("Solo puedes tener hasta 4 copias de cada carta (excepto tierras básicas).");
              return dc;
            }

            return newQty > 0 ? { ...dc, quantity: newQty } : dc;
          }
          return dc;
        })
        .filter((dc) => dc.quantity > 0)
    );
  };

  const removeCardFromDeck = (cardId) => {
    setDeckCards((prev) => prev.filter((dc) => dc.card.id !== cardId));
  };

  const clearDeck = () => {
    if (window.confirm("¿Estás seguro de que quieres vaciar el mazo?")) {
      setDeckCards([]);
      setDeckName("Mi Mazo");
      setDeckDescription("");
      setCurrentDeckId(null);
    }
  };

  const openCardDetail = async (card) => {
    if (!card.oracle_text && card.id) {
      try {
        const res = await fetch(`${SCRYFALL_API}/cards/${card.id}`);
        if (res.ok) {
          const fullCard = await res.json();
          setSelectedCard(fullCard);
          setShowCardDetail(true);
          return;
        }
      } catch (err) {
        console.error("Error fetching card details:", err);
      }
    }
    setSelectedCard(card);
    setShowCardDetail(true);
  };

  const addAllDeckToCart = async () => {
    if (deckCards.length === 0) {
      showToast("El mazo está vacío.");
      return;
    }

    setIsAddingToCart(true);

    try {
      let addedCount = 0;
      let failedCount = 0;

      for (const dc of deckCards) {
        try {
          const res = await fetch(`${SCRYFALL_API}/cards/${dc.card.id}`);
          if (res.ok) {
            const fullCard = await res.json();
            await addToCart(fullCard, dc.quantity);
            addedCount += dc.quantity;
          } else {
            failedCount += dc.quantity;
            console.error(`Failed to fetch ${dc.card.name}`);
          }
        } catch (err) {
          failedCount += dc.quantity;
          console.error(`Error adding ${dc.card.name}:`, err);
        }
      }

      if (failedCount === 0) {
        showToast(
          `Todas las cartas han sido añadidas al carrito (${addedCount} cartas).`,
          "success"
        );
      } else {
        showToast(
          `⚠️ Se añadieron ${addedCount} cartas al carrito. ${failedCount} cartas no pudieron añadirse.`,
          "error"
        );
      }
    } catch (err) {
      showToast("❌ Error al añadir cartas al carrito: " + err.message);
    } finally {
      setIsAddingToCart(false);
    }
  };

  // ===== DECK PERSISTENCE (FIRESTORE) =====
  const saveDeck = async () => {
    if (!user) {
      showToast("Debes iniciar sesión para guardar mazos.");
      return;
    }

    try {
      const deckData = {
        userId: user.uid,
        name: deckName,
        format: deckFormat,
        description: deckDescription,
        cards: deckCards.map((dc) => ({
          cardId: dc.card.id,
          name: dc.card.name,
          quantity: dc.quantity,
          category: dc.category,
          imageUrl: getCardImage(dc.card, "small"),
          manaCost: getManaCost(dc.card),
          cmc: getCMC(dc.card),
          typeLine: dc.card.type_line,
          colors: getCardColors(dc.card),
        })),
        updatedAt: serverTimestamp(),
      };

      if (currentDeckId) {
        await updateDoc(doc(db, "decks", currentDeckId), deckData);
        showToast("✅ Mazo actualizado correctamente.", "success");
      } else {
        deckData.createdAt = serverTimestamp();
        const docRef = await addDoc(collection(db, "decks"), deckData);
        setCurrentDeckId(docRef.id);
        showToast("✅ Mazo guardado correctamente.", "success");
      }

      loadUserDecks();
    } catch (err) {
      console.error("Error saving deck:", err);
      showToast("❌ Error al guardar el mazo: " + err.message);
    }
  };

  const loadUserDecks = async () => {
    if (!user) return;

    try {
      const q = query(
        collection(db, "decks"),
        where("userId", "==", user.uid)
      );
      const querySnapshot = await getDocs(q);
      const decks = [];
      querySnapshot.forEach((d) => {
        decks.push({ id: d.id, ...d.data() });
      });
      setSavedDecks(decks);
    } catch (err) {
      console.error("Error loading decks:", err);
    }
  };

  const loadDeck = (deck) => {
    setDeckName(deck.name);
    setDeckFormat(deck.format);
    setDeckDescription(deck.description || "");
    setCurrentDeckId(deck.id);

    setDeckCards(
      (deck.cards || []).map((cardData) => ({
        card: {
          id: cardData.cardId,
          name: cardData.name,
          image_uris: { small: cardData.imageUrl },
          mana_cost: cardData.manaCost,
          cmc: cardData.cmc,
          type_line: cardData.typeLine,
          colors: cardData.colors,
        },
        quantity: cardData.quantity,
        category: cardData.category,
      }))
    );

    setShowLoadDialog(false);
  };

  const deleteDeck = async (deckId) => {
    if (!window.confirm("¿Estás seguro de que quieres eliminar este mazo?"))
      return;

    try {
      await deleteDoc(doc(db, "decks", deckId));
      showToast("Mazo eliminado correctamente.", "success");
      loadUserDecks();
      if (currentDeckId === deckId) {
        clearDeck();
      }
    } catch (err) {
      console.error("Error deleting deck:", err);
      showToast("Error al eliminar el mazo: " + err.message);
    }
  };

  useEffect(() => {
    if (user) {
      loadUserDecks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ===== STATISTICS =====
  const deckStats = useMemo(() => {
    const totalCards = deckCards.reduce(
      (sum, dc) => sum + (Number(dc.quantity) || 0),
      0
    );

    const manaCurve = {};
    deckCards.forEach((dc) => {
      const cmc = getCMC(dc.card);
      const cmcKey = cmc >= 7 ? "7+" : cmc.toString();
      manaCurve[cmcKey] = (manaCurve[cmcKey] || 0) + dc.quantity;
    });

    const colorCount = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    deckCards.forEach((dc) => {
      const colors = getCardColors(dc.card);
      if (colors.length === 0) {
        colorCount.C += dc.quantity;
      } else {
        colors.forEach((color) => {
          colorCount[color] = (colorCount[color] || 0) + dc.quantity;
        });
      }
    });

    const typeCount = {};
    deckCards.forEach((dc) => {
      typeCount[dc.category] = (typeCount[dc.category] || 0) + dc.quantity;
    });

    const totalCMC = deckCards.reduce(
      (sum, dc) => sum + getCMC(dc.card) * dc.quantity,
      0
    );
    const avgCMC = totalCards > 0 ? (totalCMC / totalCards).toFixed(2) : 0;

    return { totalCards, manaCurve, colorCount, typeCount, avgCMC };
  }, [deckCards]);

  // ===== EXPORT =====
  const exportDeckToText = () => {
    let text = `${deckName}\n`;
    text += `Format: ${deckFormat}\n\n`;

    const categories = [
      "commander",
      "creatures",
      "planeswalkers",
      "instants",
      "sorceries",
      "artifacts",
      "enchantments",
      "lands",
      "other",
    ];

    categories.forEach((cat) => {
      const cards = deckCards.filter((dc) => dc.category === cat);
      if (cards.length > 0) {
        text += `\n${cat.charAt(0).toUpperCase() + cat.slice(1)}:\n`;
        cards.forEach((dc) => {
          text += `${dc.quantity} ${dc.card.name}\n`;
        });
      }
    });

    text += `\nTotal: ${deckStats.totalCards} cards\n`;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deckName.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ===== SEARCH FUNCTIONALITY =====
  const searchCards = async () => {
    if (!searchName.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchError("");
    setSearchLoading(true);
    setSearchResults([]);
    setNextPage(null);

    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();

    try {
      const q = `name:${searchName.trim()}*`;
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(
        q
      )}&unique=cards&order=name`;
      const res = await fetch(url, { signal: controllerRef.current.signal });
      if (!res.ok) throw new Error("No se encontraron cartas.");
      const list = await res.json();
      setSearchResults(list.data || []);
      setNextPage(list.has_more ? list.next_page : null);
    } catch (err) {
      if (err?.name !== "AbortError") {
        setSearchError(err.message || "Error desconocido.");
      }
    } finally {
      setSearchLoading(false);
    }
  };

  const loadMoreResults = async () => {
    if (!nextPage) return;
    setSearchLoading(true);
    try {
      const res = await fetch(nextPage);
      if (!res.ok) throw new Error("No se pudo cargar más.");
      const list = await res.json();
      setSearchResults((prev) => [...prev, ...(list.data || [])]);
      setNextPage(list.has_more ? list.next_page : null);
    } catch (err) {
      setSearchError(err.message || "Error desconocido.");
    } finally {
      setSearchLoading(false);
    }
  };

  // ===== UI HELPERS =====
  const categoryLabels = {
    commander: "Comandante",
    creatures: "Criaturas",
    planeswalkers: "Planeswalkers",
    instants: "Instantáneos",
    sorceries: "Conjuros",
    artifacts: "Artefactos",
    enchantments: "Encantamientos",
    lands: "Tierras",
    other: "Otros",
  };

  const toggleCategory = (cat) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  // ===== RENDER =====
  return (
    <div className="min-h-screen text-white flex flex-col" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
      <SEO
        title="Construir Mazo - Tienda de Cartas"
        description="Crea y gestiona tus mazos de Magic: The Gathering. Analiza tu curva de maná y estadísticas."
      />

      {toast && (
        <div
          className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-slide-down"
          style={{
            animation: 'slideDown 0.3s ease-out'
          }}
        >
          <div
            className={`${toast.type === "success"
              ? "bg-gradient-to-r from-green-500 to-green-600 border-green-400"
              : "bg-gradient-to-r from-red-500 to-red-600 border-red-400"
              } text-white px-6 py-3 rounded-lg shadow-2xl border-2 min-w-[300px] max-w-[600px]`}
          >
            <div className="flex items-center gap-3">

              <span className="font-medium text-sm">{toast.message}</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translate(-50%, -20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>

      {/* Top Bar */}
      <div className="border-b border-[#0cd806]/30 p-4 sticky top-0 z-20 shadow-lg backdrop-blur-md bg-[#1a1a1a]/90">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center gap-4">
          <input
            type="text"
            className="flex-1 min-w-[200px] rounded-lg border border-gray-600 bg-[#242424] text-white px-4 py-2.5 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#0cd806] focus:border-transparent transition-all"
            placeholder="Nombre del mazo"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
          />

          <select
            className="rounded-lg border border-gray-600 bg-[#242424] text-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0cd806] cursor-pointer hover:bg-[#2a2a2a] transition-colors"
            value={deckFormat}
            onChange={(e) => setDeckFormat(e.target.value)}
          >
            <option value="commander">Commander (100)</option>
            <option value="standard">Standard (60)</option>
            <option value="modern">Modern (60)</option>
            <option value="legacy">Legacy (60)</option>
            <option value="vintage">Vintage (60)</option>
          </select>

          <div className="flex gap-2">
            <button
              onClick={() => setShowSaveDialog(true)}
              className="px-4 py-2.5 rounded-lg font-medium text-white transition-all duration-300 hover:scale-105 shadow-md cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #0cd806 0%, #09f202 100%)' }}
            >
              Guardar
            </button>

            <button
              onClick={() => setShowLoadDialog(true)}
              className="px-4 py-2.5 rounded-lg font-medium text-white transition-all duration-300 hover:scale-105 shadow-md cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' }}
            >
              Cargar
            </button>

            <button
              onClick={exportDeckToText}
              className="px-4 py-2.5 rounded-lg font-medium text-white transition-all duration-300 hover:scale-105 shadow-md cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #9333ea 0%, #a855f7 100%)' }}
            >
              Exportar
            </button>

            <button
              onClick={clearDeck}
              className="px-4 py-2.5 rounded-lg font-medium text-white transition-all duration-300 hover:scale-105 shadow-md cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' }}
            >
              Limpiar
            </button>
          </div>

          <button
            onClick={addAllDeckToCart}
            className="cursor-pointer px-6 py-2.5 rounded-lg font-bold text-white transition-all duration-300 hover:scale-105 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            style={{
              background: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)',
              boxShadow: '0 4px 12px rgba(234, 88, 12, 0.3)'
            }}
            disabled={deckCards.length === 0 || isAddingToCart}
          >
            {isAddingToCart ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                Agregando...
              </>
            ) : (
              "Añadir Mazo al Carrito"
            )}
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="w-full max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        {/* LEFT PANEL - Card Search */}
        <div className="lg:col-span-3 bg-[#141414] border border-[#0cd806]/30 rounded-xl p-4 shadow-lg h-fit sticky top-24">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            Buscar Cartas
          </h2>

          <div className="mb-4">
            <input
              type="text"
              className="w-full rounded-lg border border-gray-600 bg-[#242424] text-white px-4 py-2.5 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#0cd806] transition-all"
              placeholder="Escribe para buscar cartas..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
            />
            {searchLoading && (
              <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <span className="inline-block animate-spin">⏳</span>
                Buscando...
              </div>
            )}
          </div>

          {searchError && (
            <div className="bg-red-200 text-red-800 px-3 py-2 rounded mb-3 text-sm">
              {searchError}
            </div>
          )}

          <div className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto pr-1 custom-scrollbar">
            {searchResults.map((card) => (
              <div
                key={card.id}
                className="flex items-center gap-3 p-2 bg-[#242424] rounded-lg hover:bg-[#2a2a2a] cursor-pointer transition-all duration-200 border border-transparent hover:border-[#0cd806]/50 group"
                onClick={() => openCardDetail(card)}
                title="Clic para ver detalles"
              >
                <img
                  src={getCardImage(card, "small")}
                  alt={card.name}
                  className="w-12 h-16 object-cover rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {card.name}
                  </div>
                  <div className="text-xs text-gray-400">
                    <ManaText text={getManaCost(card)} size="sm" />
                  </div>
                </div>
                <button
                  className="w-8 h-8 flex items-center justify-center bg-[#0cd806] hover:bg-[#09f202] rounded-full text-white font-bold shadow-md transition-transform hover:scale-110"
                  onClick={(e) => {
                    e.stopPropagation();
                    addCardToDeck(card);
                  }}
                  title="Añadir al mazo"
                >
                  +
                </button>
              </div>
            ))}

            {nextPage && !searchLoading && (
              <button
                onClick={loadMoreResults}
                className="w-full py-2 bg-[#0cd806] hover:bg-[#09f202] rounded-lg cursor-pointer text-sm"
              >
                Cargar más
              </button>
            )}
          </div>
        </div>

        {/* CENTER PANEL - Deck List */}
        <div className="lg:col-span-6 bg-[#141414] border border-[#0cd806]/30 rounded-xl p-4 shadow-lg">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            Lista del Mazo <span className="text-sm font-normal text-gray-400">({deckStats.totalCards}/{deckLimit} cartas)</span>
          </h2>

          <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-1 custom-scrollbar">
            {Object.keys(categoryLabels).map((cat) => {
              const cards = deckCards.filter((dc) => dc.category === cat);
              if (cards.length === 0) return null;

              const count = cards.reduce(
                (sum, dc) => sum + (Number(dc.quantity) || 0),
                0
              );

              return (
                <div key={cat} className="border border-gray-800 rounded-xl overflow-hidden bg-[#1a1a1a]">
                  <div
                    className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[#242424] transition-colors"
                    onClick={() => toggleCategory(cat)}
                    style={{ borderLeft: `4px solid #0cd806` }}
                  >
                    <span className="font-bold text-gray-200">
                      {categoryLabels[cat]} <span className="text-[#0cd806] ml-1">({count})</span>
                    </span>
                    <span className="text-gray-500">{expandedCategories[cat] ? "▼" : "▶"}</span>
                  </div>

                  {expandedCategories[cat] && (
                    <div className="p-2 space-y-1 bg-[#141414]">
                      {cards.map((dc) => (
                        <div
                          key={`${dc.card.id}-${cat}`}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#242424] transition-all group border border-transparent hover:border-[#0cd806]/30"
                        >
                          <img
                            src={getCardImage(dc.card, "small")}
                            alt={dc.card.name}
                            className="w-10 h-14 object-cover rounded cursor-pointer shadow-sm group-hover:shadow-md transition-all"
                            onClick={() => openCardDetail(dc.card)}
                            title="Ver detalles"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate text-gray-200 group-hover:text-white">
                              {dc.card.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              <ManaText
                                text={getManaCost(dc.card)}
                                size="sm"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                updateCardQuantity(dc.card.id, -1)
                              }
                              className="w-7 h-7 flex items-center justify-center bg-[#242424] border border-gray-700 hover:border-red-500 hover:text-red-500 rounded-lg cursor-pointer text-sm transition-all"
                            >
                              −
                            </button>
                            <span className="text-sm font-bold w-6 text-center text-white">
                              {dc.quantity}
                            </span>
                            <button
                              onClick={() =>
                                updateCardQuantity(dc.card.id, 1)
                              }
                              className="w-7 h-7 flex items-center justify-center bg-[#242424] border border-gray-700 hover:border-[#0cd806] hover:text-[#0cd806] rounded-lg cursor-pointer text-sm transition-all"
                            >
                              +
                            </button>
                            <button
                              onClick={() => removeCardFromDeck(dc.card.id)}
                              className="ml-2 w-7 h-7 flex items-center justify-center bg-red-900/20 text-red-500 hover:bg-red-600 hover:text-white rounded-lg cursor-pointer text-sm transition-all"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {deckCards.length === 0 && (
              <div className="text-center text-gray-500 py-12 border-2 border-dashed border-gray-800 rounded-xl">
                <p className="text-lg font-medium mb-2">El mazo está vacío</p>
                <p className="text-sm">
                  Busca cartas en el panel izquierdo y añádelas aquí.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL - Statistics */}
        <div className="lg:col-span-3 bg-[#141414] border border-[#0cd806]/30 rounded-xl p-4 shadow-lg h-fit sticky top-24">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">Estadísticas</h2>

          <div className="space-y-4">
            {/* Total Cards */}
            <div className="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800 shadow-sm">
              <div className="text-sm text-gray-400 mb-1">Total de Cartas</div>
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold text-white">
                  {deckStats.totalCards}<span className="text-lg text-gray-500 font-normal">/{deckLimit}</span>
                </div>
                <div className={`text-xs px-2 py-1 rounded-full ${deckStats.totalCards === deckLimit ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'}`}>
                  {deckStats.totalCards === deckLimit
                    ? "✓ Completo"
                    : `${deckLimit - deckStats.totalCards} restantes`}
                </div>
              </div>
            </div>

            {/* Average CMC */}
            <div className="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800 shadow-sm">
              <div className="text-sm text-gray-400 mb-1">CMC Promedio</div>
              <div className="text-3xl font-bold text-[#0cd806]">{deckStats.avgCMC}</div>
            </div>

            {/* Mana Curve */}
            <div className="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800 shadow-sm">
              <div className="text-sm font-semibold mb-3 text-gray-300">Curva de Maná</div>
              <div className="space-y-2">
                {[0, 1, 2, 3, 4, 5, 6, "7+"].map((cmc) => {
                  const count =
                    deckStats.manaCurve[cmc.toString()] || 0;
                  const percentage =
                    deckStats.totalCards > 0
                      ? (count / deckStats.totalCards) * 100
                      : 0;
                  return (
                    <div key={cmc} className="flex items-center gap-2">
                      <span className="text-xs w-4 text-gray-500">{cmc}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-[#0cd806] h-full transition-all duration-500 ease-out rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-xs w-6 text-right font-medium text-gray-300">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Color Distribution */}
            <div className="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800 shadow-sm">
              <div className="text-sm font-semibold mb-3 text-gray-300">
                Distribución de Colores
              </div>
              <div className="space-y-2">
                {Object.entries({
                  W: { label: "Blanco", color: "#F0E68C" },
                  U: { label: "Azul", color: "#0E68AB" },
                  B: { label: "Negro", color: "#A69F9D" },
                  R: { label: "Rojo", color: "#D3202A" },
                  G: { label: "Verde", color: "#00733E" },
                  C: { label: "Incoloro", color: "#BEB9B2" },
                }).map(([colorKey, { label, color }]) => {
                  const count = deckStats.colorCount[colorKey] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={colorKey} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shadow-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs flex-1 text-gray-300">{label}</span>
                      <span className="text-xs font-bold text-white">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Type Breakdown */}
            <div className="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800 shadow-sm">
              <div className="text-sm font-semibold mb-3 text-gray-300">
                Tipos de Carta
              </div>
              <div className="space-y-1">
                {Object.entries(deckStats.typeCount).map(
                  ([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between text-xs py-1 border-b border-gray-800 last:border-0"
                    >
                      <span className="text-gray-400">{categoryLabels[type]}</span>
                      <span className="font-bold text-white">{count}</span>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card Detail Dialog */}
      {showCardDetail && selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => setShowCardDetail(false)}
        >
          <div
            className="bg-[#141414] rounded-xl max-w-4xl w-full overflow-hidden shadow-2xl"
            style={{
              border: '1px solid rgba(12, 216, 6, 0.3)',
              boxShadow: '0 0 40px rgba(12, 216, 6, 0.15)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col md:flex-row">
              <div className="md:w-1/2 flex items-center justify-center p-6 bg-[#1a1a1a]">
                <img
                  src={
                    getCardImage(selectedCard, "large") ||
                    getCardImage(selectedCard, "normal")
                  }
                  alt={selectedCard.name}
                  className="rounded-xl shadow-2xl max-h-[500px] transition-transform hover:scale-105 duration-500"
                />
              </div>

              <div className="md:w-1/2 p-6 space-y-4">
                <div className="flex justify-between items-start gap-3">
                  <h2 className="text-2xl font-bold text-white">
                    {selectedCard.name}
                  </h2>
                  <button
                    className="text-gray-500 hover:text-white cursor-pointer text-2xl leading-none transition-colors"
                    onClick={() => setShowCardDetail(false)}
                    aria-label="Cerrar"
                  >
                    ✕
                  </button>
                </div>

                <div className="text-sm text-gray-300 space-y-2">
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="font-semibold text-gray-400">Tipo:</span>
                    <span>{selectedCard.type_line}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="font-semibold text-gray-400">Set:</span>
                    <span>{selectedCard.set_name} ({selectedCard.set?.toUpperCase()})</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="font-semibold text-gray-400">Rareza:</span>
                    <span className="capitalize">{selectedCard.rarity}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="font-semibold text-gray-400">Coste de Maná:</span>
                    <ManaText text={getManaCost(selectedCard)} size="sm" />
                  </div>
                </div>

                <div className="text-sm bg-[#242424] p-4 rounded-lg border border-gray-800">
                  <div className="font-semibold mb-2 text-[#0cd806]">
                    Texto de Reglas:
                  </div>
                  <div className="leading-relaxed text-gray-300">
                    <ManaText
                      text={getOracleText(selectedCard) || "Sin texto de reglas."}
                      size="sm"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    className="w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all hover:scale-105"
                    style={{ background: 'linear-gradient(135deg, #0cd806 0%, #09f202 100%)' }}
                    onClick={() => {
                      addCardToDeck(selectedCard);
                      setShowCardDetail(false);
                    }}
                  >
                    ➕ Añadir al Mazo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Dialog */}
      {showSaveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(0, 0, 0, 0.7)' }}
        >
          <div
            className="bg-[#141414] rounded-xl p-6 max-w-md w-full shadow-2xl"
            style={{
              border: '1px solid rgba(12, 216, 6, 0.3)',
              boxShadow: '0 0 40px rgba(12, 216, 6, 0.15)'
            }}
          >
            <h3 className="text-xl font-bold mb-4 text-white">💾 Guardar Mazo</h3>

            {!user ? (
              <div className="text-center py-4">
                <p className="mb-6 text-gray-300">
                  Debes iniciar sesión para guardar mazos.
                </p>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-white transition-colors"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-300">
                    Nombre del Mazo
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-600 bg-[#242424] text-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0cd806]"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                  />
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium mb-2 text-gray-300">
                    Descripción (opcional)
                  </label>
                  <textarea
                    className="w-full rounded-lg border border-gray-600 bg-[#242424] text-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0cd806]"
                    rows="3"
                    value={deckDescription}
                    onChange={(e) =>
                      setDeckDescription(e.target.value)
                    }
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      saveDeck();
                      setShowSaveDialog(false);
                    }}
                    className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white shadow-md transition-transform hover:scale-105"
                    style={{ background: 'linear-gradient(135deg, #0cd806 0%, #09f202 100%)' }}
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => setShowSaveDialog(false)}
                    className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-white transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(8px)', background: 'rgba(0, 0, 0, 0.7)' }}
        >
          <div
            className="bg-[#141414] rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl custom-scrollbar"
            style={{
              border: '1px solid rgba(12, 216, 6, 0.3)',
              boxShadow: '0 0 40px rgba(12, 216, 6, 0.15)'
            }}
          >
            <h3 className="text-xl font-bold mb-4 text-white">📂 Cargar Mazo</h3>

            {!user ? (
              <div className="text-center py-4">
                <p className="mb-6 text-gray-300">
                  Debes iniciar sesión para cargar mazos.
                </p>
                <button
                  onClick={() => setShowLoadDialog(false)}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-white transition-colors"
                >
                  Cerrar
                </button>
              </div>
            ) : savedDecks.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-gray-800 rounded-xl">
                <p className="mb-4 text-gray-400">No tienes mazos guardados.</p>
                <button
                  onClick={() => setShowLoadDialog(false)}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-white transition-colors"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-6">
                  {savedDecks.map((deck) => (
                    <div
                      key={deck.id}
                      className="bg-[#242424] p-4 rounded-xl flex items-center justify-between hover:bg-[#2a2a2a] border border-gray-800 hover:border-[#0cd806]/30 transition-all group"
                    >
                      <div className="flex-1">
                        <div className="font-bold text-white group-hover:text-[#0cd806] transition-colors">{deck.name}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          <span className="bg-gray-800 px-2 py-0.5 rounded text-gray-300">{deck.format}</span>
                          <span className="mx-2">•</span>
                          {deck.cards?.reduce(
                            (sum, c) => sum + c.quantity,
                            0
                          ) || 0}{" "}
                          cartas
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => loadDeck(deck)}
                          className="px-3 py-1.5 bg-[#0cd806]/20 text-[#0cd806] border border-[#0cd806]/50 hover:bg-[#0cd806] hover:text-white rounded-lg cursor-pointer text-sm transition-all font-medium"
                        >
                          Cargar
                        </button>
                        <button
                          onClick={() => deleteDeck(deck.id)}
                          className="px-3 py-1.5 bg-red-900/20 text-red-500 border border-red-900/50 hover:bg-red-600 hover:text-white rounded-lg cursor-pointer text-sm transition-all font-medium"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setShowLoadDialog(false)}
                  className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-white transition-colors font-medium"
                >
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
