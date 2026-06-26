import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const aiStudio = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const openRouter = OPENROUTER_API_KEY ? new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com",
        "X-Title": "X-Bot",
    }
}) : null;

app.post('/analyze', async (req: any, res: any) => {
    const { text, link } = req.body; 
    
    if (!text) return res.status(400).json({ error: "No text provided" });

    console.log("📥 Received batch. Processing with AI...");

    // SAFE PROMPT: Using standard single quotes for the string to avoid backtick issues
    const prompt = 'You are a social media manager. Analyze these tweets and provide a short, trendy reply for each. CRITICAL: Wrap each reply in single backticks so they are easy to copy. Tweets: ' + text;

    try {
        let reply = ""; 

        if (aiStudio) {
            console.log("Routing to Gemini...");
            const model = aiStudio.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            reply = result.response.text();
        } else if (openRouter) {
            console.log("Routing to OpenRouter...");
            const response = await openRouter.chat.completions.create({
                model: "deepseek/deepseek-chat",
                messages: [{ role: "user", content: prompt }]
            });
            reply = response.choices[0].message.content || "";
        } else {
            throw new Error("No AI providers configured.");
        }

        const message = '📦 *Batch Processed!*\n\n' + reply + '\n\n🔗 *Reference:* ' + link;
        
        await fetch(https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                chat_id: TELEGRAM_CHAT_ID, 
                text: message,
                parse_mode: "Markdown"
            })
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Error processing batch", err);
        res.status(500).json({ error: "Failed" });
    }
});

app.listen(port, () => console.log(🧠 Brain Server Listening on ${port}`));
