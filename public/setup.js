(() => {
  const form = document.querySelector('#connection'), status = document.querySelector('#status'), button = document.querySelector('#connect'), token = document.querySelector('#token'), account = document.querySelector('#account');
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function connected(data) { if (data.accountId) account.value = data.accountId; message(data.backgroundActive ? 'Background generation is active. The server checks for pending episodes every minute, even when this page is closed.' : data.backgroundConfigured ? 'Background worker deployed. Waiting for its next successful check-in.' : data.connected ? 'Connection saved and account access verified. Background worker activation is still pending.' : 'Ready to connect. Only the app owner can use this page.'); }
  fetch('/api/owner/cloudflare', { cache: 'no-store', credentials: 'same-origin' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); connected(data); button.disabled = false; }).catch(error => message(error.message || 'Private setup is unavailable.', true));
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; message('Verifying your connection with Cloudflare…');
    let body = JSON.stringify({ accountId: account.value.trim(), token: token.value.trim() });
    try {
      const pending = fetch('/api/owner/cloudflare', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body }); body = '';
      const response = await pending, data = await response.json(); if (!response.ok) throw new Error(data.error); token.value = ''; connected(data);
    } catch (error) { message(error.message || 'Connection status is unknown. Reload to check before retrying.', true); }
    finally { body = ''; button.disabled = false; }
  });
  window.addEventListener('pagehide', () => { token.value = ''; });
})();
