import React, { useState, useEffect } from "react";
import { faBars, faPerson } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import MenuHam from './MenuHam';

export default function Navbar() {

    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > 100) {
                setScrolled(true);
            } else {
                setScrolled(false);
            }
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    return (

        <nav className={`p-2 fixed flex-col justify-center align-center border-b border-gray-300 z-10 w-full transition-colors duration-300
      ${scrolled ? "bg-red-600" : "bg-transparent"}`}
        >
            <div className="flex relative w-full justify-between items-center">
                
                <div className="flex-col justify-center items-center text-center">
                    <h1 className="text-2xl font-bold font-Modak">CARDS</h1>
                </div>
                <MenuHam />
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
