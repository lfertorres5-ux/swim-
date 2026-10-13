// Mounts PostgREST under /rest/v1 like Supabase's API gateway, so supabase-js works unchanged.
import http from "node:http";

const upstream = Number(process.env.PGRST_PORT ?? 54331);
const port = Number(process.env.PROXY_PORT ?? 54330);

http
  .createServer((req, res) => {
    const path = req.url.replace(/^\/rest\/v1/, "") || "/";
    const p = http.request({ host: "127.0.0.1", port: upstream, path, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    p.on("error", (err) => {
      res.writeHead(502);
      res.end(String(err));
    });
    req.pipe(p);
  })
  .listen(port, "127.0.0.1", () => console.log(`proxy :${port} → postgrest :${upstream}`));
