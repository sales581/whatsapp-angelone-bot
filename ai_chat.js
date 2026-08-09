const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function initAI(apiKey) {
    if (apiKey) {
        try {
            genAI = new GoogleGenerativeAI(apiKey);
            console.log('✅ Google Gemini API initialized');
        } catch (e) {
            console.error('Failed to initialize Gemini API:', e);
        }
    }
}

async function generateReply(systemPrompt, history, userMessage) {
    if (!genAI) return null;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
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
