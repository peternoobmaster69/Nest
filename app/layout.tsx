import "./globals.css"; // Ensure stylesheet import
export default async function RootLayout({ children }: { children: React.ReactNode; }) { 
    return (
        <html lang="en">
            <body>
                {children}
            </body>
        </html>
    );
}