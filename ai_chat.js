const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let currentModelName = "gemini-1.5-flash"; // Default fallback

async function initAI(apiKey) {
    if (apiKey) {
        try {
            genAI = new GoogleGenerativeAI(apiKey);
            console.log('✅ Google Gemini API initialized');
            
            // Auto-detect available model to prevent 404s
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                const data = await response.json();
                const models = (data.models || [])
                    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));
                
                console.log('Available models:', models.join(', '));
                
                if (models.includes('gemini-2.5-flash')) currentModelName = 'gemini-2.5-flash';
                else if (models.includes('gemini-2.0-flash')) currentModelName = 'gemini-2.0-flash';
                else if (models.includes('gemini-1.5-flash')) currentModelName = 'gemini-1.5-flash';
                else if (models.includes('gemini-pro')) currentModelName = 'gemini-pro';
                else if (models.length > 0) currentModelName = models[0];
                
                console.log('✅ Selected Gemini Model:', currentModelName);
            } catch (err) {
                console.error('Failed to fetch available models:', err.message);
            }
        } catch (e) {
            console.error('Failed to initialize Gemini API:', e);
        }
    }
}

async function generateReply(systemPrompt, history, userMessage) {
    if (!genAI) return null;
    try {
        const model = genAI.getGenerativeModel({ model: currentModelName });
        
        let fullPrompt = `${systemPrompt}\n\n`;
        
        if (history && history.length > 0) {
            fullPrompt += "Conversation History:\n";
            // Get last 10 messages for context
            const recentHistory = history.slice(-10);
            recentHistory.forEach(msg => {
                const role = msg.direction === 'incoming' ? 'Client' : 'You';
                fullPrompt += `${role}: ${msg.content}\n`;
            });
            fullPrompt += "\n";
        }
        
        fullPrompt += `Client: ${userMessage}\nYou:`;

        const result = await model.generateContent(fullPrompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("AI Generation error:", e);
        return null;
    }
}

module.exports = { initAI, generateReply };
