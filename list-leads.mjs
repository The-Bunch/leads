#!/usr/bin/env node
/**
 * list-leads.mjs — list HelloBill leads (Partner API sessions) for verification.
 *
 * Usage:
 *   node list-leads.mjs
 *   node list-leads.mjs --email tenant@example.com
 *   node list-leads.mjs --postcode "SW8 2JB" --status created --limit 10
 *
 * Statuses: created (lead, not converted) | customer_created | expired
 * Config: same .env as create-lead.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HelloBillPartner, HellobillApiError } from '@hello-bill/node';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = 'https://partnerapi.hellobill.app/api/v1';

const envFile = join(HERE, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

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
  const res = await partner.sessions.list({
    email: flag('email'),
    postcode: flag('postcode'),
    status: flag('status'),
    created_after: flag('since'),
    limit: flag('limit') ? Number(flag('limit')) : undefined,
  });
  if (res.sessions.length === 0) {
    console.log('No leads found for that filter.');
  } else {
    for (const s of res.sessions) {
      console.log(
        `${s.session_id}  ${s.status.padEnd(16)}  ${s.email}  ${s.postcode}` +
        `  referral=${s.referral_id ?? '-'}  created=${s.created_at}`,
      );
    }
    if (res.next_cursor) console.log(`\nMore available — next_cursor: ${res.next_cursor}`);
  }
} catch (err) {
  if (err instanceof HellobillApiError) {
    console.error(`API error ${err.status}${err.code ? ` [${err.code}]` : ''}: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
