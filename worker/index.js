export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assetUrl = new URL(request.url);

    // Keep /index.html canonical without exposing a redirect to Safari.
    if (assetUrl.pathname.endsWith('/index.html')) {
      assetUrl.pathname = assetUrl.pathname.slice(0, -'index.html'.length);
    }

    let response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (response.redirected) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin === url.origin) {
        response = await env.ASSETS.fetch(new Request(finalUrl, request));
      }
    }

    const headers = new Headers(response.headers);
    if (url.pathname.endsWith('/sw.js')) {
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
