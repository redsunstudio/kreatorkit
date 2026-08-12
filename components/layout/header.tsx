'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import {
  Video,
  Settings,
  LogOut,
  User,
  Menu,
  Keyboard,
  LayoutDashboard,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme-toggle';
import { CreatedByInline } from '@/components/created-by';
import { cn } from '@/lib/utils';

const KeyboardShortcutsModal = dynamic(
  () => import('@/components/keyboard-shortcuts-modal').then((mod) => mod.KeyboardShortcutsModal),
  { ssr: false }
);

const SearchModal = dynamic(
  () => import('@/components/search-modal').then((mod) => mod.SearchModal),
  { ssr: false }
);

const navItems: { href: string; label: string; emoji: string }[] = [
  { href: '/workspaces', label: 'Workspaces', emoji: '🗂️' },
];

interface HeaderProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    isAdmin?: boolean;
  } | null;
  showAppNavigation?: boolean;
}

export function Header({ user, showAppNavigation = false }: HeaderProps) {
  const pathname = usePathname();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        if (!user || !showAppNavigation) {
          return;
        }

        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showAppNavigation, user]);

  // Hide header on video player pages — they use full viewport with their own back button
  const isVideoPage =
    /\/videos\/[^/]+($|\/compare)/.test(pathname) || pathname.startsWith('/watch/');
  if (isVideoPage) return null;

  return (
    <header className="sticky top-0 z-[60] w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="px-4 md:px-6 lg:px-8 flex h-14 items-center w-full">
        {/* Mobile menu */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden mr-2">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Access your projects and workspaces
            </SheetDescription>
            <nav className="flex flex-col gap-2 mt-10">
              {showAppNavigation &&
                navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                      pathname === item.href
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <span className="text-base leading-none">{item.emoji}</span>
                    {item.label}
                  </Link>
                ))}
              {user?.isAdmin && (
                <Link
                  href="/admin"
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                    pathname.startsWith('/admin')
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <span className="text-base leading-none">🛠️</span>
                  Admin
                </Link>
              )}
            </nav>
          </SheetContent>
        </Sheet>

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-3">
          <Video className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg hidden sm:inline-block">KreatorKit</span>
        </Link>
        <CreatedByInline className="hidden lg:inline-block mr-6 text-[11px]" />

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {showAppNavigation &&
            navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                  pathname === item.href ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                <span className="text-base leading-none">{item.emoji}</span>
                {item.label}
              </Link>
            ))}
          {user?.isAdmin && (
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
            >
              <span className="text-base leading-none">🛠️</span>
              Admin
            </Link>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 ml-auto">
          {user && showAppNavigation && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Search"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex items-center gap-1.5">
                  <span>Search</span>
                  <kbd className="inline-flex h-5 items-center rounded border border-background/30 bg-background/20 px-1 font-mono text-[10px] text-background">
                    Ctrl K
                  </kbd>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <ThemeToggle />

          {user ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.image ?? undefined} alt={user.name ?? ''} />
                    <AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? 'U'}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={10}
                className="w-64 min-w-64 rounded-md border bg-popover/98 p-1 shadow-2xl backdrop-blur-md"
              >
                <div className="rounded-sm px-3 py-2.5">
                  <div className="flex flex-col space-y-1 leading-none">
                    {user.name && <p className="font-medium">{user.name}</p>}
                    {user.email && (
                      <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                    )}
                  </div>
                </div>
                <DropdownMenuSeparator />
                {user.isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin">
                      <LayoutDashboard className="h-4 w-4 mr-2" />
                      Admin Panel
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
                  <Keyboard className="h-4 w-4 mr-2" />
                  Shortcuts
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/signout">
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign out
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/login">
                <User className="h-4 w-4 mr-1" />
                Sign in
              </Link>
            </Button>
          )}
        </div>
      </div>
      <KeyboardShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {user && showAppNavigation && <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />}
    </header>
  );
}
