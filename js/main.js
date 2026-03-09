// Form submission handler
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('lead-form');
  const success = document.getElementById('form-success');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.textContent = 'Checking...';
      btn.disabled = true;

      const data = Object.fromEntries(new FormData(form));

      try {
        // POST to our Cloudflare Worker endpoint (or Formspree fallback)
        const endpoint = form.action;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(data)
        });

        if (res.ok) {
          form.style.display = 'none';
          success.style.display = 'block';
          // Track conversion
          if (typeof fbq !== 'undefined') fbq('track', 'Lead');
        } else {
          throw new Error('Server error');
        }
      } catch (err) {
        btn.textContent = 'Something went wrong — try again';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = originalText; }, 3000);
      }
    });
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Nav background on scroll
  const nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.style.boxShadow = window.scrollY > 20
        ? '0 2px 12px rgba(0,0,0,0.08)'
        : 'none';
    });
  }
});
