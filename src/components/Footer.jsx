import React from 'react';

const Footer = () => (
    

<footer className="bg-white shadow-sm dark:bg-red-600">
    <div className="w-full max-w-screen-xl mx-auto p-4 md:py-8">
        <div className="sm:flex sm:items-center sm:justify-between">
            <a href="https://flowbite.com/" className="flex items-center mb-4 sm:mb-0 space-x-3 rtl:space-x-reverse">
                <span className="self-center text-2xl font-bold font-Modak">CARDS</span>
            </a>
            <ul className="flex flex-wrap items-center mb-6 text-sm font-medium sm:mb-0">
                <li>
                    <a href="#" className="hover:underline me-4 md:me-6">About</a>
                </li>
                <li>
                    <a href="#" className="hover:underline me-4 md:me-6">Privacy Policy</a>
                </li>
                <li>
                    <a href="#" className="hover:underline me-4 md:me-6">Licensing</a>
                </li>
                <li>
                    <a href="#" className="hover:underline">Contact</a>
                </li>
            </ul>
        </div>
        <hr className="my-6 border-gray-200 sm:mx-auto dark:border-white-700 lg:my-8" />
        <span className="block text-sm  sm:text-center">© 2025 <a href="" className="hover:underline">Cards</a>. All Rights Reserved.</span>
    </div>
</footer>


);

export default Footer;