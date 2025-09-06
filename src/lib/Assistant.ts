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

            const response = await this.reviewer.generateStructuredAssistantResponse(command, context);

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

        console.log('Handling structured response:', {
            responseType: response?.type,
            action: response?.data?.action,
            hasMessage: !!response?.data?.message
        });

        if (response && response.type === 'structured' && response.data && response.data.action) {
            switch (response.data.action) {
                case 'create_pr':
                    await this.createPRResponse(response.data, repository, issue);
                    break;
                case 'comment_only':
                    await this.createCommentResponse(response.data, repository, issue);
                    break;
                case 'needs_info':
                    await this.requestMoreInfo(response.data, repository, issue);
                    break;
                case 'error':
                    await this.createErrorResponse(response.data, repository, issue);
                    break;
                default:
                    console.log('Unknown action, defaulting to comment response');
                    await this.createCommentResponse(response.data, repository, issue);
            }
        } else {
            console.log('Invalid response structure, creating fallback response');
            await this.createFallbackResponse(response, repository, issue);
        }
    }

    private async createErrorResponse(data: any, repository: any, issue: any): Promise<void> {
        try {
            await this.gitClient.replyToIssue(
                repository.full_name,
                issue.number,
                `⚠️ ${data.message}\n\n${data.analysis ? `Details: ${data.analysis}` : ''}`
            );
        } catch (error) {
            console.error('Failed to create error response:', error);
        }
    }

    private async createFallbackResponse(response: any, repository: any, issue: any): Promise<void> {
        try {
            await this.gitClient.replyToIssue(
                repository.full_name,
                issue.number,
                `🤖 I processed your request but encountered an issue with the response format. Please try rephrasing your command.`
            );
        } catch (error) {
            console.error('Failed to create fallback response:', error);
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