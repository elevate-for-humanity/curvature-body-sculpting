import { submitRequest } from '/assets/client.mjs';
const params = new URLSearchParams(location.search);
for(const [query,name] of [['service','service_id'],['role','role_id']]){
 const input=document.querySelector(`[name="${name}"]`);if(input&&Array.from(input.options).some(o=>o.value===params.get(query)))input.value=params.get(query);
}
for(const form of document.querySelectorAll('form[data-request-kind]')){
 let requestKey=null,previous='';
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const button=form.querySelector('button'),status=form.querySelector('[role=status]');
  const payload=Object.fromEntries(new FormData(form)),kind=form.dataset.requestKind;
  if(kind==='invoice'){
   payload.items=Object.entries(payload).filter(([key,value])=>key.startsWith('quantity:')&&Number(value)>0).map(([key,value])=>({product_id:key.slice(9),quantity:Number(value)}));
   for(const key of Object.keys(payload))if(key.startsWith('quantity:'))delete payload[key];
   if(!payload.items.length){status.textContent='Select at least one product quantity.';return;}
  }
  const current=JSON.stringify(payload);if(current!==previous){requestKey=crypto.randomUUID();previous=current;}
  button.disabled=true;status.textContent='Saving your request…';
  try{const result=await submitRequest({kind,payload,requestKey});status.textContent=`${result.message} Reference: ${result.id}`;form.reset();requestKey=null;previous='';}
  catch(error){status.textContent=error.message||'Unable to save. Please retry.';}
  finally{button.disabled=false;}
 });
}
