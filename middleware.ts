import { NextRequest, NextResponse } from 'next/server';

const LOGWATCH_URL = 'https://logwatch-vercel.vercel.app/api/logdrain';
const LOGWATCH_SECRET = '66ea68d611503404a64424d022f3b4cb';

export async function middleware(req: NextRequest) {
  // Fire-and-forget — never block the request
  const event = JSON.stringify({
    source: 'request',
    timestamp: Date.now(),
    host: req.headers.get('host') || '',
    path: req.nextUrl.pathname,
    method: req.method,
    statusCode: 200,
    clientIp:
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '0.0.0.0',
    userAgent: req.headers.get('user-agent') || '',
    referer: req.headers.get('referer') || '',
    'x-vercel-ip-country': req.headers.get('x-vercel-ip-country') || 'XX',
  });

  fetch(LOGWATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vercel-verify': LOGWATCH_SECRET,
    },
    body: event,
  }).catch(() => {});

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except internal Next.js and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico).*)',
  ],
};
