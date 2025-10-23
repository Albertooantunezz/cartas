import { useState } from "react";
import { products } from "./productService";

export default function ProductList() {
  const [visibleCount, setVisibleCount] = useState(3); // Cuántos productos mostrar

  // Productos que se van a mostrar
  const visibleProducts = products.slice(0, visibleCount);

  const handleShowMore = () => {
    // Aumenta el número de productos visibles de 6 en 6
    setVisibleCount((prev) => prev + 3);
  };

  return (
    <div className="p-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {visibleProducts.map((p) => (
          <div
            key={p.id}
            className="rounded-lg p-4 shadow flex flex-col items-center"
          >
            <img
              src={p.image}
              alt={p.name}
              className="w-full h-60 object-cover"
            />
            <h3 className="font-bold mt-2">{p.name}</h3>
            <p>${p.price}</p>
            <button className="bg-blue-600 text-white px-4 py-2 rounded mt-2">
              Añadir al carrito
            </button>
          </div>
        ))}
      </div>

      {/* Botón "Ver más" solo si hay más productos */}
      {visibleCount < products.length && (
        <div className="flex justify-center mt-6">
          <button
            onClick={handleShowMore}
            className="bg-gray-800 text-white px-6 py-2 rounded hover:bg-gray-700"
          >
            Ver más
          </button>
        </div>
      )}
    </div>
  );
}
