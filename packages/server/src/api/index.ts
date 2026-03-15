import { Hono } from 'hono';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { workspacesRouter } from './workspaces.js';

export const api = new Hono();

api.route('/auth', authRouter);
api.route('/users', usersRouter);
api.route('/workspaces', workspacesRouter);
