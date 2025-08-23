import OpenAI from 'openai';
import { Config } from '../config/config';
import { BaseChunk, ChunkWithEmbedding, SearchResult } from '../types';

export class ChunkSearcher {
    private chunks: BaseChunk[] = [];
    private embeddings: ChunkWithEmbedding[] = [];
    private openai: OpenAI;
    private config: Config;

    constructor() {
        this.config = Config.getInstance();
        this.openai = new OpenAI({
            apiKey: Bun.env.OPENAI_API_KEY
        });
    }

    async init(): Promise<void> {
        const appConfig = this.config.get();

        const schemaPath = this.config.getFullPath(
            appConfig.paths.chunksDir,
            appConfig.paths.schemaFile
        );

        const embeddingsPath = this.config.getFullPath(
            appConfig.paths.chunksDir,
            appConfig.paths.embeddingsFile
        );

        this.chunks = JSON.parse(await Bun.file(schemaPath).text());
        this.embeddings = JSON.parse(await Bun.file(embeddingsPath).text());
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    private async embedQuery(query: string): Promise<number[]> {
        const appConfig = this.config.get();
        const response = await this.openai.embeddings.create({
            model: appConfig.embedding.model,
            input: query
        });
        return response.data[0].embedding;
    }

    async findSimilarChunks(query: string, topK: number = 5): Promise<SearchResult[]> {
        const queryEmbedding = await this.embedQuery(query);

        const similarities: SearchResult[] = this.embeddings.map(chunk => ({
            ...chunk,
            similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding)
        }));

        return similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    async getChunkContent(hash: string | number): Promise<string> {
        const appConfig = this.config.get();
        const contentPath = this.config.getFullPath(
            appConfig.paths.chunksDir,
            `${hash}.txt`
        );
        return await Bun.file(contentPath).text();
    }
}

// const searcher = new ChunkSearcher();
// await searcher.init();

const testQueries = [
    "svelte component with props",
    "handle form submission",
    "type definition interface",
    "error handling try catch",
    "user authentication login"
];

// for (const query of testQueries) {
//     console.log(`\n🔍 Query: "${query}"`);
//     const results = await searcher.findSimilarChunks(query, 3);
//     results.forEach((r, i) => {
//         console.log(`  ${i + 1}. ${r.type} (${r.similarity.toFixed(3)}) - Hash: ${r.hash}`);
//     });
// }
