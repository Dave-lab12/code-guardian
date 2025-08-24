import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { Config } from './config/config';
import { githubAuth } from './middleware/auth';

import { ChunkSearcher, CodeReviewer, PromptLoader, IntegrityChecker, GitUpdater } from './lib'

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

    if (!repoUrl) {
      return c.json({ success: false, error: 'repoUrl is required' }, 400);
    }

    const updater = new GitUpdater();
    const accessToken = token || Bun.env.GITHUB_ACCESS_TOKEN
    const result = await updater.updateFromGit(repoUrl, branch, accessToken);

    const integrityChecker = new IntegrityChecker();
    const integrityReport = await integrityChecker.checkIntegrity();

    return c.json({
      success: true,
      message: 'Codebase updated successfully',
      stats: {
        validChunks: integrityReport.validChunks.length,
        missingContent: integrityReport.missingContent.length,
        orphanedFiles: integrityReport.orphanedFiles.length
      },
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error);
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

    const searcher = new ChunkSearcher();
    await searcher.init();

    console.log('Finding relevant code context...')
    const relevantChunks = await searcher.findSimilarChunks(changedCode, 5);


    for (const chunk of relevantChunks) {
      chunk.content = await searcher.getChunkContent(chunk.hash);
    }

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
      changedCode: changedCode,
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

export default app
