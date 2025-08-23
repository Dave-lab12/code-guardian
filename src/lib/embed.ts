import OpenAI from 'openai';
import { Config } from '../config/config';
import type { BaseChunk, ChunkWithEmbedding } from '../types';

export class OpenAIEmbedder {
    private openai: OpenAI;
    private config: Config;

    constructor() {
        this.config = Config.getInstance();
        this.openai = new OpenAI({
            apiKey: Bun.env.OPENAI_API_KEY
        });
    }

    async embedText(text: string): Promise<number[]> {
        const appConfig = this.config.get();
        const response = await this.openai.embeddings.create({
            model: appConfig.embedding.model,
            input: text
        });
        return response.data[0].embedding;
    }

    async embedAllChunks(): Promise<ChunkWithEmbedding[]> {
        const appConfig = this.config.get();
        const schemaPath = this.config.getFullPath(
            appConfig.paths.chunksDir,
            appConfig.paths.schemaFile
        );

        const chunks: BaseChunk[] = JSON.parse(
            await Bun.file(schemaPath).text()
        );

        const embeddings: ChunkWithEmbedding[] = [];
        console.log(`🔥 Embedding ${chunks.length} chunks with OpenAI...`);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            try {
                const contentPath = this.config.getFullPath(
                    appConfig.paths.chunksDir,
                    `${chunk.hash}.txt`
                );
                const content = await Bun.file(contentPath).text();

                console.log(`📝 Embedding chunk ${i + 1}/${chunks.length}: ${chunk.type}`);
                const embedding = await this.embedText(content);

                embeddings.push({
                    ...chunk,
                    embedding,
                    contentLength: content.length
                });

                // Rate limiting
                if (i % appConfig.embedding.batchSize === 0 && i > 0) {
                    console.log(`⏳ Processed ${i} chunks, pausing briefly...`);
                    await new Promise(resolve => setTimeout(resolve, appConfig.embedding.rateLimitDelay));
                }

            } catch (error) {
                console.error(`❌ Failed to embed chunk ${chunk.id}:`, error);
            }
        }

        await this.saveEmbeddings(embeddings);
        this.logCostEstimate(embeddings);

        return embeddings;
    }

    private async saveEmbeddings(embeddings: ChunkWithEmbedding[]): Promise<void> {
        const appConfig = this.config.get();
        const embeddingsPath = this.config.getFullPath(
            appConfig.paths.chunksDir,
            appConfig.paths.embeddingsFile
        );

        await Bun.write(embeddingsPath, JSON.stringify(embeddings, null, 2));
        console.log(`✅ Saved ${embeddings.length} embeddings to ${embeddingsPath}`);
    }

    private logCostEstimate(embeddings: ChunkWithEmbedding[]): void {
        const tokensUsed = embeddings.reduce((sum, e) => sum + Math.ceil(e.contentLength / 4), 0);
        const cost = (tokensUsed / 1000) * 0.00002; // $0.00002 per 1K tokens
        console.log(`💰 Estimated cost: ~$${cost.toFixed(4)} (${tokensUsed} tokens)`);
    }
}

// lib/ChunkSearcher.ts



// lib/PromptLoader.ts

// const parser = new Parser();
// const embedder = new OpenAIEmbedder();
// await embedder.embedAllChunks();

// await parser.chunkCodebase('/contents/mindplex');