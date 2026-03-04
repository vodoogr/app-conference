const { google } = require('googleapis');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/v1/auth/callback';

const SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file', // Solo archivos creados por la app
];

/**
 * Crea un cliente OAuth2 de Google.
 */
function createOAuth2Client() {
    return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/**
 * Genera la URL de autenticación de Google.
 */
function getAuthUrl() {
    const oauth2Client = createOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',      // Para obtener refresh_token
        prompt: 'consent',           // Forzar pantalla de consentimiento (para obtener refresh_token siempre)
        scope: SCOPES,
    });
}

/**
 * Intercambia un código de autorización por tokens.
 * @param {string} code - Código de autorización de Google
 * @returns {{ access_token, refresh_token, id_token, expiry_date }}
 */
async function getTokensFromCode(code) {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
}

/**
 * Obtiene la información del perfil del usuario usando un access_token.
 * @param {string} accessToken
 * @returns {{ email, name, picture }}
 */
async function getGoogleUserInfo(accessToken) {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    return {
        email: data.email,
        name: data.name,
        picture: data.picture,
    };
}

/**
 * Crea un cliente OAuth2 autenticado con el refresh_token del usuario.
 * Se usa para hacer llamadas a Drive en nombre del usuario.
 * @param {string} refreshToken
 * @returns {google.auth.OAuth2}
 */
function getAuthenticatedClient(refreshToken) {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}

module.exports = {
    createOAuth2Client,
    getAuthUrl,
    getTokensFromCode,
    getGoogleUserInfo,
    getAuthenticatedClient,
};
