import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/AuthContext";

export default function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-white">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link to="/" className="font-semibold tracking-tight text-ink">
            AppQuantive
          </Link>
          {me && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-ink-soft">{me.email}</span>
              <button
                type="button"
                onClick={logout}
                className="text-ink-soft hover:text-ink transition-colors"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
