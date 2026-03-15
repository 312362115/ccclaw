import type { JwtPayload } from './auth/jwt.js';

// Hono 环境类型，定义 c.get/c.set 可用的变量
export type AppEnv = {
  Variables: {
    user: JwtPayload;
  };
};
