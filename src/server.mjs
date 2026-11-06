import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createBackend } from './backend.mjs';
import { renderWebsite } from './website.mjs';
const draft = JSON.parse(await readFile(new URL('../content/combined-site-draft.json', import.meta.url),'utf8'));
const assets = new Map(await Promise.all([['/assets/site.css','site.css','text/css'],['/assets/forms.mjs','forms.mjs','text/javascript'],['/assets/client.mjs','client.mjs','text/javascript']].map(async ([url,file,type]) => [url,{body:await readFile(new URL(file,import.meta.url)),type}])));

const catalog = JSON.parse(await readFile(new URL('../content/catalog.json', import.meta.url),'utf8'));
const backend = createBackend({env:process.env,catalog});
createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (['GET','HEAD'].includes(req.method) && !url.pathname.startsWith('/api/') && !['/healthz','/readyz'].includes(url.pathname)) {
      const asset=assets.get(url.pathname);
      const html=asset ? null : renderWebsite(url.pathname,draft,catalog);
      const headers={'Content-Type':asset?asset.type:'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://www.elevateforhumanity.org https://cdn.shopify.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};
      res.writeHead(asset||html?200:404,headers);res.end(req.method==='HEAD'?'':asset?.body||html||'Page not found');return;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 16384) { res.writeHead(413,{'Content-Type':'application/json'}); res.end('{"error":"Request too large"}'); return; }
      chunks.push(chunk);
    }
    // Fixed internal origin: never trust forwarded host when handling credentials.
    const request = new Request(`http://localhost${req.url}`, {method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method) ? {body:Buffer.concat(chunks)} : {})});
    const response = await backend(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(400,{'Content-Type':'application/json'}); res.end('{"error":"Invalid request"}'); }
}).listen(Number(process.env.PORT || 8080),'0.0.0.0');
