import { exec } from 'child_process';
import { promisify } from 'util';


const execAsync = promisify(exec);

export class GitClient {
    async cloneRepository(repoUrl: string, branch: string = 'main', token?: string): Promise<string> {
        const tempDir = `/app/tmp/repo-${Date.now()}`;
        await execAsync(`mkdir -p ${tempDir}`);

        try {
            const cloneUrl = this.buildCloneUrl(repoUrl, token);
            console.log(`Cloning ${repoUrl} (${branch})...`);
            await execAsync(`git clone --depth 1 --branch ${branch} "${cloneUrl}" "${tempDir}"`);
            return tempDir;
        } catch (error) {
            await this.cleanup(tempDir);
            throw error;
        }
    }

    async cleanup(dir: string): Promise<void> {
        await execAsync(`rm -rf "${dir}"`);
    }

    private buildCloneUrl(repoUrl: string, token?: string): string {
        if (!token) {
            return repoUrl.startsWith('http') ? `${repoUrl}.git` : `https://${repoUrl}.git`;
        }

        const cleanUrl = repoUrl.replace('https://', '').replace('http://', '').replace('.git', '');
        return `https://${token}@${cleanUrl}.git`;
    }
}