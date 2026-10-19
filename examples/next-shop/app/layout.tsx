import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'better-payment shop',
  description: 'Example shop built with better-payment, Next.js and Prisma',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bar">
          <a className="brand" href="/">
            better-payment shop
          </a>
          <nav>
            <a href="/cart">Cart</a>
            <a href="/admin">Admin</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="note">
          Example app — uses <code>MockProvider</code> by default, so no credentials and no real
          money. <a href="https://github.com/czaydev/better-payment">better-payment</a>
        </footer>
      </body>
    </html>
  );
}
