// Import from the website's forms. Retain requestKey when retrying a failed send.
// A form must show success only after this promise resolves.
export async function submitRequest({baseUrl = '',kind,payload,requestKey = crypto.randomUUID(),fetchImpl = fetch}) {
  const endpoints = {contact:'contact',appointment:'appointments',application:'applications',invoice:'invoice-requests'};
  if (!endpoints[kind]) throw new Error('Invalid request type');
  const response = await fetchImpl(`${baseUrl}/api/curvature/${endpoints[kind]}`, {
    method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || typeof result.id !== 'string') throw new Error(result.error || 'Your request could not be saved. Please retry.');
  return result;
}
