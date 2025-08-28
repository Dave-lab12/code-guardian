import { ChromaClient, Collection } from 'chromadb';
import { OpenAIEmbeddingFunction } from "@chroma-core/openai";

import { BaseChunk } from '../types';
import { Config } from '../config/config';

export class ChromaManager {
    private client: ChromaClient;
    private collection: Collection | null = null;
    private embeddingFunction: OpenAIEmbeddingFunction;

    constructor() {
        this.embeddingFunction = new OpenAIEmbeddingFunction({
            apiKey: Bun.env.OPENAI_API_KEY,
            modelName: Config.getInstance().get().embedding.model
        })
        const urlString = Bun.env.CHROMA_URL || 'http://localhost:8000';
        const url = new URL(urlString);

        this.client = new ChromaClient({
            host: url.hostname,
            port: parseInt(url.port, 10),
        });

    }

    async initializeCollection(collectionName: string = 'code_chunks'): Promise<void> {
        this.collection = await this.client.getOrCreateCollection({
            name: collectionName,
            metadata: {
                description: 'Code chunks with framework-aware context'
            },
            embeddingFunction: this.embeddingFunction
        });
        console.log(`Collection '${collectionName}' ready`);
    }

    async upsertCollection(collectionName: string = 'code_chunks'): Promise<void> {
        try {
            await this.client.deleteCollection({ name: collectionName });
        } catch { } // Collection might not exist

        this.collection = await this.client.createCollection({
            name: collectionName,
            embeddingFunction: this.embeddingFunction,
            metadata: { 'hnsw:space': 'cosine' }
        });
    }

    async storeChunks(chunks: BaseChunk[], contents: string[]): Promise<void> {
        const MAX_BATCH_SIZE = 100;
        const MAX_TOKEN_ESTIMATE = 8000;

        let currentBatch = [];
        let currentContents = [];
        let tokenEstimate = 0;

        for (let i = 0; i < chunks.length; i++) {
            const estimatedTokens = Math.ceil(contents[i].length / 4);

            if (tokenEstimate + estimatedTokens > MAX_TOKEN_ESTIMATE ||
                currentBatch.length >= MAX_BATCH_SIZE) {
                await this.processBatch(currentBatch, currentContents);
                currentBatch = [];
                currentContents = [];
                tokenEstimate = 0;
                await Bun.sleep(1000); // Rate limit
            }

            currentBatch.push(chunks[i]);
            currentContents.push(contents[i]);
            tokenEstimate += estimatedTokens;
        }

        if (currentBatch.length > 0) {
            await this.processBatch(currentBatch, currentContents);
        }
    }
    private async processBatch(chunks: BaseChunk[], contents: string[]): Promise<void> {
        const ids = chunks.map(c => c.id) as string[];
        const metadatas = chunks.map(c => ({
            type: c.type,
            granularity: c.granularity,
            ...c.metadata
        }));

        await this.collection?.upsert({ ids, documents: contents, metadatas });
    }



    async queryChunks(query: string, nResults: number = 5, where?: any): Promise<any[]> {
        if (!this.collection) {
            throw new Error('Collection not initialized');
        }

        const rawChromaResult = await this.collection.query({
            queryTexts: [query],
            nResults,
            where
        });

        if (!rawChromaResult || !rawChromaResult.ids || rawChromaResult.ids.length === 0) {
            return [];
        }

        return rawChromaResult.ids[0].map((id, index) => ({
            id: id,
            content: rawChromaResult.documents[0][index],
            ...rawChromaResult.metadatas[0][index],
            similarity: 1 - rawChromaResult?.distances?.[0]?.[index]
        }));
    }

    async clearCollection(): Promise<void> {
        if (!this.collection) return;
        console.log("Clearing collection...")
        console.log(this.collection.name)

        await this.client.deleteCollection({ name: this.collection.name });
        // await this.initializeCollection(this.collection.name);
    }

    async getCollectionStats(): Promise<{ count: number }> {
        if (!this.collection) return { count: 0 };

        const count = await this.collection.count();
        return { count };
    }
}