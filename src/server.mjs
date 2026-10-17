import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createBackend } from './backend.mjs';
const catalog = JSON.parse(await readFile(new URL('../content/catalog.json', import.meta.url),'utf8'));
const backend = createBackend({env:process.env,catalog});
createServer(async (req,res) => {
  try {
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
