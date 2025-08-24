import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../config/config';
import { Parser } from './parser';
import { OpenAIEmbedder } from './embed';

const execAsync = promisify(exec);

export class GitUpdater {
    private config: Config;

    constructor() {
        this.config = Config.getInstance();
    }

    async updateFromGit(repoUrl: string, branch: string = 'main', token?: string): Promise<any> {
        const tempDir = `/app/tmp/repo-${Date.now()}`;
        await execAsync(`mkdir -p ${tempDir}`);

        try {
            const cloneUrl = this.buildCloneUrl(repoUrl, token);

            console.log(`Cloning ${repoUrl} (${branch})...`);
            await execAsync(`git clone --depth 1 --branch ${branch} "${cloneUrl}" "${tempDir}"`);

            await this.cleanOldChunks();

            const parser = new Parser();
            console.log(`Parsing codebase in ${tempDir}...`);
            const chunks = await parser.chunkCodebase(tempDir);

            const embedder = new OpenAIEmbedder();
            await embedder.embedAllChunks();

            await execAsync(`rm -rf "${tempDir}"`);

            return {
                success: true,
                chunksCreated: chunks.length,
                repo: repoUrl,
                branch
            };

        } catch (error) {
            try {
                await execAsync(`rm -rf "${tempDir}"`);
            } catch { }

            throw error;
        }
    }

    private buildCloneUrl(repoUrl: string, token?: string): string {
        if (!token) {
            return repoUrl.startsWith('http') ? `${repoUrl}.git` : `https://${repoUrl}.git`;
        }

        const cleanUrl = repoUrl.replace('https://', '').replace('http://', '').replace('.git', '');
        return `https://${token}@${cleanUrl}.git`;
    }

    private async cleanOldChunks(): Promise<void> {
        const chunksDir = this.config.get().paths.chunksDir;
        try {
            await execAsync(`rm -rf ${chunksDir}/*.txt ${chunksDir}/*.json`);
            console.log('🧹 Cleaned old chunks');
        } catch {
            // Directory might not exist
            console.warn('⚠️ Chunks directory does not exist, skipping cleanup');
        }
    }
}
