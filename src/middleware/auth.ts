import { Context, Next } from 'hono';

export async function githubAuth(c: Context, next: Next) {
    const githubSecret = Bun.env.GITHUB_SECRET_KEY;
    const isDev = Bun.env.NODE_ENV === 'development';

    if (!githubSecret || isDev) {
        // If no dev mode, allow all requests
        return next();
    }

    const authHeader = c.req.header('x-github-secret');

    if (authHeader !== githubSecret) {
        return c.json({
            success: false,
            error: 'Unauthorized'
        }, 401);
    }

    return next();
}
