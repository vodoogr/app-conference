const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.warn('⚠️ GEMINI_API_KEY no configurada. Las funciones de IA devolverán datos simulados.');
}

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/**
 * Sube un archivo de audio a la API de validación de archivos de Gemini y obtiene el objeto file para procesar.
 * Utiliza un archivo temporal local porque el SDK require una ruta de archivo en disco.
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @returns {Promise<object>} Objeto file de Gemini
 */
async function uploadAudioToGemini(audioBuffer, mimeType, fileName = 'audio.webm') {
    if (!ai) throw new Error('GEMINI_API_KEY no configurada');

    // Escribir temp file
    const tempFilePath = path.join(os.tmpdir(), fileName);
    fs.writeFileSync(tempFilePath, audioBuffer);

    try {
        console.log(`Subiendo ${fileName} a Gemini AI...`);
        const file = await ai.files.upload({
            file: tempFilePath,
            mimeType: mimeType,
            displayName: fileName
        });
        console.log(`✓ Archivo subido a Gemini: ${file.name}`);
        return file;
    } finally {
        // Limpiar archivo temporal
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

/**
 * Transcribe un archivo de audio y genera el acta en un solo paso usando Gemini 1.5 Pro.
 * @param {object} geminiFile El fileUri devuelto por uploadAudioToGemini
 * @returns {Promise<{transcriptSegments: Array, minutesMarkdown: string}>}
 */
async function processAudioAndGenerateMinutes(geminiFile) {
    if (!ai) {
        return {
            transcriptSegments: [{ speaker_label: 'speaker_1', text: 'Transcripción simulada porque GEMINI_API_KEY no está configurada.', start_ms: 0, end_ms: 5000 }],
            minutesMarkdown: '# Acta Generada\n\nSimulación de acta\n\n## Puntos Clave\n- Configurar GEMINI_API_KEY en backend'
        };
    }

    const systemInstruction = `
Eres un asistente experto en secretariado y redacción de actas de reuniones.
El usuario te enviará un archivo de audio de la grabación de una reunión.
Debes escuchar el audio atentamente, identificar a los diferentes hablantes (speaker_1, speaker_2, etc.) y realizar dos tareas principales, devolviendo UN ÚNICO JSON válido con la siguiente estructura exacta:

\`\`\`json
{
  "transcript": [
    { "speaker_label": "speaker_X", "text": "texto exacto de lo que dice", "start_ms": 1200, "end_ms": 4500 }
  ],
  "minutes_md": "# Acta de la reunión\\n\\n## Resumen Ejecutivo\\n...\\n\\n## Puntos Clave\\n...\\n\\n## Decisiones\\n...\\n\\n## Tareas\\n- [ ] ..."
}
\`\`\`

REGLAS CRÍTICAS:
1. No incluyas nada más fuera del JSON. La respuesta debe ser parseable por \`JSON.parse()\`.
2. Para \`start_ms\` y \`end_ms\`, estima en milisegundos cuando habla cada persona.
3. El acta (\`minutes_md\`) DEBE ser profesional, estar en español y seguir esta estructura:
   - Resumen Ejecutivo (párrafo conciso).
   - Puntos Clave (lista con lo más relevante).
   - Decisiones Acordadas.
   - Tareas y Personas Responsables (formato lista de tareas Markdown).
4. El acta debe ser un resumen ejecutivo útil, no una transcripción literal.
`.trim();

    console.log('Solicitando procesamiento de audio a Gemini...');
    const model = ai.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: systemInstruction
    });

    const result = await model.generateContent([
        {
            fileData: {
                mimeType: geminiFile.mimeType,
                fileUri: geminiFile.uri
            }
        },
        { text: "Procesa esta reunión y devuelve el JSON solicitado." }
    ]);

    const response = await result.response;
    let respText = response.text();

    // Limpiar posibles bloques de código markdown
    respText = respText.replace(/```json|```/g, '').trim();

    try {
        const data = JSON.parse(respText);
        return {
            transcriptSegments: data.transcript || [],
            minutesMarkdown: data.minutes_md || '# Error leyendo el acta de la IA'
        };
    } catch (e) {
        console.error('Error parseando JSON de Gemini:', e, '\nTexto recibido:', respText);
        throw new Error('La respuesta de Gemini no es un JSON válido');
    }
}

/**
 * Consulta interactiva con el Asistente IA dentro de una reunión.
 * @param {string} prompt Pregunta o solicitud del usuario
 * @param {Array} transcriptSegments Historial de la transcripción para contexto
 * @returns {Promise<string>} Respuesta en markdown
 */
async function chatWithAssistant(prompt, transcriptSegments) {
    if (!ai) return '*Respuesta simulada:* El bot responderá aquí cuando GEMINI_API_KEY esté configurada.';

    const contextText = transcriptSegments.map(seg => `[${seg.speaker_name || seg.speaker_label}]: ${seg.text}`).join('\n');

    const systemInstruction = `
Eres un Asistente de Inteligencia Artificial integrado en una aplicación de Actas de Reunión.
El usuario te hará preguntas sobre la reunión actual basándose en la transcripción proporcionada.
Responde de forma concisa, educada y en español, usando formato Markdown (listas, negritas, etc.).

Aquí está la transcripción de la reunión como contexto:
---
${contextText}
---
`.trim();

    try {
        const model = ai.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: systemInstruction
        });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Error en Asistente IA:', error);
        return '*Ocurrió un error al contactar con la IA.*';
    }
}

module.exports = {
    uploadAudioToGemini,
    processAudioAndGenerateMinutes,
    chatWithAssistant
};
