const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
 * (Opcional/Futuro) Transcribe audio a texto. 
 * Nota: Requiere enviar el audio en formato compatible o usar la API de File de Google.
 */
async function transcribeAudio(audioBuffer, mimeType) {
  // Por ahora mantenemos la estructura para cuando implementemos la subida real.
  // Gemini 1.5 permite enviar audios directamente.
  return "Transcripción simulada (implementando flujo de audio...)";
}

module.exports = { generateMinutes, transcribeAudio };
