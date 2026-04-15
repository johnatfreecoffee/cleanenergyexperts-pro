/**
 * CEE Landing Page Tracker v2 — enhanced analytics
 * Tracks: pageview, scroll depth, CTA clicks, form starts, partial fills,
 *         form abandonment, repeat visits, time on page, field interactions
 * Sends events to /api/track → Supabase page_analytics
 */
(function() {
  'use strict';

  var ENDPOINT = '/api/track';
  var page = location.pathname.replace(/\/$/, '') || '/';

  // Parse URL params once
  var params = new URLSearchParams(location.search);
  var fbclid = params.get('fbclid');
  var utm_source = params.get('utm_source');
  var utm_medium = params.get('utm_medium');
  var utm_campaign = params.get('utm_campaign');
  var utm_content = params.get('utm_content');

  // Session ID — persists for browser session
  var SESSION_KEY = 'cee_sid';
  var sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sid);
  }

  // Visitor ID — persists across sessions (localStorage)
  var VISITOR_KEY = 'cee_vid';
  var vid = null;
  try {
    vid = localStorage.getItem(VISITOR_KEY);
    if (!vid) {
      vid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(VISITOR_KEY, vid);
    }
  } catch(e) { vid = sid; }

  // Visit count — track repeat visitors
  var VISIT_COUNT_KEY = 'cee_vc_' + page;
  var visitCount = 1;
  try {
    visitCount = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10) + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(visitCount));
  } catch(e) {}

  // Device type
  var w = screen.width || window.innerWidth;
  var deviceType = w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';

  // Base payload
  function base(event, extra) {
    var payload = {
      page: page,
      event: event,
      source: page.replace(/^\//, '') || 'home',
      fbclid: fbclid,
      utm_source: utm_source,
      utm_medium: utm_medium,
      utm_campaign: utm_campaign,
      utm_content: utm_content,
      referrer: document.referrer || null,
      session_id: sid,
      device_type: deviceType,
      screen_width: w,
    };
    if (extra) {
      for (var k in extra) payload[k] = extra[k];
    }
    return payload;
  }

  // Send event (fire-and-forget via beacon, fallback to fetch)
  function send(event, extra) {
    var data = JSON.stringify(base(event, extra));
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([data], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', body: data, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function(){});
    }
  }

  // ─── 1. Pageview (with repeat visit detection) ───
  send('pageview', {
    metadata: {
      visitor_id: vid,
      visit_count: visitCount,
      is_repeat: visitCount > 1,
    }
  });

  // If repeat visitor, also fire a dedicated event
  if (visitCount > 1) {
    send('repeat_visit', {
      metadata: {
        visitor_id: vid,
        visit_count: visitCount,
      }
    });
  }

  // ─── 2. Scroll depth tracking (25%, 50%, 75%, 100%) ───
  var maxScroll = 0;
  var scrollThresholds = [25, 50, 75, 100];
  var scrollFired = {};

  function onScroll() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
    if (docHeight <= 0) return;
    var pct = Math.round((scrollTop / docHeight) * 100);
    if (pct > maxScroll) maxScroll = pct;

    for (var i = 0; i < scrollThresholds.length; i++) {
      var t = scrollThresholds[i];
      if (pct >= t && !scrollFired[t]) {
        scrollFired[t] = true;
        send('scroll', { scroll_depth: t });
      }
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ─── 3. CTA click tracking ───
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button, [data-track]');
    if (!el) return;

    var trackLabel = el.getAttribute('data-track');
    if (trackLabel) {
      send('cta_click', { metadata: { label: trackLabel } });
      return;
    }

    var href = el.getAttribute('href') || '';
    if (href.includes('#') || el.classList.contains('cta') || el.textContent.match(/schedule|book|check|qualify|scan/i)) {
      send('cta_click', { metadata: { label: el.textContent.trim().slice(0, 80), href: href.slice(0, 200) } });
    }
  });

  // ─── 4. Form interaction tracking (enhanced) ───
  var formStarted = false;
  var fieldsTyped = {};  // track which fields user typed in
  var fieldTimestamps = {};

  document.addEventListener('focusin', function(e) {
    var el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') return;

    var fieldName = el.name || el.id || el.getAttribute('placeholder') || 'unknown';

    // Track first interaction with form
    if (!formStarted) {
      var form = el.closest('form, .form-section, [data-form], .form-card');
      if (form) {
        formStarted = true;
        send('form_start', { metadata: { first_field: fieldName } });
      }
    }

    // Track per-field focus
    if (!fieldTimestamps[fieldName]) {
      fieldTimestamps[fieldName] = Date.now();
    }
  });

  // Track typing activity per field
  document.addEventListener('input', function(e) {
    var el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') return;

    var fieldName = el.name || el.id || 'unknown';
    var val = el.value || '';

    // Mark field as typed-in if it has content
    if (val.trim().length > 0) {
      fieldsTyped[fieldName] = true;
    } else {
      delete fieldsTyped[fieldName];
    }
  });

  // ─── 5. Form abandonment / partial fill detection ───
  // On page unload, if form was started but not submitted, send partial_fill
  var formSubmitted = false;

  // Listen for actual form submission
  document.addEventListener('submit', function() {
    formSubmitted = true;
    var filledFields = Object.keys(fieldsTyped);
    send('form_submit', {
      metadata: {
        fields_filled: filledFields,
        fields_count: filledFields.length,
      }
    });
  });

  function sendAbandonmentIfNeeded() {
    if (formStarted && !formSubmitted) {
      var filledFields = Object.keys(fieldsTyped);
      if (filledFields.length > 0) {
        send('form_partial_fill', {
          metadata: {
            fields_filled: filledFields,
            fields_count: filledFields.length,
            visitor_id: vid,
          }
        });
      } else {
        send('form_abandoned', {
          metadata: {
            visitor_id: vid,
            time_in_form_sec: Math.round((Date.now() - (fieldTimestamps[Object.keys(fieldTimestamps)[0]] || Date.now())) / 1000),
          }
        });
      }
    }
  }

  // ─── 6. Time on page (sent on unload) ───
  var startTime = Date.now();
  function sendTimeOnPage() {
    var seconds = Math.round((Date.now() - startTime) / 1000);
    if (seconds < 2) return;
    send('time_on_page', { time_on_page: seconds, scroll_depth: maxScroll });
  }

  // Use both visibilitychange and beforeunload for best coverage
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      sendAbandonmentIfNeeded();
      sendTimeOnPage();
    }
  });
  window.addEventListener('beforeunload', function() {
    sendAbandonmentIfNeeded();
    sendTimeOnPage();
  });

})();
