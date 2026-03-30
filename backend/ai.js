const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

/**
 * Genera el acta de una reunión basada en su transcripción.
 * @param {string} transcript - Texto de la transcripción. 
 * @param {string} style - Estilo del acta (neutral, formal).
 */
async function generateMinutes(transcript, style = 'neutral') {
  const prompt = `
    Eres un asistente experto en redactar actas de reuniones. 
    Basándote en la siguiente transcripción, genera un acta estructurada en Markdown.
    Incluye: Título, Asistentes (si se mencionan), Temas Tratados, Decisiones Tomadas y Tareas Pendientes.
    Estilo solicitado: ${style}.
    
    Transcripción:
    ${transcript}
  `;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error al generar acta con Gemini:", error);
    throw new Error("No se pudo generar el acta.");
  }
}

/**
 * Transcribe audio a texto usando Gemini 1.5 (Multimodal).
 * @param {Buffer} audioBuffer - Datos del audio.
 * @param {string} mimeType - Tipo de MIME (audio/webm, audio/wav, etc.).
 */
async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: audioBuffer.toString("base64")
        }
      },
      "Transcribe exactamente lo que se dice en este audio. Devuelve solo el texto de la transcripción."
    ]);
    return result.response.text();
  } catch (error) {
    console.error("Error al transcribir con Gemini:", error);
    return "Error en la transcripción automática de Gemini.";
  }
}

/**
 * Responde preguntas sobre una reunión basándose en su transcripción.
 * @param {string} prompt - La pregunta del usuario.
 * @param {string} transcript - Texto de la transcripción. 
 */
async function queryAboutMeeting(prompt, transcript) {
    const systemPrompt = `
      Eres un asistente IA para reuniones. Responde preguntas basadas en la siguiente transcripción:
      ${transcript}
      
      Pregunta: ${prompt}
    `;
    try {
      const result = await model.generateContent(systemPrompt);
      return result.response.text();
    } catch (error) {
      return "Hubo un problema consultando al asistente IA.";
    }
}

module.exports = { generateMinutes, transcribeAudio, queryAboutMeeting };
