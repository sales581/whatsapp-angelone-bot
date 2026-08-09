const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let availableModels = ["gemini-pro"]; // Absolute fallback

async function initAI(apiKey) {
    if (apiKey) {
        try {
            genAI = new GoogleGenerativeAI(apiKey);
            console.log('✅ Google Gemini API initialized');
            
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                const data = await response.json();
                
                // Get all text generation models and sort them (newest/pro first)
                const models = (data.models || [])
                    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''))
                    .filter(m => m.includes('flash') || m.includes('pro'));
                
                if (models.length > 0) {
                    availableModels = models;
                }
                console.log('✅ Detected available fallback models:', availableModels.join(', '));
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
    
    let fullPrompt = `${systemPrompt}\n\n`;
    if (history && history.length > 0) {
        fullPrompt += "Conversation History:\n";
        const recentHistory = history.slice(-10);
        recentHistory.forEach(msg => {
            const role = msg.direction === 'incoming' ? 'Client' : 'You';
            fullPrompt += `${role}: ${msg.content}\n`;
        });
        fullPrompt += "\n";
    }
    fullPrompt += `Client: ${userMessage}\nYou:`;

    // Bulletproof Fallback: Try every single model until one works
    for (const modelName of availableModels) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(fullPrompt);
            console.log(`✅ Successfully generated reply using model: ${modelName}`);
            return result.response.text().trim();
        } catch (e) {
            console.error(`❌ Model ${modelName} rejected the request: ${e.message}`);
            // Continue to the next model in the list
        }
    }
    
    console.error("❌ ALL models failed to generate a reply.");
    return null;
}

module.exports = { initAI, generateReply };
