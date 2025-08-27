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

    async storeChunks(chunks: BaseChunk[], contents: string[]): Promise<void> {

        const batchSize = 2000; // OpenAI's limit is 2048
        console.log(`Preparing to store ${chunks.length} chunks in batches of ${batchSize}.`);

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batchEnd = Math.min(i + batchSize, chunks.length);
            const currentBatchNumber = i / batchSize + 1;
            const totalBatches = Math.ceil(chunks.length / batchSize);

            console.log(`Storing batch ${currentBatchNumber} of ${totalBatches}...`);

            const chunkBatch = chunks.slice(i, batchEnd);
            const contentBatch = contents.slice(i, batchEnd);
            const ids = chunkBatch.map(chunk => chunk.id);
            const metadatas = chunkBatch.map(chunk => ({
                type: chunk.type,
                granularity: chunk.granularity,
                framework: chunk.metadata?.framework || 'unknown',
                ...chunk.metadata
            }));

            await this?.collection?.upsert({
                ids,
                documents: contentBatch,
                metadatas,
            });
            const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            if (currentBatchNumber < totalBatches) {
                await sleep(1000); // Wait for just 1000 milliseconds
            }
        }

        console.log(`Successfully stored all ${chunks.length} chunks in ChromaDB.`);
    }

    async queryChunks(query: string, nResults: number = 5, where?: any): Promise<any> {
        if (!this.collection) {
            throw new Error('Collection not initialized');
        }

        return await this.collection.query({
            queryTexts: [query],
            nResults,
            where
        });
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