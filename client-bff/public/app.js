function getStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('state');
}

async function loadTokens(state) {
    const res = await fetch(`/tokens?state=${encodeURIComponent(state)}`);
    if (!res.ok) {
        return null;
    }
    return await res.json();
}

async function callApi(state) {
    const res = await fetch(`/call-api?state=${encodeURIComponent(state)}`);
    const text = await res.text();
    return { status: res.status, body: text };
}

const outTokens = document.getElementById('outTokens');
const outApi = document.getElementById('outApi');
const btnCallApi = document.getElementById('btnCallApi');

const state = getStateFromUrl();

if (!state) {
    outTokens.textContent = 'No state in URL. Click "Login via OIDC".';
} else {
    const data = await loadTokens(state);
    if (!data) {
        outTokens.textContent = 'Tokens not available yet. Click "Login via OIDC".';
    } else {
        outTokens.textContent = JSON.stringify(data, null, 4);
        btnCallApi.disabled = false;

        btnCallApi.addEventListener('click', async () => {
            outApi.textContent = 'Calling API...';
            const result = await callApi(state);
            outApi.textContent = `HTTP ${result.status}\n\n${result.body}`;
        });
    }
}