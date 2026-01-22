import express from 'express';
import dotenv from 'dotenv';
import { createRemoteJWKSet, jwtVerify } from 'jose';

dotenv.config();

const app = express();

const PORT = parseInt(process.env.PORT || '9000', 10);

const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const EXPECTED_CLIENT_ID = process.env.EXPECTED_CLIENT_ID;

if (!KEYCLOAK_BASE_URL || !KEYCLOAK_REALM || !EXPECTED_CLIENT_ID) {
    throw new Error('Missing required environment variables. Copy .env.example to .env and set values.');
}

const issuer = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;
const jwksUri = new URL(`${issuer}/protocol/openid-connect/certs`);
const jwks = createRemoteJWKSet(jwksUri);

async function requireValidAccessToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Bearer token.' });
    }

    const token = auth.slice('Bearer '.length);

    try {
        const { payload } = await jwtVerify(token, jwks, {
            issuer
            /*
                Audience validation is not always straightforward with Keycloak access tokens
                because audience can vary by client and configuration.
                A robust demo check is azp (authorized party).
            */
        });

        if (payload.azp !== EXPECTED_CLIENT_ID) {
            return res.status(403).json({
                error: 'Token not issued for expected client.',
                expected_azp: EXPECTED_CLIENT_ID,
                actual_azp: payload.azp
            });
        }

        req.oidc = { payload };
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token.', details: String(err) });
    }
}

app.get('/public', (req, res) => {
    res.json({ message: 'Public endpoint. No token required.' });
});

app.get('/secret', requireValidAccessToken, (req, res) => {
    const p = req.oidc.payload;

    res.json({
        message: 'Protected resource. Token validated against JWKS.',
        sub: p.sub,
        preferred_username: p.preferred_username,
        azp: p.azp,
        iss: p.iss,
        exp: p.exp
    });
});

app.listen(PORT, () => {
    console.log(`Resource API running on http://localhost:${PORT}`);
    console.log(`Issuer: ${issuer}`);
    console.log(`JWKS: ${jwksUri.toString()}`);
});