export async function onRequestPost(context) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = context.env;

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
    const events = Array.isArray(body) ? body : [body];

    if (events.length === 0 || events.length > 20) {
      return new Response(JSON.stringify({ error: 'Invalid batch size' }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Get geo info from CF headers
    const country = context.request.headers.get('cf-ipcountry') || null;
    const city = context.request.cf?.city || null;
    const region = context.request.cf?.region || null;
    const ua = context.request.headers.get('user-agent') || null;

    const rows = events.map(e => ({
      page: (e.page || '').slice(0, 200),
      event: (e.event || 'pageview').slice(0, 50),
      source: (e.source || null)?.slice(0, 100),
      fbclid: (e.fbclid || null)?.slice(0, 200),
      utm_source: (e.utm_source || null)?.slice(0, 100),
      utm_medium: (e.utm_medium || null)?.slice(0, 100),
      utm_campaign: (e.utm_campaign || null)?.slice(0, 200),
      utm_content: (e.utm_content || null)?.slice(0, 200),
      referrer: (e.referrer || null)?.slice(0, 500),
      user_agent: ua?.slice(0, 500),
      ip_country: country,
      ip_city: city,
      ip_region: region,
      session_id: (e.session_id || null)?.slice(0, 64),
      scroll_depth: typeof e.scroll_depth === 'number' ? Math.min(e.scroll_depth, 100) : null,
      time_on_page: typeof e.time_on_page === 'number' ? Math.min(e.time_on_page, 86400) : null,
      device_type: (e.device_type || null)?.slice(0, 20),
      screen_width: typeof e.screen_width === 'number' ? e.screen_width : null,
      metadata: e.metadata || {},
    }));

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'Not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/page_analytics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(rows),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Track insert error:', err);
      return new Response(JSON.stringify({ error: 'Insert failed' }), {
        status: 500, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true, count: rows.length }), {
      status: 200, headers: corsHeaders,
    });

  } catch (err) {
    console.error('Track error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  const allowed = origin.includes('cleanenergyexperts.pro') || origin.includes('localhost');
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowed ? origin : 'https://cleanenergyexperts.pro',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
