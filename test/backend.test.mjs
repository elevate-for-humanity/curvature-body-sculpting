import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBackend} from '../src/backend.mjs';
const catalog = JSON.parse(await readFile(new URL('../content/catalog.json',import.meta.url),'utf8'));
const key = '11111111-1111-4111-8111-111111111111';
const env = {SUPABASE_URL:'https://curvaturetest.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',ALLOWED_ORIGINS:'https://curvature.example',CURVATURE_ADMIN_USER_IDS:'owner'};
function fixture() {
  const rows = new Map(); let failure = false; let calls = 0;
  const backend = createBackend({env,catalog,fetchImpl:async (url,options={}) => {
    calls++;
    if (failure) return new Response('storage down',{status:500});
    if (url.endsWith('/auth/v1/user')) return Response.json({id:options.headers.Authorization === 'Bearer owner-token' ? 'owner' : 'stranger'});
    if (options.method === 'POST') {
      const row = JSON.parse(options.body);
      if (rows.has(row.idempotency_key)) return Response.json([]);
      const saved = {...row,id:'saved-request',status:'pending'};
      rows.set(row.idempotency_key,saved); return Response.json([saved]);
    }
    const parsed = new URL(url);
    const id = parsed.searchParams.get('idempotency_key')?.slice(3);
    return Response.json(id ? [rows.get(id)].filter(Boolean) : [...rows.values()]);
  }});
  return {backend,rows,fail:()=>{failure=true;},calls:()=>calls};
}
const contact = {name:'Client',email:'client@example.com',message:'Please call me'};
const request = (path,body=contact,headers={}) => new Request(`https://curvature.example${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://curvature.example','Idempotency-Key':key,...headers},body:JSON.stringify(body)});
test('contact is persisted before success and returns no personal details',async()=>{
  const f=fixture();const r=await f.backend(request('/api/curvature/contact'));assert.equal(r.status,201);assert.equal(f.rows.size,1);const body=await r.json();assert.equal(body.id,'saved-request');assert.equal(body.email,undefined);
});
test('retries do not duplicate submissions, conflicting body rejected',async()=>{
  const f=fixture();await f.backend(request('/api/curvature/contact'));assert.equal((await f.backend(request('/api/curvature/contact'))).status,200);assert.equal(f.rows.size,1);assert.equal((await f.backend(request('/api/curvature/contact',{...contact,message:'different'}))).status,409);
});
test('storage failure never reports success',async()=>{const f=fixture();f.fail();assert.equal((await f.backend(request('/api/curvature/contact'))).status,503);});
test('invalid email rejected before storage',async()=>{const f=fixture();assert.equal((await f.backend(request('/api/curvature/contact',{...contact,email:'bad'}))).status,400);assert.equal(f.calls(),0);});
test('unknown services, impossible dates and unknown application roles rejected',async()=>{
  const f=fixture();for(const body of [{service_id:'bad',preferred_date:'2099-01-01',preferred_time:'10:00'},{service_id:catalog.services[0].id,preferred_date:'2099-02-30',preferred_time:'10:00'}]) assert.equal((await f.backend(request('/api/curvature/appointments',{...contact,phone:'3175550100',...body}))).status,400);
  assert.equal((await f.backend(request('/api/curvature/applications',{...contact,role_id:'bad'}))).status,400);assert.equal(f.rows.size,0);
});
test('booking remains pending and application saves real record',async()=>{
  const f=fixture();const r=await f.backend(request('/api/curvature/appointments',{...contact,phone:'3175550100',service_id:catalog.services[0].id,preferred_date:'2099-01-01',preferred_time:'10:00'}));assert.equal(r.status,201);assert.equal((await r.json()).status,'pending');
  assert.equal((await f.backend(request('/api/curvature/applications',{...contact,role_id:catalog.roles[0].id},{'Idempotency-Key':'22222222-2222-4222-8222-222222222222'}))).status,201);assert.equal(f.rows.size,2);
});
test('invoice price tampering ignored; payment stays unpaid',async()=>{
  const f=fixture();const r=await f.backend(request('/api/curvature/invoice-requests',{...contact,items:[{product_id:catalog.products[0].id,quantity:2,price:0.01}],total:0.02,payment_status:'paid'}));assert.equal(r.status,201);const payload=[...f.rows.values()][0].payload;assert.equal(payload.subtotal_cents,4998);assert.equal(payload.payment_status,'unpaid');
});
test('nested invoice change with same key rejected',async()=>{
  const f=fixture();for(const [quantity,status] of [[1,201],[2,409]]) assert.equal((await f.backend(request('/api/curvature/invoice-requests',{...contact,items:[{product_id:catalog.products[0].id,quantity}]}))).status,status);
});
test('invalid quantity and legacy products rejected',async()=>{
  const f=fixture();for(const item of [{product_id:catalog.products[0].id,quantity:-1},{product_id:'legacy-tea',quantity:1}]) assert.equal((await f.backend(request('/api/curvature/invoice-requests',{...contact,items:[item]}))).status,400);
});
test('admin requires verified user and explicit owner permission',async()=>{
  const f=fixture();for(const [token,status] of [[null,401],['stranger-token',403],['owner-token',200]]) {const r=await f.backend(new Request('https://curvature.example/api/admin/curvature/requests',{headers:token ? {Authorization:`Bearer ${token}`} : {}}));assert.equal(r.status,status);}
});
test('disallowed browser origin blocked',async()=>{const f=fixture();assert.equal((await f.backend(request('/api/curvature/contact',contact,{Origin:'https://evil.example'}))).status,403);assert.equal(f.calls(),0);});
test('refuses LMS database configuration',async()=>{const backend=createBackend({env:{...env,SUPABASE_URL:'https://cuxzzpsyufcewtmicszk.supabase.co'},catalog});assert.equal((await backend(request('/api/curvature/contact'))).status,503);});
