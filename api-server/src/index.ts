import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());
app.use(cors());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const ai = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/analyze', async (req: any, res: any) => {
    const { batch } = req.body;
    if (!batch || batch.length === 0) return res.status(400).json({ error: "No batch provided" });

    // Format the 20 tweets for the AI
    const prompt = `Analyze these 20 tweets and provide a short, trendy reply for each. Number them 1-20:\n${JSON.stringify(batch)}`;
    
    try {
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const reply = result.response.text();

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
