import "./globals.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "SaveTogether | Collaborative finance that feels modern",
    description: "A modern, readable SaveTogether experience with clear calls-to-action and fintech-inspired styling.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className={`${inter.className} app-body`}>
                <div className="app-surface">
                    <div className="app-surface__glow" aria-hidden="true" />
                    <div className="app-surface__grid" aria-hidden="true" />
                    <header className="app-header">
                        <div className="brand-mark">
                            <div className="brand-icon" aria-hidden="true" />
                            <div>
                                <p className="brand-name">SaveTogether</p>
                                <p className="brand-sub">Clarity for collaborative finances</p>
                            </div>
                        </div>
                        <div className="badge-soft">Live product preview</div>
                    </header>
                    <main className="app-main">{children}</main>
                    <footer className="app-footer">
                        <p className="text-muted">Built for teams who want trust, transparency, and effortless growth.</p>
                        <div className="footer-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </div>
                    </footer>
                </div>
            </body>
        </html>
    );
}
