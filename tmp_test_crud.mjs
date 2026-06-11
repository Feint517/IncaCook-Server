import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv('.env');
const API = 'http://127.0.0.1:3000';
const SUB = '00000000-0000-0000-0000-000000000003';
const LISTING = '01KST9J9G8R9QMJAR9HX671S5D';
const token = jwt.sign(
  { sub: SUB, email: 'test+seller@incacook.test', role: 'SELLER', aud: 'authenticated' },
  env.SUPABASE_JWT_SECRET,
  { expiresIn: '1h' },
);
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
}

let r;

console.log('=== 1) GET /v1/sellers/me/listings (each seller\'s own products) ===');
r = await call('GET', '/v1/sellers/me/listings');
const before = r.data?.data ?? [];
console.log('  status', r.status, '| count', before.length, '| has test listing?', before.some((l) => l.id === LISTING));

console.log('\n=== 2) PATCH /v1/listings/:id (edit product) ===');
r = await call('PATCH', `/v1/listings/${LISTING}`, { name: 'EDITED — Couscous Maison', priceCents: 420 });
console.log('  status', r.status, '| name=', r.data?.data?.name, '| priceCents=', r.data?.data?.priceCents);

console.log('\n=== verify edit via GET /v1/listings/:id ===');
r = await call('GET', `/v1/listings/${LISTING}`);
console.log('  status', r.status, '| name=', r.data?.data?.name, '| priceCents=', r.data?.data?.priceCents);

console.log('\n=== 3) DELETE /v1/listings/:id (delete product) ===');
r = await call('DELETE', `/v1/listings/${LISTING}`);
console.log('  status', r.status, '(204 = success, soft delete)');

console.log('\n=== verify delete: GET /v1/sellers/me/listings again ===');
r = await call('GET', '/v1/sellers/me/listings');
const after = r.data?.data ?? [];
console.log('  status', r.status, '| count', after.length, '| still has deleted listing?', after.some((l) => l.id === LISTING));

console.log('\n=== verify delete: GET /v1/listings/:id (public) ===');
r = await call('GET', `/v1/listings/${LISTING}`);
console.log('  status', r.status, '(404 = correctly hidden after delete)');
