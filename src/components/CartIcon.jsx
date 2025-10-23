// src/components/CartIcon.jsx
import React from "react";
import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { faCartShopping } from '@fortawesome/free-solid-svg-icons'

export default function CartIcon() {
  const { totalQty } = useCart();

  return (
    <Link to="/carrito" className="relative inline-flex items-center">
      <FontAwesomeIcon icon={faCartShopping} />
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l3-8H6.4M7 13L5.4 5M7 13l-2 9m12-9l-2 9m-8 0h12" />
      </svg>

      {/* Burbuja */}
      {totalQty > 0 && (
        <span className="absolute -top-2 -right-2 text-[10px] leading-none px-1.5 py-1 rounded-full bg-red-600 text-white">
          {totalQty}
        </span>
      )}
    </Link>
  );
}
