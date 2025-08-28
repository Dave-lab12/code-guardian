import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { Config } from './config/config';
import { githubAuth } from './middleware/auth';

import { CodeReviewer, PromptLoader, Parser, GitClient, AssistantService } from './lib'
import { ChromaManager } from './lib/chroma';
import { SvelteKitParser, sveltekitPatterns } from './frameworks/sveltekit';

const app = new Hono()

app.use('*', cors());
app.use('*', logger());
app.use('*', githubAuth);

app.get('/', async (c) => {
  return c.json({
    status: 'healthy',
    service: 'Code Review API',
    timestamp: new Date().toISOString()
  });
});


app.post('/update-codebase', async (c) => {
  try {
    const body = await c.req.json();
    const { repoUrl, branch = 'main', token } = body;
    const config = Config.getInstance();
    if (!repoUrl) {
      return c.json({ success: false, error: 'repoUrl is required' }, 400);
    }

    const accessToken = token || Bun.env.GH_ACCESS_TOKEN
    const gitClient = new GitClient(accessToken);
    const repoPath = await gitClient.cloneRepository(repoUrl, branch);

    const chromaManager = new ChromaManager();
    await chromaManager.initializeCollection();
    await chromaManager.clearCollection();

    const parser = new Parser(chromaManager);

    parser.register(sveltekitPatterns, new SvelteKitParser(), {
      knowledge: [
        `${config.get().paths.promptsDir}/svelte5.txt`
      ]
    })

    const chunksCreated = await parser.chunkCodebase(repoPath)

    console.log(`Chunks created: ${chunksCreated}`);

    return c.json({
      success: true,
      message: 'Codebase updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {

    console.error('Error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update codebase'
    }, 500);
  }
});

app.post('/review', async (c) => {
  try {
    const body = await c.req.json();
    const { changedCode, description, fileName, files } = body;

    let codeToReview = '';
    let fileNames = [];

    if (files && Array.isArray(files)) {
      fileNames = files.map(f => f.fileName);
      codeToReview = files.map(f =>
        `\n=== File: ${f.fileName} ===\n${f.changedCode}`
      ).join('\n\n');

      console.log(`Processing PR review for ${files.length} files`);
    } else if (changedCode) {

      codeToReview = changedCode;
      fileNames = [fileName || 'Unknown'];

      console.log(`Processing PR review for: ${fileName}`);
    } else {
      return c.json({
        success: false,
        error: 'No code to review. Provide either "files" array or "changedCode"'
      }, 400);
    }

    if (!codeToReview) {
      return c.json({
        success: false,
        error: 'No code changes found'
      }, 400);
    }

    console.log('Finding relevant code context...')

    const chromaManager = new ChromaManager();
    await chromaManager.initializeCollection();
    const relevantChunks = await chromaManager.queryChunks(codeToReview, 10);

    const reviewer = new CodeReviewer();
    const contextString = reviewer.formatContext(relevantChunks);

    const config = Config.getInstance();

    const promptPath = config.getFullPath(
      config.get().paths.promptsDir,
      'review.txt'
    );

    const prompt = await PromptLoader.loadPrompt(promptPath, {
      fileName: fileName || 'Unknown file',
      description: description || 'No description provided',
      changedCode: codeToReview,
      context: contextString
    });
    const review = await reviewer.generateReview(prompt);

    return c.json({
      success: true,
      review,
      relevantContext: relevantChunks.map(chunk => ({
        type: chunk.type,
        similarity: chunk.similarity,
        preview: chunk.content?.slice(0, 100) + '...'
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reviewing PR:', error)
    return c.json({
      success: false,
      error: 'Failed to review PR',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

app.post('/webhook', async (c) => {
  try {
    const event = c.req.header('x-github-event');
    const body = await c.req.json();

    console.log(`GitHub webhook: ${event}`);

    if (event === 'issue_comment' && body.action === 'created') {
      const comment = body.comment.body;
      const mention = comment.match(/@(\w+)\s+(.+)/);

      if (mention && mention[1] === 'starscream') {
        const command = mention[2];
        const assistant = new AssistantService();
        await assistant.processCommand(command, body);
      }
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({ error: 'Webhook failed' }, 500);
  }
});

export default app
