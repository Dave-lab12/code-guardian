import { minimatch } from "minimatch";
import { ChromaManager } from "./chroma";
import { Glob } from "bun";
import { BaseChunk, FrameworkParserInterface, FrameworkPatterns } from "../types";

export class Parser {
    private registrations: Array<{
        patterns: FrameworkPatterns,
        parser: FrameworkParserInterface
    }> = [];

    private chromaManager: ChromaManager;

    constructor(chromaManager: ChromaManager) {
        this.chromaManager = chromaManager;
    }

    register(patterns: FrameworkPatterns, parser: FrameworkParserInterface): void {
        this.registrations.push({ patterns, parser });
    }
    async chunkCodebase(targetDir: string): Promise<number> {
        await this.chromaManager.initializeCollection();

        const processedFiles = new Set<string>();
        const allResults: { chunk: BaseChunk, content: string }[] = [];

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
                        allResults.push(...results);
                        processedFiles.add(file);
                    } catch (error) {
                        console.warn(`Failed to parse ${file}:`, error);
                    }
                }
            }
        }

        if (allResults.length > 0) {
            const cleanResult = allResults.filter(r => r.chunk && r.content && r.content.length > 0);
            const chunks = cleanResult.map(r => r.chunk)
            const contents = cleanResult.map(r => r.content)

            await this.chromaManager.storeChunks(chunks, contents);
        }

        return allResults.length;
    }

    private isExcluded(file: string, excludePatterns?: string[]): boolean {
        if (!excludePatterns) return false;
        return excludePatterns.some(pattern => minimatch(file, pattern));
    }

}