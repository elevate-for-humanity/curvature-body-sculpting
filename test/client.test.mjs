import test from 'node:test';
import assert from 'node:assert/strict';
import {submitRequest} from '../src/client.mjs';
test('form adapter rejects server failure instead of presenting success',async()=>{
  await assert.rejects(submitRequest({kind:'application',payload:{},fetchImpl:async()=>Response.json({error:'Storage unavailable'},{status:503})}),/Storage unavailable/);
});
test('form adapter keeps retry key and awaits saved ID',async()=>{
  const key='11111111-1111-4111-8111-111111111111';
  const result=await submitRequest({kind:'appointment',payload:{name:'Test'},requestKey:key,fetchImpl:async(url,options)=>{
    assert.equal(url,'/api/curvature/appointments');assert.equal(options.headers['Idempotency-Key'],key);return Response.json({id:'persisted-id',status:'pending'},{status:201});
  }});
  assert.equal(result.id,'persisted-id');
});
