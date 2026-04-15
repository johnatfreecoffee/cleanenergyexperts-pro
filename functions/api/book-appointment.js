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

  // Constants
  const BUSINESS_ID = '2c15a95b-abb3-4f2a-949b-c369b5bda65b';
  const AREA_ID = '31fd46cc-a80a-4ae5-ba61-775744ad08dd';
  const JOHN_EMAIL = 'johnfrankromanojr@gmail.com';
  const CREATED_BY = 'hello@noknok.pro'; // noknok CRM user for calendar visibility

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

    // Determine imported_lead_source
    const sourceMap = {
      'limited-spots': 'Meta Ad - Limited Spots',
      'no-cost-powerwall': 'Meta Ad - No Cost Powerwall',
      'your-neighbors': 'Meta Ad - Your Neighbors',
    };
    const importedLeadSource = sourceMap[source] || source || 'Meta Ad - Unknown';

    // Build notes
    const noteParts = [`Appointment: ${appointmentDate} at ${appointmentTime}`];
    if (sourceUrl) noteParts.push(`Source page: ${sourceUrl}`);
    if (fbclid) noteParts.push(`fbclid: ${fbclid}`);
    const notes = noteParts.join(' | ');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
        status: 500, headers: corsHeaders,
      });
    }

    const supaHeaders = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=representation',
    };

    // ──────────────────────────────────
    // 1. CREATE LEAD in noknok CRM
    // ──────────────────────────────────
    const leadPayload = {
      business_id: BUSINESS_ID,
      area_id: AREA_ID,
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
      headers: supaHeaders,
      body: JSON.stringify(leadPayload),
    });

    if (!supaRes.ok) {
      const errText = await supaRes.text();
      console.error('Supabase lead error:', errText);
      return new Response(JSON.stringify({ error: 'Failed to save lead', detail: errText }), {
        status: 500, headers: corsHeaders,
      });
    }

    const inserted = await supaRes.json();
    const leadId = inserted?.[0]?.id || inserted?.id || null;

    // ──────────────────────────────────
    // 2. CREATE CALENDAR EVENT (meeting) in noknok CRM
    //    linked to lead via object_id, created_by hello@noknok.pro for visibility
    // ──────────────────────────────────
    const meetingName = `Battery Scan — ${firstName.trim()} ${lastName.trim()}`;
    const meetingDescription = [
      `📍 ${streetAddress.trim()}, ${city.trim()}, ${state.trim()} ${zip.trim()}`,
      `📞 ${cleanPhone}`,
      email?.trim() ? `📧 ${email.trim()}` : null,
      `📋 Source: ${importedLeadSource}`,
      fbclid ? `🔗 fbclid: ${fbclid}` : null,
    ].filter(Boolean).join('\n');

    const meetingPayload = {
      business_id: BUSINESS_ID,
      name: meetingName,
      start_date: appointmentDate,
      start_time: appointmentTime,
      duration: 60,
      description: meetingDescription,
      object_id: leadId,
      created_by: CREATED_BY,
      status: 'upcoming',
      is_completed: false,
    };

    try {
      const meetRes = await fetch(`${SUPABASE_URL}/rest/v1/meetings`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(meetingPayload),
      });
      if (!meetRes.ok) {
        console.error('Meeting create error:', await meetRes.text());
      }
    } catch (meetErr) {
      console.error('Meeting create failed:', meetErr.message);
    }

    // ──────────────────────────────────
    // 3. PARSE DATE/TIME for emails
    // ──────────────────────────────────
    const [year, month, day] = appointmentDate.split('-').map(Number);
    const [hour, minute] = appointmentTime.split(':').map(Number);
    const startDt = new Date(year, month - 1, day, hour, minute);
    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const formatICS = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const niceDate = startDt.toLocaleDateString('en-US', dateOptions);
    const hour12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const niceTime = `${hour12}:00 ${ampm}`;

    const locationStr = `${streetAddress.trim()}, ${city.trim()}, ${state.trim()} ${zip.trim()}`;

    // ICS calendar content (shared between lead email and John's notification)
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Clean Energy Experts//Battery Scan//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `DTSTART;TZID=America/Los_Angeles:${formatICS(startDt)}`,
      `DTEND;TZID=America/Los_Angeles:${formatICS(endDt)}`,
      `SUMMARY:Battery Scan — ${firstName.trim()} ${lastName.trim()}`,
      `DESCRIPTION:Battery scan appointment for ${firstName.trim()} ${lastName.trim()}\\n${locationStr}\\nPhone: ${cleanPhone}${email?.trim() ? '\\nEmail: ' + email.trim() : ''}\\nSource: ${importedLeadSource}`,
      `LOCATION:${locationStr.replace(/,/g, '\\,')}`,
      'STATUS:CONFIRMED',
      `UID:${leadId || Date.now()}@cleanenergyexperts.pro`,
      `DTSTAMP:${formatICS(new Date())}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const icsBase64 = btoa(icsContent);

    // ──────────────────────────────────
    // 4. EMAIL: Notification to JOHN (always sent)
    // ──────────────────────────────────
    if (RESEND_API_KEY) {
      try {
        const johnHtml = `
          <div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #FF6B00, #FF8C00); padding: 28px 20px; text-align: center; border-radius: 12px 12px 0 0;">
              <div style="font-size: 42px; margin-bottom: 8px;">🔋</div>
              <h1 style="font-size: 22px; font-weight: 800; color: #fff; margin: 0 0 4px;">New Battery Scan Booking!</h1>
              <p style="font-size: 14px; color: rgba(255,255,255,0.9); margin: 0;">Someone just booked from your landing page</p>
            </div>
            <div style="background: #fff; padding: 24px 20px; border: 1px solid #e0e0e0;">
              <h2 style="font-size: 17px; font-weight: 700; margin: 0 0 16px; color: #1a1a1a;">👤 Lead Details</h2>
              <table style="width: 100%; font-size: 14px; color: #333;">
                <tr><td style="padding: 4px 0; font-weight: 600; width: 120px;">Name:</td><td>${firstName.trim()} ${lastName.trim()}</td></tr>
                <tr><td style="padding: 4px 0; font-weight: 600;">Phone:</td><td><a href="tel:${cleanPhone}" style="color: #FF6B00;">${cleanPhone}</a></td></tr>
                ${email?.trim() ? `<tr><td style="padding: 4px 0; font-weight: 600;">Email:</td><td>${email.trim()}</td></tr>` : ''}
                <tr><td style="padding: 4px 0; font-weight: 600;">Address:</td><td>${locationStr}</td></tr>
              </table>
              <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
              <h2 style="font-size: 17px; font-weight: 700; margin: 0 0 12px; color: #1a1a1a;">📅 Appointment</h2>
              <p style="font-size: 14px; color: #333; margin: 0 0 4px;"><strong>${niceDate}</strong> at <strong>${niceTime}</strong></p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
              <h2 style="font-size: 17px; font-weight: 700; margin: 0 0 12px; color: #1a1a1a;">📊 Source</h2>
              <p style="font-size: 13px; color: #666; margin: 0 0 4px;">${importedLeadSource}</p>
              ${sourceUrl ? `<p style="font-size: 12px; color: #999; margin: 0;">${sourceUrl}</p>` : ''}
              ${fbclid ? `<p style="font-size: 12px; color: #999; margin: 0;">fbclid: ${fbclid}</p>` : ''}
            </div>
            <div style="background: #FFF8F0; padding: 16px 20px; text-align: center; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none;">
              <p style="font-size: 13px; color: #FF6B00; font-weight: 600; margin: 0;">Lead added to Clean Energy Experts CRM + Calendar in noknok</p>
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
            from: 'Clean Energy Experts <no-reply@virtualpowerplant.us>',
            to: [JOHN_EMAIL],
            subject: `🔋 New Booking: ${firstName.trim()} ${lastName.trim()} — ${niceDate} at ${niceTime}`,
            html: johnHtml,
            attachments: [{
              filename: 'appointment.ics',
              content: icsBase64,
              content_type: 'text/calendar',
            }],
          }),
        });
      } catch (johnEmailErr) {
        console.error('John notification email failed:', johnEmailErr.message);
      }

      // ──────────────────────────────────
      // 5. EMAIL: Confirmation to LEAD (only if they gave email)
      // ──────────────────────────────────
      if (email?.trim()) {
        try {
          const leadHtml = `
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
                <p style="font-size: 14px; color: #333; margin: 0 0 8px;"><strong>Location:</strong> ${locationStr}</p>
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
              from: 'Clean Energy Experts <no-reply@virtualpowerplant.us>',
              to: [email.trim()],
              subject: `Your Battery Scan Appointment — ${niceDate} at ${niceTime}`,
              html: leadHtml,
              attachments: [{
                filename: 'appointment.ics',
                content: icsBase64,
                content_type: 'text/calendar',
              }],
            }),
          });
        } catch (leadEmailErr) {
          console.error('Lead confirmation email failed:', leadEmailErr.message);
        }
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
