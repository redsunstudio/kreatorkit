import { NextResponse } from 'next/server';
import { buildContentSecurityPolicy } from '@/lib/content-security-policy';

export function proxy() {
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy());
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
