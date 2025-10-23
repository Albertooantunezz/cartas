import ProductList from "../features/products/ProductList";
import React from "react";
import Navbar from "../components/Navbar";
import Opinion from "../components/Opinion";


export default function Home() {
  return (
    <div className="relative top-0 w-full flex  flex-col items-center justify-center">

      <div className="relative">
        <img src="/banner.jpg" alt="Banner Home" className="w-2000 h-140 object-cover opacity-70" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white  w-full  text-center">
          <h2 className="text-3xl font-bold">¡Compra tu mazo!</h2>
          <button className="bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600 mt-5 w-50"> <a href="/ofertas">Mazos</a></button>
        </div>
      </div>
      <div className="text-center bg-red-100 w-full p-10 shadow-lg text-black md:px-20 lg:px-60">
        <h2 className="text-2xl font-bold ">Bienvenido a la tienda</h2>
        <span className="w-full bg-red-500 h-1 block mt-5 rounded-xl"></span>
        <p className="lg:text-xl mt-10">Lorem ipsum dolor sit amet consectetur adipisicing elit. Provident pariatur iure officia alias quam impedit excepturi qui necessitatibus. Accusantium magni quasi rem voluptates provident repellat iste commodi laborum? Obcaecati, maxime!</p>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-4 mt-10">
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">2€</h3>
            <p>Una sola carta</p>
          </div>
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">1.5€</h3>
            <p>+10 cartas</p>
          </div>
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">1€</h3>
            <p>+50 cartas</p>
          </div>
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">0.5€</h3>
            <p>+100 cartas</p>
          </div>
        </div>
        <button className="text-xl bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600 mt-10 w-50"> <a href="/catalogo">Catálogo</a></button>

        <Opinion />
      </div>
    </div >
  );
}
