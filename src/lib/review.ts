import { GoogleGenAI } from '@google/genai';
import { SearchResult } from '../types';

export class CodeReviewer {
    private ai: GoogleGenAI;

    constructor() {
        this.ai = new GoogleGenAI({
            apiKey: Bun.env.GOOGLE_API_KEY
        });
    }

    formatContext(relevantChunks: SearchResult[]): string {
        return relevantChunks.map((chunk) => {
            const preview = chunk.content ? chunk.content.slice(0, 500) : '';
            return `### Similar ${chunk.type} (similarity: ${chunk.similarity.toFixed(3)})
  \`\`\`
  ${preview}
  \`\`\``;
        }).join('\n');
    }

    async generateReview(prompt: string): Promise<string> {
        console.log("🤖 Generating review with Gemini...");

        try {
            const response = await this.ai.models.generateContent({
                model: Bun.env.GOOGLE_MODEL || 'gemini-2.5-flash',
                contents: prompt,
            });

            const reviewText = response.text || 'No review generated';
            console.log("Review generated successfully");
            return reviewText;
        } catch (error) {
            console.error("Error generating review:", error);
            throw new Error('Failed to generate review');
        }
    }
}