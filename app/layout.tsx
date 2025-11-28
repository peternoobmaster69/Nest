import "./globals.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";   
import Header from "../components/Header";  
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/dist/client/components/navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "SaveTogether",
    description: "A modern financial app for modern households.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {

    const user = await getCurrentUser();

    return (
        <html lang="en">
            <body className={`${inter.className} app-body`}>
                <div className="app-surface">
                    <div className="app-surface__glow" aria-hidden="true" />
                    <div className="app-surface__grid" aria-hidden="true" />
                        
                    <main className="app-main">
                        <Header user={user} />
                        {children}
                    </main>
                </div>
            </body>
        </html>
    );
}
