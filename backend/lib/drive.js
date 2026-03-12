const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./google-auth');
const stream = require('stream');

const APP_FOLDER_NAME = process.env.DRIVE_FOLDER_NAME || 'ConferenceApp';
const AUDIOS_FOLDER_NAME = 'Audios';
const ACTAS_FOLDER_NAME = 'Actas';

/**
 * Obtiene una instancia de Google Drive autenticada para el usuario.
 */
function getDriveClient(refreshToken) {
    const auth = getAuthenticatedClient(refreshToken);
    return google.drive({ version: 'v3', auth });
}

/**
 * Busca una carpeta por nombre dentro de un parent (o raíz).
 */
async function findFolder(drive, name, parentId = 'root') {
    const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const { data } = await drive.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' });
    return data.files.length > 0 ? data.files[0] : null;
}

/**
 * Crea una carpeta en Drive.
 */
async function createFolder(drive, name, parentId = 'root') {
    const { data } = await drive.files.create({
        requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id, name',
    });
    return data;
}

/**
 * Inicializa la estructura de carpetas del usuario en Drive:
 * ConferenceApp/
 *   ├── Audios/
 *   └── Actas/
 * 
 * Retorna los IDs de las carpetas.
 */
async function initDriveFolders(refreshToken) {
    const drive = getDriveClient(refreshToken);

    // Buscar o crear carpeta raíz
    let rootFolder = await findFolder(drive, APP_FOLDER_NAME);
    if (!rootFolder) {
        rootFolder = await createFolder(drive, APP_FOLDER_NAME);
    }

    // Buscar o crear subcarpetas
    let audiosFolder = await findFolder(drive, AUDIOS_FOLDER_NAME, rootFolder.id);
    if (!audiosFolder) {
        audiosFolder = await createFolder(drive, AUDIOS_FOLDER_NAME, rootFolder.id);
    }

    let actasFolder = await findFolder(drive, ACTAS_FOLDER_NAME, rootFolder.id);
    if (!actasFolder) {
        actasFolder = await createFolder(drive, ACTAS_FOLDER_NAME, rootFolder.id);
    }

    return {
        rootFolderId: rootFolder.id,
        audiosFolderId: audiosFolder.id,
        actasFolderId: actasFolder.id,
    };
}

/**
 * Sube un archivo de audio al Drive del usuario.
 * @param {string} refreshToken
 * @param {Buffer} audioBuffer - El contenido del audio
 * @param {string} fileName - Nombre del archivo (ej: "Reunion_Q1.webm")
 * @param {string} mimeType - Tipo MIME (ej: "audio/webm")
 * @param {string} audiosFolderId - ID de la carpeta Audios en Drive
 * @returns {{ fileId, webViewLink }}
 */
async function uploadAudio(refreshToken, audioBuffer, fileName, mimeType, audiosFolderId) {
    const drive = getDriveClient(refreshToken);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(audioBuffer);

    const { data } = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [audiosFolderId],
        },
        media: {
            mimeType: mimeType || 'audio/webm',
            body: bufferStream,
        },
        fields: 'id, webViewLink',
    });

    return { fileId: data.id, webViewLink: data.webViewLink };
}

/**
 * Sube un acta (como archivo de texto/markdown) al Drive del usuario.
 * @param {string} refreshToken
 * @param {string} content - Contenido del acta en markdown
 * @param {string} fileName - Nombre del archivo (ej: "Acta_Reunion_Q1.md")
 * @param {string} actasFolderId - ID de la carpeta Actas en Drive
 * @returns {{ fileId, webViewLink }}
 */
async function uploadMinutes(refreshToken, content, fileName, actasFolderId) {
    const drive = getDriveClient(refreshToken);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(content, 'utf-8'));

    const { data } = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [actasFolderId],
            mimeType: 'application/vnd.google-apps.document', // Crea un Google Doc
        },
        media: {
            mimeType: 'text/plain',
            body: bufferStream,
        },
        fields: 'id, webViewLink, exportLinks',
    });

    return { fileId: data.id, webViewLink: data.webViewLink };
}

/**
 * Genera un enlace de descarga temporal para un archivo.
 */
async function getDownloadUrl(refreshToken, fileId) {
    const drive = getDriveClient(refreshToken);

    // Para Google Docs, usamos export
    const { data: meta } = await drive.files.get({ fileId, fields: 'mimeType' });

    if (meta.mimeType === 'application/vnd.google-apps.document') {
        // Exportar como PDF
        const { data } = await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
        // Retornamos el link directo al doc
        const { data: fileMeta } = await drive.files.get({ fileId, fields: 'webViewLink' });
        return fileMeta.webViewLink;
    }

    // Para archivos normales (audio), generar link
    const { data } = await drive.files.get({ fileId, fields: 'webContentLink, webViewLink' });
    return data.webContentLink || data.webViewLink;
}

/**
 * Borra un archivo del Drive del usuario.
 */
async function deleteFile(refreshToken, fileId) {
    const drive = getDriveClient(refreshToken);
    await drive.files.delete({ fileId });
}

/**
 * Sube un archivo PDF al Drive del usuario.
 * @param {string} refreshToken
 * @param {Buffer} pdfBuffer - El contenido del PDF
 * @param {string} fileName - Nombre del archivo (ej: "Acta_Reunion.pdf")
 * @param {string} actasFolderId - ID de la carpeta Actas en Drive
 * @returns {Promise<{ fileId, webViewLink }>}
 */
async function uploadPDF(refreshToken, pdfBuffer, fileName, actasFolderId) {
    const drive = getDriveClient(refreshToken);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(pdfBuffer);

    const { data } = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [actasFolderId],
        },
        media: {
            mimeType: 'application/pdf',
            body: bufferStream,
        },
        fields: 'id, webViewLink',
    });

    return { fileId: data.id, webViewLink: data.webViewLink };
}

module.exports = {
    initDriveFolders,
    uploadAudio,
    uploadMinutes,
    uploadPDF,
    getDownloadUrl,
    deleteFile,
};
