import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

// --- Load Secrets ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// --- Initialize AI Providers ---
const aiStudio = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const openRouter = OPENROUTER_API_KEY ? new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com", // Required by OpenRouter
        "X-Title": "X-Bot",
    }
}) : null;

app.post('/analyze', async (req: any, res: any) => {
    const { batch } = req.body;
    if (!batch || batch.length === 0) return res.status(400).json({ error: "No batch provided" });

    console.log("📥 Received batch of 20 tweets. Processing...");

    // Format the 20 tweets for the AI
    const prompt = `You are a social media manager. Analyze these 20 tweets and provide a short, trendy reply for each. Number them 1-20:\n${JSON.stringify(batch)}`;
    
    try {
        let reply = "";

        // 1. Try Gemini First
        if (aiStudio) {
            console.log("Routing to Gemini...");
            const model = aiStudio.getGenerativeModel({ model: "gemini-2.5-flash" });
            const result = await model.generateContent(prompt);
            reply = result.response.text();
        } 
        // 2. Fallback to OpenRouter (DeepSeek) if Gemini isn't available
        else if (openRouter) {
            console.log("Routing to OpenRouter (DeepSeek)...");
            const response = await openRouter.chat.completions.create({
                model: "deepseek/deepseek-chat:free",
                messages: [{ role: "user", content: prompt }]
            });
            reply = response.choices[0].message.content || "";
        } else {
            throw new Error("No AI providers configured.");
        }

        // Send the massive batch reply to Telegram
        const message = `📦 *Batch of 20 Processed!*\n\n${reply}\n\n🔗 *Reference Link (Tweet 1):* ${batch[0].link}`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Error processing batch", err);
        res.status(500).json({ error: "Failed" });
    }
});

app.listen(8080, () => console.log("🧠 Batch Server Listening on 8080"));
