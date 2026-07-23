#!/usr/bin/env node
/**
 * create-lead.mjs — create a HelloBill lead (Partner API "session") headlessly.
 *
 * No embed, no browser, no frontend SDK. One server-side call:
 * @hello-bill/node handles OAuth2 client-credentials, token caching, retries
 * and idempotency, then POSTs /partner/sessions. The response's session_token
 * and embed_base_url are only needed by the embed — we ignore them.
 *
 * Usage:
 *   node create-lead.mjs examples/lead-minimal.json
 *   node create-lead.mjs payload.json --dry-run     # validate + print, send nothing
 *
 * Config — .env next to this script, or real env vars:
 *   HELLOBILL_CLIENT_ID      sb_… (sandbox) | live_… (production)
 *   HELLOBILL_CLIENT_SECRET
 *   HELLOBILL_API_BASE_URL   optional; defaults to https://partnerapi.hellobill.app/api/v1
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HelloBillPartner, HellobillApiError } from '@hello-bill/node';

const HERE = dirname(fileURLToPath(import.meta.url));

// The package's own default host (api.hellobill.app) is stale and does not
// resolve — always point at partnerapi.hellobill.app unless overridden.
const DEFAULT_BASE_URL = 'https://partnerapi.hellobill.app/api/v1';

// ---- tiny .env loader (no dependency) --------------------------------------
const envFile = join(HERE, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node create-lead.mjs <payload.json> [--dry-run]');
  process.exit(1);
}

// ---- load + validate payload (canonical snake_case SessionPayload) ---------
const payload = JSON.parse(readFileSync(file, 'utf8'));

// Convenience: if the lead is opted in but no timestamp was supplied, stamp now.
if (payload.consent?.data_sharing_accepted === true && !payload.consent.data_sharing_accepted_at) {
  payload.consent.data_sharing_accepted_at = new Date().toISOString();
}

const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };
need(payload.customer?.email, 'customer.email is required');
need(payload.customer?.first_name, 'customer.first_name is required (live API validation — full_legal_name does not substitute)');
need(payload.customer?.title, "customer.title is required — 'mr'|'mrs'|'miss'|'ms'|'mx'|'dr'|'other'");
need(payload.customer?.type, "customer.type is required — 'tenant' for agency-sourced leads");
need(payload.addresses?.current?.address_line_1, 'addresses.current.address_line_1 is required');
need(payload.addresses?.current?.city, 'addresses.current.city is required');
need(payload.addresses?.current?.postcode, 'addresses.current.postcode is required');
need(payload.move?.in?.move_in_date, 'move.in.move_in_date is required (YYYY-MM-DD)');
need(payload.consent?.data_sharing_accepted === true,
  'consent.data_sharing_accepted must be true — only send leads who opted in');
if (problems.length) {
  console.error('Payload invalid:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n--dry-run: payload valid, nothing sent.');
  process.exit(0);
}

// ---- send ------------------------------------------------------------------
const { HELLOBILL_CLIENT_ID, HELLOBILL_CLIENT_SECRET } = process.env;
if (!HELLOBILL_CLIENT_ID || !HELLOBILL_CLIENT_SECRET) {
  console.error('Missing HELLOBILL_CLIENT_ID / HELLOBILL_CLIENT_SECRET — see .env.example');
  process.exit(1);
}

const partner = new HelloBillPartner({
  clientId: HELLOBILL_CLIENT_ID,
  clientSecret: HELLOBILL_CLIENT_SECRET,
  apiBaseUrl: process.env.HELLOBILL_API_BASE_URL ?? DEFAULT_BASE_URL,
});

try {
  const res = await partner.sessions.create(payload);
  console.log('Lead created in Bill OS');
  console.log(`  session_id  : ${res.session_id}`);
  console.log(`  referral_id : ${payload.referral_id ?? '(none sent)'}`);
  console.log(`  provided    : ${res.provided_fields.length} fields received`);
  console.log(`  expires_at  : ${res.expires_at}`);
  console.log('\nVerify with: node list-leads.mjs --email ' + payload.customer.email);
} catch (err) {
  if (err instanceof HellobillApiError) {
    console.error(`API error ${err.status}${err.code ? ` [${err.code}]` : ''}: ${err.message}`);
    if (err.envelope) console.error('  ' + JSON.stringify(err.envelope));
    if (err.requestId) console.error(`  request_id: ${err.requestId}`);
    process.exit(2);
  }
  throw err;
}
