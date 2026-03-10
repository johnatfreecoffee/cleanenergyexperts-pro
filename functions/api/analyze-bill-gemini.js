export async function onRequestPost(context) {
  // Key stored as Cloudflare Pages environment variable (set in dashboard)
  const GEMINI_KEY = context.env.GEMINI_KEY;

  if (!GEMINI_KEY) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const origin = context.request.headers.get('Origin') || '';
  const allowed = origin.includes('cleanenergyexperts.pro') || origin.includes('localhost');
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://cleanenergyexperts.pro',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await context.request.json();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await res.text();
    return new Response(data, { status: res.status, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://cleanenergyexperts.pro',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
