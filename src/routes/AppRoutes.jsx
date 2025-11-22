import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "../pages/Home";
import CartPage from "../pages/Carrito";
import NotFound from "../pages/NotFound";
import Navbar from "../components/Navbar";
import React from "react";
import Footer from "../components/Footer";
import Catalogo from "../pages/Catalogo";
import Cuenta from "../pages/Cuenta";
import CheckoutSuccess from "../pages/CheckoutSuccess";
import CheckoutCancel from "../pages/CheckoutCancel";
import ConstruirMazo from "../pages/ConstruirMazo";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/carrito" element={<CartPage />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/cuenta" element={<Cuenta />} />
        <Route path="/construir-mazo" element={<ConstruirMazo />} />
        <Route path="*" element={<NotFound />} />

        {/* ✅ rutas nuevas para Stripe */}
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/cancel" element={<CheckoutCancel />} />

        {/* rutas antiguas opcionales si ya estaban en uso */}
        <Route path="/checkout-success" element={<CheckoutSuccess />} />
        <Route path="/checkout-cancel" element={<CheckoutCancel />} />

      </Routes>
      <Footer />
    </BrowserRouter>
  );
}
