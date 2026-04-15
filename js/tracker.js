/**
 * CEE Landing Page Tracker — lightweight analytics
 * Tracks: pageview, scroll depth, CTA clicks, form starts, time on page
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

  // Session ID — persists for 30 min
  var SESSION_KEY = 'cee_sid';
  var sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sid);
  }

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

  // 1. Pageview
  send('pageview');

  // 2. Scroll depth tracking (25%, 50%, 75%, 100%)
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

  // 3. CTA click tracking
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button, [data-track]');
    if (!el) return;

    var trackLabel = el.getAttribute('data-track');
    if (trackLabel) {
      send('cta_click', { metadata: { label: trackLabel } });
      return;
    }

    // Track links to #form or booking sections
    var href = el.getAttribute('href') || '';
    if (href.includes('#') || el.classList.contains('cta') || el.textContent.match(/schedule|book|check|qualify|scan/i)) {
      send('cta_click', { metadata: { label: el.textContent.trim().slice(0, 80), href: href.slice(0, 200) } });
    }
  });

  // 4. Form interaction tracking
  var formStarted = false;
  document.addEventListener('focusin', function(e) {
    if (formStarted) return;
    var el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      var form = el.closest('form, .form-section, [data-form]');
      if (form) {
        formStarted = true;
        send('form_start');
      }
    }
  });

  // 5. Time on page (sent on unload)
  var startTime = Date.now();
  function sendTimeOnPage() {
    var seconds = Math.round((Date.now() - startTime) / 1000);
    if (seconds < 2) return; // Skip bounces under 2s
    send('time_on_page', { time_on_page: seconds, scroll_depth: maxScroll });
  }

  // Use both visibilitychange and beforeunload for best coverage
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') sendTimeOnPage();
  });
  window.addEventListener('beforeunload', sendTimeOnPage);

})();
