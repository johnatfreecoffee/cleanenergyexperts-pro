export async function onRequestPost(context) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY } = context.env;

  const origin = context.request.headers.get('Origin') || '';
  const allowed = origin.includes('cleanenergyexperts.pro') || origin.includes('virtualpowerplant.us') || origin.includes('localhost');
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://cleanenergyexperts.pro',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await context.request.json();
    const { firstName, lastName, phone, email, streetAddress, city, state, zip, appointmentDate, appointmentTime, source, sourceUrl, fbclid } = body;

    // Validate required fields
    const missing = [];
    if (!firstName?.trim()) missing.push('firstName');
    if (!lastName?.trim()) missing.push('lastName');
    if (!phone?.trim()) missing.push('phone');
    if (!streetAddress?.trim()) missing.push('streetAddress');
    if (!city?.trim()) missing.push('city');
    if (!state?.trim()) missing.push('state');
    if (!zip?.trim() || !/^\d{5}$/.test(zip.trim())) missing.push('zip');
    if (!appointmentDate) missing.push('appointmentDate');
    if (!appointmentTime) missing.push('appointmentTime');

    if (missing.length > 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields', fields: missing }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Phone: ensure +1 prefix
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '+1' + cleanPhone;
    else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) cleanPhone = '+' + cleanPhone;

    // Determine imported_lead_source from source field
    const sourceMap = {
      'limited-spots': 'Meta Ad - Limited Spots',
      'no-cost-powerwall': 'Meta Ad - No Cost Powerwall',
      'your-neighbors': 'Meta Ad - Your Neighbors',
    };
    const importedLeadSource = sourceMap[source] || `Meta Ad - ${source || 'Unknown'}`;

    // Build notes
    const noteParts = [`Appointment: ${appointmentDate} at ${appointmentTime}`];
    if (sourceUrl) noteParts.push(`Source page: ${sourceUrl}`);
    if (fbclid) noteParts.push(`fbclid: ${fbclid}`);
    const notes = noteParts.join(' | ');

    // Insert into Supabase
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const leadPayload = {
      business_id: '2c15a95b-abb3-4f2a-949b-c369b5bda65b',
      area_id: '31fd46cc-a80a-4ae5-ba61-775744ad08dd',
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: cleanPhone,
      email: email?.trim() || null,
      street_address: streetAddress.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      lead_type: 'homeowner',
      source: 'crm',
      imported_lead_source: importedLeadSource,
      sms_status: 'new',
      is_active: 1,
      is_test: false,
      notes: notes,
    };

    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(leadPayload),
    });

    if (!supaRes.ok) {
      const errText = await supaRes.text();
      console.error('Supabase error:', errText);
      return new Response(JSON.stringify({ error: 'Failed to save lead', detail: errText }), {
        status: 500, headers: corsHeaders,
      });
    }

    const inserted = await supaRes.json();
    const leadId = inserted?.[0]?.id || inserted?.id || null;

    // Send confirmation email with ICS if email provided and Resend configured
    if (email?.trim() && RESEND_API_KEY) {
      try {
        // Parse appointment date/time for ICS
        const [year, month, day] = appointmentDate.split('-').map(Number);
        const [hour, minute] = appointmentTime.split(':').map(Number);
        const startDt = new Date(year, month - 1, day, hour, minute);
        const endDt = new Date(startDt.getTime() + 60 * 60 * 1000); // 1 hour

        const pad = (n) => String(n).padStart(2, '0');
        const formatICS = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

        const icsContent = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Clean Energy Experts//Battery Scan//EN',
          'CALSCALE:GREGORIAN',
          'METHOD:REQUEST',
          'BEGIN:VEVENT',
          `DTSTART;TZID=America/Los_Angeles:${formatICS(startDt)}`,
          `DTEND;TZID=America/Los_Angeles:${formatICS(endDt)}`,
          `SUMMARY:Battery Scan Appointment — Clean Energy Experts`,
          `DESCRIPTION:Your free battery scan appointment at ${streetAddress.trim()}\\, ${city.trim()}\\, ${state.trim()} ${zip.trim()}.\\n\\nWe will fly a drone to photograph your roof and inspect your electrical panel to determine qualification for Edison's Virtual Power Plant program.`,
          `LOCATION:${streetAddress.trim()}\\, ${city.trim()}\\, ${state.trim()} ${zip.trim()}`,
          'STATUS:CONFIRMED',
          `UID:${leadId || Date.now()}@cleanenergyexperts.pro`,
          `DTSTAMP:${formatICS(new Date())}`,
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');

        const icsBase64 = btoa(icsContent);

        // Format date for email
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const niceDate = startDt.toLocaleDateString('en-US', dateOptions);
        const hour12 = hour > 12 ? hour - 12 : hour;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const niceTime = `${hour12}:00 ${ampm}`;

        const emailHtml = `
          <div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #2E7D32, #43A047); padding: 32px 20px; text-align: center; border-radius: 12px 12px 0 0;">
              <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
              <h1 style="font-size: 22px; font-weight: 800; color: #fff; margin: 0 0 4px;">Your Appointment Is Confirmed</h1>
              <p style="font-size: 14px; color: rgba(255,255,255,0.9); margin: 0;">Edison Virtual Power Plant Battery Scan</p>
            </div>
            <div style="background: #fff; padding: 24px 20px; border: 1px solid #e0e0e0;">
              <h2 style="font-size: 17px; font-weight: 700; margin: 0 0 16px; color: #1a1a1a;">📅 Appointment Details</h2>
              <p style="font-size: 14px; color: #333; margin: 0 0 8px;"><strong>Date:</strong> ${niceDate}</p>
              <p style="font-size: 14px; color: #333; margin: 0 0 8px;"><strong>Time:</strong> ${niceTime}</p>
              <p style="font-size: 14px; color: #333; margin: 0 0 8px;"><strong>Location:</strong> ${streetAddress.trim()}, ${city.trim()}, ${state.trim()} ${zip.trim()}</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
              <h2 style="font-size: 17px; font-weight: 700; margin: 0 0 12px; color: #1a1a1a;">What Happens Next</h2>
              <p style="font-size: 14px; color: #444; line-height: 1.6; margin: 0;">
                A team member will reach out to confirm your appointment. On the day of your scan, we'll fly a drone over your roof and inspect your electrical panel to determine qualification for the Edison Virtual Power Plant program.
              </p>
            </div>
            <div style="background: #f8f8f8; padding: 16px 20px; text-align: center; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none;">
              <p style="font-size: 12px; color: #999; margin: 0;">Clean Energy Experts — Edison Virtual Power Plant Battery Program</p>
            </div>
          </div>
        `;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'Clean Energy Experts <no-reply@cleanenergyexperts.pro>',
            to: [email.trim()],
            bcc: ['johnfrankromanojr@gmail.com'],
            subject: `Your Battery Scan Appointment — ${niceDate} at ${niceTime}`,
            html: emailHtml,
            attachments: [{
              filename: 'appointment.ics',
              content: icsBase64,
              content_type: 'text/calendar',
            }],
          }),
        });
      } catch (emailErr) {
        console.error('Email send failed:', emailErr.message);
        // Don't fail the whole request if email fails
      }
    }

    return new Response(JSON.stringify({ success: true, leadId }), {
      status: 200, headers: corsHeaders,
    });

  } catch (err) {
    console.error('book-appointment error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  const allowed = origin.includes('cleanenergyexperts.pro') || origin.includes('virtualpowerplant.us') || origin.includes('localhost');
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowed ? origin : 'https://cleanenergyexperts.pro',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
