import React, { useState, useEffect } from "react";
import { faBars, faPerson } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faCartShopping } from '@fortawesome/free-solid-svg-icons'


import MenuHam from './MenuHam';
import { useLocation } from "react-router-dom"; // 👈 Detectar ruta actual

export default function Navbar() {
    const location = useLocation();
    const isHome = location.pathname === "/"; // 👈 Solo consideramos Home la ruta "/"

    // Estado inicial:
    // - En Home: arranca según la posición de scroll (transparente arriba, sólido al bajar).
    // - En otras rutas: "scrolled" en true para forzar el fondo sólido siempre.
    const [scrolled, setScrolled] = useState(() => {
        if (!isHome) return true;
        if (typeof window === "undefined") return false;
        return window.scrollY > 100;
    });

    useEffect(() => {
        // Si NO es Home:
        // - No registramos listener de scroll.
        // - Aseguramos fondo sólido.
        if (!isHome) {
            setScrolled(true);
            return;
        }

        // Solo en Home: registrar y manejar scroll
        const handleScroll = () => {
            if (window.scrollY > 100) {
                setScrolled(true);
            } else {
                setScrolled(false);
            }
        };

        window.addEventListener("scroll", handleScroll);
        // Forzamos evaluación inicial por si el usuario entra con un scroll previo (anclas, etc.)
        handleScroll();

        return () => window.removeEventListener("scroll", handleScroll);
    }, [isHome]);

    // Clases comunes
    const baseClasses =
        "p-2 flex-col justify-center align-center border-b border-gray-300 z-10 w-full transition-colors duration-300";

    // Posición:
    // - Home: fixed
    // - Resto: relative
    const positionClass = isHome ? "fixed" : "sticky top-0";

    // Fondo:
    // - Home: cambia con scroll (transparente ↔ rojo)
    // - Resto: siempre rojo
    const bgClass = isHome
        ? (scrolled ? "bg-red-600" : "bg-transparent")
        : "bg-red-600";

    return (
        <nav className={`${baseClasses} ${positionClass} ${bgClass}`}>
            <div className="flex relative w-full justify-between items-center h-15">
                <h1 className="text-2xl font-bold font-Modak absolute "><a href="/">NVPROXIS</a></h1>
                <div className=" justify-center items-center text-center flex w-full hidden sm:flex gap-4">


                    <a href="/catalogo" className="text-xl text-white
                transition-colors duration-200 ease-out
             hover:text-gray-400 w-30">Catálogo</a>

             <span className="text-2xl"> | </span>

                    <a href="/catalogo" className="text-xl text-white
                transition-colors duration-200 ease-out
             hover:text-gray-400 w-30">Mazo</a>

                </div>


                <ul>
                    <div className="hidden sm:flex justify-center gap-4 text-center text-sm mt-8">


                    </div>
                </ul>
                <div className="flex items-center gap-10 mr-10 absolute right-0 hidden sm:flex">
                    <a
                        href="/carrito"
                        className="text-2xl inline-flex h-6 w-6 items-center justify-center text-white
               transition-transform transition-colors duration-200 ease-out
               hover:scale-110 hover:text-red-400"
                    >
                        <FontAwesomeIcon icon={faCartShopping} />
                    </a>

                    <a
                        href="/cuenta"
                        className="text-2xl inline-flex h-6 w-6 items-center justify-center text-white
               transition-transform transition-colors duration-200 ease-out
               hover:scale-110 hover:text-red-400"
                    >
                        <FontAwesomeIcon icon={faUser} />
                    </a>
                </div>

                <div className="sm:hidden"><MenuHam /></div>

            </div>

            {/*
            <ul className="flex justify-center gap-4 text-center text-sm mt-8">
                <button className="cursor-pointer group relative  bg-transparent text-white-500 text-sm px-3 py-1 rounded w-25 ">
                    <p className="hover:scale-105 duration-200 hover:text-red-300">Hombre <span className="text-xs">↓</span></p>
                    <div className="bg-red-500 flex flex-col border border-gray-300 absolute top-full right-0 rounded-lg p-3 mt-4 shadow-md scale-y-0 group-focus:scale-y-100 origin-top duration-200 gap-4">
                        <a href="/hombre/camisetas" className="hover:text-red-300">Camisetas</a>
                        <a href="/hombre/sudaderas" className="hover:text-red-300">Sudaderas</a>
                        <a href="/hombre/zapatos" className="hover:text-red-300">Zapatos</a>
                        <a href="/hombre/accesorios" className="hover:text-red-300">Accesorios</a>
                    </div>
                </button>


                <li className="border-l border-gray-300"></li>
                <button className="cursor-pointer text-center group relative  bg-transparent text-white-500 text-sm px-3 py-1 rounded  w-25">
                    <p className="hover:scale-105 duration-200 hover:text-red-300">Mujer <span className="text-xs">↓</span></p>
                    <div className="bg-red-500 flex flex-col border border-gray-300 absolute top-full right-0 rounded-lg p-3 mt-4 shadow-md scale-y-0 group-focus:scale-y-100 origin-top duration-200 gap-4">
                        <a href="/mujer/camisetas" className="hover:text-red-300">Camisetas</a>
                        <a href="/mujer/sudaderas" className="hover:text-red-300">Sudaderas</a>
                        <a href="/mujer/zapatos" className="hover:text-red-300">Zapatos</a>
                        <a href="/mujer/accesorios" className="hover:text-red-300">Accesorios</a>
                    </div>
                </button>
            </ul>
      */}
        </nav>
    );
}
