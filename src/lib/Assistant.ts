import { CodeReviewer, AssistantContext, AssistantResponse } from './review';
import { GitClient } from './gitClient';
import { ChromaManager } from './chroma';

export class AssistantService {
    private reviewer: CodeReviewer;
    private gitClient: GitClient;
    private chromaManager: ChromaManager;

    constructor() {
        this.reviewer = new CodeReviewer();
        this.gitClient = new GitClient();
        this.chromaManager = new ChromaManager();
    }

    async processCommand(command: string, webhookData: any): Promise<void> {
        const { repository, issue, comment } = webhookData;

        try {
            await this.gitClient.replyToIssue(
                repository.full_name,
                issue.number,
                `Processing: "${command}"`
            );

            const context = await this.buildContext(command, webhookData);

            const response = await this.reviewer.generateAssistantResponse(command, context);

            await this.handleResponse(response, webhookData);

        } catch (error) {
            console.error('Assistant command failed:', error);
            await this.gitClient.replyToIssue(
                repository.full_name,
                issue.number,
                `Failed to process: ${error.message}`
            );
        }
    }

    private async buildContext(command: string, webhookData: any): Promise<AssistantContext> {
        const { repository, issue } = webhookData;

        const prFiles = issue.pull_request ?
            await this.gitClient.fetchPRFiles(repository.full_name, issue.number) :
            undefined;

        await this.chromaManager.initializeCollection();
        const relevantChunks = await this.chromaManager.queryChunks(
            `${command} ${issue.title} ${issue.body || ''}`,
            10
        );

        return {
            issue: {
                title: issue.title,
                body: issue.body,
                number: issue.number
            },
            prFiles,
            relevantChunks
        };
    }

    private async handleResponse(response: AssistantResponse, webhookData: any): Promise<void> {
        const { repository, issue } = webhookData;

        let parsedResponse = response;
        if (response && response.type === 'text' && typeof response.data === 'string') {
            const jsonMatch = response.data.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                try {
                    const parsedData = JSON.parse(jsonMatch[1]);
                    console.log('Parsed JSON from markdown:', parsedData);
                    parsedResponse = {
                        type: 'structured',
                        data: parsedData
                    };
                } catch (error) {
                    console.error('Failed to parse JSON from markdown:', error);
                }
            }
        }


        if (parsedResponse.type === 'structured' && parsedResponse.data.action) {
            switch (parsedResponse.data.action) {
                case 'create_pr':
                    await this.createPRResponse(parsedResponse.data, repository, issue);
                    break;
                case 'comment_only':
                    await this.createCommentResponse(parsedResponse.data, repository, issue);
                    break;
                case 'needs_info':
                    await this.requestMoreInfo(parsedResponse.data, repository, issue);
                    break;
                default:
                    await this.createCommentResponse(parsedResponse.data, repository, issue);
            }
        } else {
            await this.createCommentResponse(parsedResponse, repository, issue);
        }
    }
    private async createPRResponse(data: any, repository: any, issue: any): Promise<void> {
        const prUrl = await this.gitClient.createPullRequest(repository.full_name, {
            title: data.title,
            body: `${data.description}\n\nCloses #${issue.number}`,
            type: 'fix'
        });

        // Only comment about the PR, don't double-comment
        await this.gitClient.replyToIssue(
            repository.full_name,
            issue.number,
            `✅ ${data.message || 'Created fix PR'}: ${prUrl}`
        );
    }

    private async createCommentResponse(data: any, repository: any, issue: any): Promise<void> {
        const message = typeof data === 'string' ? data : data.message || data.analysis;
        await this.gitClient.replyToIssue(
            repository.full_name,
            issue.number,
            `🤖 ${message}`
        );
    }
    private async requestMoreInfo(data: any, repository: any, issue: any): Promise<void> {
        await this.gitClient.replyToIssue(
            repository.full_name,
            issue.number,
            `🤔 ${data.message}\n\n${data.questions?.map(q => `- ${q}`).join('\n') || ''}`
        );
    }

}