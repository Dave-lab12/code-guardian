import { Glob } from 'bun';
import { Config } from '../config/config';
import type { BaseChunk, IntegrityReport } from '../types';

export class IntegrityChecker {
    private config: Config;

    constructor() {
        this.config = Config.getInstance();
    }

    async checkIntegrity(): Promise<IntegrityReport> {
        const appConfig = this.config.get();
        const schemaPath = this.config.getFullPath(
            appConfig.paths.chunksDir,
            appConfig.paths.schemaFile
        );

        console.log('🔍 Running integrity check...');

        const chunks: BaseChunk[] = JSON.parse(await Bun.file(schemaPath).text());
        console.log(`📋 Schema contains ${chunks.length} chunks`);

        const glob = new Glob(`**/*.txt`);
        const existingFiles: string[] = [];

        for await (const file of glob.scan(appConfig.paths.chunksDir)) {
            existingFiles.push(file.replace('.txt', ''));
        }

        console.log(`📁 Found ${existingFiles.length} content files`);

        const missingContent: BaseChunk[] = [];
        const validChunks: BaseChunk[] = [];

        for (const chunk of chunks) {
            const contentPath = this.config.getFullPath(
                appConfig.paths.chunksDir,
                `${chunk.hash}.txt`
            );
            const contentExists = await Bun.file(contentPath).exists();

            if (!contentExists) {
                missingContent.push(chunk);
            } else {
                validChunks.push(chunk);
            }
        }

        const usedHashes = new Set(chunks.map(c => c.hash.toString()));
        const orphanedFiles = existingFiles.filter(hash => !usedHashes.has(hash));

        this.logReport(validChunks, missingContent, orphanedFiles);

        return {
            validChunks,
            missingContent,
            orphanedFiles,
            isValid: missingContent.length === 0
        };
    }

    private logReport(
        validChunks: BaseChunk[],
        missingContent: BaseChunk[],
        orphanedFiles: string[]
    ): void {
        console.log('\n📊 INTEGRITY REPORT:');
        console.log(`✅ Valid chunks: ${validChunks.length}`);
        console.log(`❌ Missing content files: ${missingContent.length}`);
        console.log(`🗂️  Orphaned files: ${orphanedFiles.length}`);

        if (missingContent.length > 0) {
            console.log('\n❌ Missing content for these chunks:');
            missingContent.forEach(chunk => {
                console.log(`   - ${chunk.id} (hash: ${chunk.hash})`);
            });
        }

        if (orphanedFiles.length > 0) {
            console.log('\n🗂️  Orphaned files (no schema entry):');
            orphanedFiles.forEach(hash => {
                console.log(`   - ${hash}.txt`);
            });
        }
    }
}