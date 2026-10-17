import { createHash } from 'node:crypto';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = (value, name, max = 2000, required = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return value.trim();
};
export function validate(kind, body, catalog) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request');
  const result = {
    name: fields(body.name, 'name', 120),
    email: fields(body.email, 'email', 254).toLowerCase(),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new HttpError(400, 'Invalid email');
  if (body.phone !== undefined) result.phone = fields(body.phone, 'phone', 40, false);
  if (body.message !== undefined) result.message = fields(body.message, 'message', 4000, false);
  if (kind === 'contact') result.message = fields(body.message, 'message', 4000);
  if (kind === 'appointment') {
    // This records a request, not a confirmed slot or medical assessment.
    const service = catalog.services.find(item => item.id === body.service_id);
    if (!service) throw new HttpError(400, 'Invalid service');
    result.service_id = service.id;
    result.service_name = service.name;
    result.phone = fields(body.phone, 'phone', 40);
    const date = fields(body.preferred_date, 'preferred date', 10);
    const time = fields(body.preferred_time, 'preferred time', 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Invalid date or time');
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if (date < today) throw new HttpError(400, 'Preferred date must not be in the past');
    result.preferred_date = date;
    result.preferred_time = time;
    result.time_zone = 'America/Indiana/Indianapolis';
  }
  if (kind === 'application') {
    const role = catalog.roles.find(item => item.id === body.role_id);
    if (!role) throw new HttpError(400, 'Invalid role');
    result.role_id = role.id;
    result.role_title = role.title;
    result.message = fields(body.message, 'experience', 4000);
  }
  if (kind === 'invoice') {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) throw new HttpError(400, 'Invalid items');
    const ids = new Set();
    result.items = body.items.map(item => {
      const product = catalog.products.find(p => p.id === item?.product_id && p.active);
      if (!product || ids.has(product.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new HttpError(400, 'Invalid item');
      ids.add(product.id);
      return { product_id: product.id, name: product.name, quantity: item.quantity, unit_price_cents: product.price_cents };
    });
    result.subtotal_cents = result.items.reduce((sum,item) => sum + item.quantity * item.unit_price_cents, 0);
    result.currency = 'USD';
    result.payment_status = 'unpaid';
    // Shipping and tax are determined when staff issues the invoice.
  }
  return result;
}

export function createBackend({ env, catalog, fetchImpl = fetch }) {
  const origins = new Set((env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
  const adminIds = new Set((env.CURVATURE_ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // Fail closed if accidentally pointed at one of the other businesses.
  const forbidden = ['cuxzzpsyufcewtmicszk','jlqrfwxuhpzmuivdxvvz','vhulnzcfmlnsmoxixjco','ebnbeqdsuxygopetptlv'];
  const ready = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base || '') && !!key && !forbidden.some(ref => base.includes(ref));
  const dbHeaders = { apikey: key || '', Authorization: `Bearer ${key || ''}`, 'Content-Type': 'application/json' };
  async function db(path, options = {}) {
    const response = await fetchImpl(`${base}/rest/v1/${path}`, { ...options, headers: {...dbHeaders, ...options.headers}, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new HttpError(503, 'Request storage is unavailable');
    return response.status === 204 ? null : response.json();
  }
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if (origin && origins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    const reply = (status, data) => new Response(JSON.stringify(data), {status, headers});
    try {
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') return reply(200, {alive:true});
      if (origin && !origins.has(origin)) throw new HttpError(403, 'Origin not allowed');
      if (request.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Idempotency-Key';
        return new Response(null, {status:204,headers});
      }
      if (url.pathname === '/api/curvature/services' && request.method === 'GET') return reply(200, {services:catalog.services});
      if (!ready) throw new HttpError(503, 'Curvature backend is not configured');
      if (url.pathname === '/readyz' && request.method === 'GET') {
        await db('curvature_requests?select=id&limit=0');
        return reply(200, {ready:true});
      }
      if (url.pathname.startsWith('/api/admin/curvature/')) {
        const token = request.headers.get('authorization');
        if (!token?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');
        const auth = await fetchImpl(`${base}/auth/v1/user`, {headers:{apikey:key,Authorization:token},signal:AbortSignal.timeout(10000)});
        if (!auth.ok) throw new HttpError(401, 'Invalid session');
        const user = await auth.json();
        if (!adminIds.has(user.id)) throw new HttpError(403, 'Admin access required');
        if (url.pathname === '/api/admin/curvature/requests' && request.method === 'GET') return reply(200, {requests:await db('curvature_requests?select=*&order=created_at.desc&limit=100')});
        const id = url.pathname.match(/^\/api\/admin\/curvature\/requests\/([^/]+)$/)?.[1];
        if (id && uuid.test(id) && request.method === 'PATCH') {
          const body = await request.json();
          if (!['pending','reviewing','closed'].includes(body.status)) throw new HttpError(400,'Invalid status');
          const rows = await db(`curvature_requests?id=eq.${id}&select=id,status`, {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:body.status})});
          if (!rows.length) throw new HttpError(404,'Request not found');
          return reply(200, rows[0]);
        }
        throw new HttpError(404, 'Not found');
      }
      const kind = {'/api/curvature/contact':'contact','/api/curvature/appointments':'appointment','/api/curvature/applications':'application','/api/curvature/invoice-requests':'invoice'}[url.pathname];
      if (!kind || request.method !== 'POST') throw new HttpError(404,'Not found');
      const idempotency = request.headers.get('idempotency-key');
      if (!uuid.test(idempotency || '')) throw new HttpError(400,'A UUID Idempotency-Key is required');
      let body;
      try { body = await request.json(); } catch { throw new HttpError(400,'Invalid JSON'); }
      const payload = validate(kind,body,catalog);
      const rows = await db('curvature_requests?on_conflict=idempotency_key&select=id,kind,payload,status', {
        method:'POST', headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
        body:JSON.stringify({idempotency_key:idempotency,kind,payload}),
      });
      const saved = rows[0] || (await db(`curvature_requests?idempotency_key=eq.${idempotency}&select=id,kind,payload,status`))[0];
      // A key cannot be reused for a different body or endpoint. No private data in responses.
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
      const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
      if (!saved || saved.kind !== kind || digest(saved.payload) !== digest(payload)) throw new HttpError(409,'Idempotency key already used');
      return reply(rows.length ? 201 : 200, {id:saved.id,status:saved.status,message:kind === 'invoice' ? 'Invoice request received. No payment has been taken.' : 'Request received. Staff will follow up; appointments are not confirmed automatically.'});
    } catch (error) {
      return reply(error instanceof HttpError ? error.status : 503, {error:error instanceof HttpError ? error.message : 'Service temporarily unavailable'});
    }
  };
}
