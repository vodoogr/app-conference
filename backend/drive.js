const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Genera la URL para que el usuario autorice a la app en Google.
 */
function getAuthUrl() {
  const scopes = ['https://www.googleapis.com/auth/drive.file'];
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
}

/**
 * Intercambia el código de autorización por tokens.
 */
async function getTokens(code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Sube un archivo de acta (Markdown) a Google Drive.
 * @param {string} title - Título del archivo.
 * @param {string} content - Contenido en Markdown.
 * @param {object} tokens - Tokens de acceso del usuario.
 */
async function uploadToDrive(title, content, tokens) {
  oauth2Client.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const fileMetadata = {
    name: `${title}.md`,
    mimeType: 'text/markdown',
  };
  const media = {
    mimeType: 'text/markdown',
    body: content,
  };

  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });
    return file.data;
  } catch (error) {
    console.error('Error al subir a Google Drive:', error);
    throw error;
  }
}

module.exports = { getAuthUrl, getTokens, uploadToDrive };
