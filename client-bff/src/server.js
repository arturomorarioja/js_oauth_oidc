import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = parseInt(process.env.PORT || '5500', 10);

const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;

const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI;

const RESOURCE_API_BASE_URL = process.env.RESOURCE_API_BASE_URL;

if (!KEYCLOAK_BASE_URL || !KEYCLOAK_REALM || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !OIDC_REDIRECT_URI || !RESOURCE_API_BASE_URL) {
    throw new Error('Missing required environment variables. Copy .env.example to .env and set values.');
}

const issuer = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;
const authEndpoint = `${issuer}/protocol/openid-connect/auth`;
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;

/*
    Demo-grade in-memory store.
    This is acceptable for a short class demo, not for production.
*/
const stateStore = new Map(); // state -> { createdAtMs, tokens }

/*
    Serves static client UI.
*/
app.use(express.static(path.join(process.cwd(), 'public')));

function base64UrlEncode(buffer) {
    return buffer
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

function generateState() {
    return base64UrlEncode(crypto.randomBytes(32));
}

/*
    Starts the OIDC authorization code flow.
*/
app.get('/login', (req, res) => {
    const state = generateState();

    stateStore.set(state, {
        createdAtMs: Date.now(),
        tokens: null
    });

    const params = new URLSearchParams({
        client_id: OIDC_CLIENT_ID,
        response_type: 'code',
        scope: 'openid profile email',
        redirect_uri: OIDC_REDIRECT_URI,
        state
    });

    res.redirect(`${authEndpoint}?${params.toString()}`);
});

/*
    Handles callback and exchanges code for tokens (server-side).
*/
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state) {
        return res.status(400).send('Missing code or state.');
    }

    const entry = stateStore.get(state);
    if (!entry) {
        return res.status(400).send('Invalid or unknown state.');
    }

    try {
        const form = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: OIDC_CLIENT_ID,
            client_secret: OIDC_CLIENT_SECRET,
            redirect_uri: OIDC_REDIRECT_URI,
            code
        });

        const tokenRes = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            return res.status(502).send(`Token exchange failed (${tokenRes.status}).\n\n${errorText}`);
        }

        const tokens = await tokenRes.json();
        entry.tokens = tokens;

        return res.redirect(`/index.html?state=${encodeURIComponent(state)}`);
    } catch (err) {
        return res.status(500).send(`Callback error: ${String(err)}`);
    }
});

/*
    Returns the tokens for the given state so the browser can display them.
*/
app.get('/tokens', (req, res) => {
    const state = req.query.state;

    if (!state) {
        return res.status(400).json({ error: 'Missing state.' });
    }

    const entry = stateStore.get(state);
    if (!entry || !entry.tokens) {
        return res.status(404).json({ error: 'Tokens not found for this state.' });
    }

    res.json({
        issuer,
        token_endpoint: tokenEndpoint,
        tokens: entry.tokens
    });
});

/*
    Calls the resource API with the stored access token.
    This avoids browser CORS issues and shows a clean separation:
    - Browser never calls Keycloak token endpoint
    - Browser never calls API with tokens directly
*/
app.get('/call-api', async (req, res) => {
    const state = req.query.state;

    if (!state) {
        return res.status(400).json({ error: 'Missing state.' });
    }

    const entry = stateStore.get(state);
    if (!entry || !entry.tokens || !entry.tokens.access_token) {
        return res.status(404).json({ error: 'Access token not available.' });
    }

    try {
        const apiRes = await fetch(`${RESOURCE_API_BASE_URL}/secret`, {
            headers: {
                Authorization: `Bearer ${entry.tokens.access_token}`
            }
        });

        const text = await apiRes.text();
        res.status(apiRes.status).type('application/json').send(text);
    } catch (err) {
        res.status(502).json({ error: `API call failed: ${String(err)}` });
    }
});

app.listen(PORT, () => {
    console.log(`Client/BFF running on http://localhost:${PORT}`);
    console.log(`Issuer: ${issuer}`);
});