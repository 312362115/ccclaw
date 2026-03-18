import { Hono } from 'hono';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { workspacesRouter } from './workspaces.js';
import { sessionsRouter } from './sessions.js';
import { memoriesRouter } from './memories.js';
import { skillsRouter } from './skills.js';
import { providersRouter } from './providers.js';
import { tasksRouter } from './tasks.js';
import { logsRouter } from './logs.js';
import { dashboardRouter } from './dashboard.js';
import { inviteCodesRouter } from './invite-codes.js';
import { preferencesRouter } from './preferences.js';
import { adminRouter } from './admin.js';
import { oauthRouter } from './oauth.js';
import { runnerInfoRoute } from './runner-info.js';
import { skillMarketplaceRouter } from './skill-marketplace.js';

export const api = new Hono();

api.route('/auth', authRouter);
api.route('/oauth', oauthRouter);
api.route('/users', usersRouter);
api.route('/workspaces', workspacesRouter);
api.route('/workspaces', sessionsRouter);    // /api/workspaces/:id/sessions
api.route('/workspaces', memoriesRouter);    // /api/workspaces/:id/memories
api.route('/workspaces', tasksRouter);       // /api/workspaces/:id/tasks
api.route('/skills', skillsRouter);
api.route('/marketplace', skillMarketplaceRouter);
api.route('/providers', providersRouter);
api.route('/logs', logsRouter);
api.route('/dashboard', dashboardRouter);
api.route('/invite-codes', inviteCodesRouter);
api.route('/settings/preferences', preferencesRouter);
api.route('/admin', adminRouter);
api.route('/', runnerInfoRoute);          // /api/workspaces/:id/runner-info
