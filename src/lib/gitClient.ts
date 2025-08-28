import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CreatePROptions {
    title: string;
    body: string;
    branch?: string;
    type?: string;
    draft?: boolean;
}

export class GitClient {
    private token: string;

    constructor(token?: string) {
        this.token = token || Bun.env.GH_ACCESS_TOKEN!;
    }

    async cloneRepository(repoUrl: string, branch: string = 'main'): Promise<string> {
        const tempDir = `/app/tmp/repo-${Date.now()}`;
        await execAsync(`mkdir -p ${tempDir}`);

        try {
            const cloneUrl = this.buildCloneUrl(repoUrl, this.token);
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

    // GitHub API methods
    async fetchPRFiles(repoName: string, prNumber: number): Promise<any[]> {
        const response = await fetch(`https://api.github.com/repos/${repoName}/pulls/${prNumber}/files`, {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch PR files: ${response.statusText}`);
        }

        return await response.json();
    }

    async createPullRequest(repoName: string, options: CreatePROptions): Promise<string> {
        const branchName = options.branch || `starscream/${options.type || 'fix'}-${Date.now()}`;


        const defaultBranch = await this.getDefaultBranch(repoName);

        const response = await fetch(`https://api.github.com/repos/${repoName}/pulls`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: `🤖 ${options.title}`,
                body: options.body,
                head: branchName,
                base: defaultBranch,
                draft: options.draft !== false
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to create PR: ${response.statusText}`);
        }

        const pr = await response.json();
        return pr.html_url;
    }

    async replyToIssue(repoName: string, issueNumber: number, message: string): Promise<void> {
        const response = await fetch(`https://api.github.com/repos/${repoName}/issues/${issueNumber}/comments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ body: message })
        });

        if (!response.ok) {
            throw new Error(`Failed to reply to issue: ${response.statusText}`);
        }
    }

    async getDefaultBranch(repoName: string): Promise<string> {
        const response = await fetch(`https://api.github.com/repos/${repoName}`, {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get repo info: ${response.statusText}`);
        }

        const repo = await response.json();
        return repo.default_branch || 'main';
    }

    async createBranch(repoName: string, branchName: string, baseBranch?: string): Promise<void> {
        const base = baseBranch || await this.getDefaultBranch(repoName);

        // Get base branch SHA
        const refResponse = await fetch(`https://api.github.com/repos/${repoName}/git/refs/heads/${base}`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        if (!refResponse.ok) {
            throw new Error(`Failed to get base branch: ${refResponse.statusText}`);
        }

        const refData = await refResponse.json();

        // Create new branch
        await fetch(`https://api.github.com/repos/${repoName}/git/refs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ref: `refs/heads/${branchName}`,
                sha: refData.object.sha
            })
        });
    }
}

