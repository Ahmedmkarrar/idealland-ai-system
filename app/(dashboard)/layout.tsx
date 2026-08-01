"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  FileText,
  Megaphone,
  Mail,
  LayoutDashboard,
  Receipt,
  Zap,
  AlertTriangle,
  Home,
  Menu,
  X,
  TrendingUp,
  Sparkles,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/ready", label: "Ready to Send", icon: Send },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
  { href: "/roi", label: "ROI", icon: TrendingUp },
  { href: "/sourcing", label: "Sourcing", icon: Building2 },
  { href: "/hmo", label: "HMO Acquisition", icon: Home },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/social", label: "Social Content", icon: Megaphone },
  { href: "/mailing", label: "Mailing", icon: Mail },
  { href: "/invoicing", label: "Invoicing", icon: Receipt },
  { href: "/errors", label: "Error Log", icon: AlertTriangle },
];

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <Zap className="w-4 h-4 text-primary-foreground" />
      </div>
      <div>
        <p className="font-semibold text-sm">IdealLand</p>
        <p className="text-xs text-muted-foreground">Automation Hub</p>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Below md the sidebar is a drawer: at 256px wide it would otherwise leave
  // roughly 55px of usable content on a 375px phone.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  return (
    <div className="flex min-h-screen bg-background">
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "bg-card border-r flex flex-col w-64 shrink-0",
          // Drawer on mobile, ordinary column from md up.
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200",
          "md:static md:z-auto md:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-6 border-b flex items-center justify-between gap-2">
          <Brand />
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            className="md:hidden text-muted-foreground hover:text-foreground"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              // Choosing a destination dismisses the drawer; otherwise it stays
              // open over the page the user just asked for.
              onClick={() => setNavOpen(false)}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                pathname === href
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t">
          <p className="text-xs text-muted-foreground text-center">
            All automations active
          </p>
          <div className="flex justify-center mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          </div>
        </div>
      </aside>

      {/* min-w-0 stops long content (tables, refs) forcing the flex child wider
          than the viewport, which would let the whole page scroll sideways. */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 border-b bg-card p-4">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open navigation"
            aria-expanded={navOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
          <Brand />
        </header>
        <main className="flex-1 overflow-auto min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
