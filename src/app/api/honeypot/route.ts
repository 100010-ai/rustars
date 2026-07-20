/**
 * Honeypot endpoint — invisible trap for bots and scanners.
 *
 * This endpoint is linked via a hidden element in the page.
 * Legitimate users won't click it (it's invisible), but bots will.
 * Any request to this endpoint is logged and the IP is blocked.
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const userAgent = request.headers.get('user-agent') || '';
  const referer = request.headers.get('referer') || '';
  const timestamp = new Date().toISOString();

  // Log the honeypot trigger
  console.warn(`[Honeypot] TRIGGERED — IP: ${ip}, UA: ${userAgent.slice(0, 100)}, Referer: ${referer.slice(0, 100)}`);

  // Try to store in database for analysis
  try {
    const sb = getSupabase();
    await sb.from('tma_audit_log').insert({
      order_id: 'honeypot',
      username: `bot_${ip}`,
      to_address: 'honeypot',
      amount_ton: 0,
      payload: `UA: ${userAgent.slice(0, 128)} | Ref: ${referer.slice(0, 128)}`,
      tx_hash: null,
      status: 'blocked',
      reason: `Honeypot triggered at ${timestamp}`,
    });
  } catch {
    // Database logging failed — continue silently
  }

  // Return a fake "success" to make the bot think it worked
  return NextResponse.json({ ok: true, message: 'Operation completed' });
}

export async function POST(request: Request) {
  return GET(request);
}
