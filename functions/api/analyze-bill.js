export async function onRequestPost(context) {
  // Key stored as Cloudflare Pages environment variable (set in dashboard)
  const OPENROUTER_KEY = context.env.OPENROUTER_KEY;

  if (!OPENROUTER_KEY) {
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
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify(body),
    });
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
