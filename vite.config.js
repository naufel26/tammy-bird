import { defineConfig, loadEnv } from 'vite';

// Runs the Vercel functions in /api during `npm run dev`. In production Vercel serves them itself.
function vercelApiDev() {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url.split('?')[0];
        if (!/^\/api\/[\w-]+$/.test(path)) return next();
        try {
          const mod = await server.ssrLoadModule(`${path}.js`);
          const handler = mod[req.method];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }

          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const hasBody = !['GET', 'HEAD'].includes(req.method);
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers,
            body: hasBody ? Buffer.concat(chunks) : undefined,
          });

          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

// Share-card images need an absolute URL; Vercel provides the production domain at build time
function siteUrl() {
  return {
    name: 'site-url',
    transformIndexHtml(html) {
      const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
      return html.replaceAll('%SITE_URL%', domain ? `https://${domain}` : '');
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env / .env.local (e.g. from `vercel env pull`) visible to the API functions in dev
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [vercelApiDev(), siteUrl()] };
});
