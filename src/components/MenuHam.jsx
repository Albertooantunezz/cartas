import React, { useState } from 'react'
import { faBars, faUser, faCartShopping, faPerson, faPersonDress } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCart } from "../context/CartContext"; // 👈 Para el contador del carrito

export default function MenuHam() {

    const { totalQty } = useCart(); // 👈 Obtener cantidad total de items en el carrito
    const [isOpen, setIsOpen] = useState(false);

    const toggleMenu = () => {
        setIsOpen(!isOpen);
    }

    const [manisOpen, setManisOpen] = useState(false);

    const toggleManis = () => {
        setManisOpen(!manisOpen);
    }

    const [womenisOpen, setWomenisOpen] = useState(false);

    const toggleWomenis = () => {
        setWomenisOpen(!womenisOpen);
    }

    return (
        <div>
            <button onClick={toggleMenu} className="mt-5 cursor-pointer fixed bg-transparent text-white-500 rounded top-0 right-0 z-10 m-2">
                <p className="hover:scale-105 duration-200 text-2xl"><FontAwesomeIcon icon={faBars} /></p>
            </button>
            <div
                className={`fixed top-0 right-0 h-full w-64 bg-[#141414] border-l border-[#0cd806] shadow-md flex flex-col gap-6 p-6 transform transition-transform duration-300 ease-in-out z-50
          ${isOpen && !manisOpen && !womenisOpen ? "translate-x-0" : "translate-x-full"}`}
            >
                <button className="mt-16 flex justify-between text-white text-lg font-semibold hover:text-[#0cd806] transition-colors">
                    <a href="/catalogo">Catálogo</a>
                </button>

                <button className="flex justify-between text-white text-lg font-semibold hover:text-[#0cd806] transition-colors">
                    <a href="/construir-mazo">Construir Mazo</a>
                </button>

                <a href="/cuenta" className="text-white text-lg font-semibold hover:text-[#0cd806] transition-colors flex items-center gap-3">
                    <FontAwesomeIcon icon={faUser} /> Cuenta
                </a>
                <a href="/carrito" className="text-white text-lg font-semibold hover:text-[#0cd806] transition-colors relative inline-flex items-center gap-3">
                    <FontAwesomeIcon icon={faCartShopping} /> Carrito
                    {totalQty > 0 && (
                        <span className="bg-[#0cd806] text-black text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                            {totalQty}
                        </span>
                    )}
                </a>
            </div>

            {/*  

            <div
                className={`fixed top-0 right-0 h-full w-50 bg-red-500 shadow-md flex flex-col gap-8 p-5 transform transition-transform duration-300 ease-in-out z-5
          ${manisOpen ? "translate-x-0" : "translate-x-full"}`}
            >   
                <button onClick={toggleManis} className="cursor-pointer fixed bg-transparent text-white-500 rounded top-0 right-40 z-10 m-2">
                    <p className="hover:scale-105 duration-200 text-xl">{"<"}</p>
                </button>
                <h4 className='font-bold text-xl mt-10 border-b border-gray-300'>Hombre</h4>

                <button className="flex justify-between">
                    <a href="/hombre/camisetas">Camisetas</a>
                </button>

                <button className="flex justify-between">
                    <a href="/hombre/sudaderas">Sudaderas</a>
                </button>

                <button className="flex justify-between">
                    <a href="/hombre/zapatos">Zapatos</a>
                </button>

                <button className="flex justify-between">
                    <a href="/hombre/accesorios">Accesorios</a>
                </button>
            </div>

             <div
                className={`fixed top-0 right-0 h-full w-50 bg-red-500 shadow-md flex flex-col gap-8 p-5 transform transition-transform duration-300 ease-in-out z-5
          ${womenisOpen ? "translate-x-0" : "translate-x-full"}`}
            >   
                <button onClick={toggleWomenis} className="cursor-pointer fixed bg-transparent text-white-500 rounded top-0 right-40 z-10 m-2">
                    <p className="hover:scale-105 duration-200 text-xl">{"<"}</p>
                </button>
                <h4 className='font-bold text-xl mt-10 border-b border-gray-300'>Mujer</h4>

                <button className="flex justify-between">
                    <a href="/mujer/camisetas">Camisetas</a>
                </button>

                <button className="flex justify-between">
                    <a href="/mujer/sudaderas">Sudaderas</a>
                </button>

                <button className="flex justify-between">
                    <a href="/mujer/zapatos">Zapatos</a>
                </button>

                <button className="flex justify-between">
                    <a href="/mujer/accesorios">Accesorios</a>
                </button>
            </div>
            */}
        </div>
    )
}
