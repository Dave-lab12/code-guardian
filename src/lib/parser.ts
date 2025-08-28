import { minimatch } from "minimatch";
import { ChromaManager } from "./chroma";
import { Glob } from "bun";
import { BaseChunk, FrameworkParserInterface, FrameworkPatterns } from "../types";
import { nanoid } from "nanoid";

export class Parser {
    private registrations: Array<{
        patterns: FrameworkPatterns,
        parser: FrameworkParserInterface
        knowledge?: string[]
    }> = [];

    private chromaManager: ChromaManager;

    constructor(chromaManager: ChromaManager) {
        this.chromaManager = chromaManager;
    }

    register(patterns: FrameworkPatterns, parser: FrameworkParserInterface, options?: { knowledge: string[] }): void {
        this.registrations.push({ patterns, parser, knowledge: options?.knowledge });
    }

    async chunkCodebase(targetDir: string): Promise<number> {
        const startTime = performance.now();
        await this.chromaManager.initializeCollection();

        const processedFiles = new Set<string>();
        const batchSize = 100;
        let totalChunks = 0;

        const allKnowledgeFiles = this.registrations.flatMap(reg => reg.knowledge || []);

        if (allKnowledgeFiles.length > 0) {
            const uniqueKnowledgeFiles = [...new Set(allKnowledgeFiles)];
            const knowledgeResults = await this.processKnowledgeFiles(uniqueKnowledgeFiles);
            await this.storeBatch(knowledgeResults, 'knowledge');
            totalChunks += knowledgeResults.length;
        }

        const batch: { chunk: BaseChunk, content: string }[] = [];

        for (const registration of this.registrations) {
            const sortedPatterns = Object.entries(registration.patterns)
                .sort(([, a], [, b]) => (b.priority || 0) - (a.priority || 0));

            for (const [key, config] of sortedPatterns) {
                const glob = new Glob(`${targetDir.replace(/\/$/, '')}/${config.pattern}`);
                for await (const file of glob.scan(".")) {
                    if (processedFiles.has(file)) continue;
                    if (this.isExcluded(file, config.exclude)) continue;

                    try {
                        const results = await registration.parser.parseFile(file, config);
                        batch.push(...results.filter(r => r.chunk && r.content?.length > 0));
                        processedFiles.add(file);

                        if (batch.length >= batchSize) {
                            await this.storeBatch(batch, `batch-${Math.floor(totalChunks / batchSize) + 1}`);
                            totalChunks += batch.length;
                            batch.length = 0;
                        }
                    } catch (error) {
                        console.warn(`Failed to parse ${file}:`, error);
                    }
                }
            }
        }

        if (batch.length > 0) {
            await this.storeBatch(batch, 'final');
            totalChunks += batch.length;
        }

        const duration = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`Processed ${totalChunks} chunks in ${duration}s (${(totalChunks / parseFloat(duration)).toFixed(1)} chunks/sec)`);

        return totalChunks;
    }
    private async storeBatch(results: { chunk: BaseChunk, content: string }[], label: string) {
        if (results.length === 0) return;

        const storeStart = performance.now();
        const chunks = results.map(r => r.chunk);
        const contents = results.map(r => r.content);

        await this.chromaManager.storeChunks(chunks, contents);

        const storeDuration = ((performance.now() - storeStart) / 1000).toFixed(2);
        console.log(`📦 Stored ${results.length} chunks (${label}) in ${storeDuration}s`);
    }

    private async processKnowledgeFiles(filePaths: string[]): Promise<{ chunk: BaseChunk, content: string }[]> {
        const results: { chunk: BaseChunk, content: string }[] = [];
        const MAX_CHUNK_SIZE = 4000; // Characters ~1000 tokens

        for (const filePath of filePaths) {
            const content = await Bun.file(filePath).text();

            // Split by sections 
            const sections = content.split(/(?=^#{1,3} )/gm);

            for (const section of sections) {
                if (section.length <= MAX_CHUNK_SIZE) {
                    results.push({
                        chunk: {
                            id: nanoid(),
                            type: 'knowledge',
                            granularity: 'document',
                            metadata: { source: filePath }
                        },
                        content: section
                    });
                } else {
                    // Split large sections into paragraphs
                    const paragraphs = section.split(/\n\n+/);
                    let buffer = '';

                    for (const para of paragraphs) {
                        if (buffer.length + para.length > MAX_CHUNK_SIZE && buffer) {
                            results.push({
                                chunk: {
                                    id: nanoid(),
                                    type: 'knowledge',
                                    granularity: 'document',
                                    metadata: { source: filePath }
                                },
                                content: buffer
                            });
                            buffer = para;
                        } else {
                            buffer += (buffer ? '\n\n' : '') + para;
                        }
                    }

                    if (buffer) {
                        results.push({
                            chunk: {
                                id: nanoid(),
                                type: 'knowledge',
                                granularity: 'document',
                                metadata: { source: filePath }
                            },
                            content: buffer
                        });
                    }
                }
            }
        }
        return results;
    }

    private isExcluded(file: string, excludePatterns?: string[]): boolean {
        if (!excludePatterns) return false;
        return excludePatterns.some(pattern => minimatch(file, pattern));
    }
}