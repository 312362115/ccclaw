import { db, schema } from './index.js';
import { hashPassword } from '../auth/password.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { eq } from 'drizzle-orm';

async function seed() {
  // 1. Seed admin 用户
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const existing = await db.select().from(schema.users)
      .where(eq(schema.users.email, config.ADMIN_EMAIL)).limit(1);

    if (existing.length === 0) {
      await db.insert(schema.users).values({
        name: 'Admin',
        email: config.ADMIN_EMAIL,
        password: await hashPassword(config.ADMIN_PASSWORD),
        role: 'admin',
      });
      logger.info('Admin 用户创建成功');
    } else {
      logger.info('Admin 用户已存在，跳过');
    }
  } else {
    logger.warn('ADMIN_EMAIL 和 ADMIN_PASSWORD 未设置，跳过 admin seed');
  }

  // Provider 由用户在 Web 界面自行配置，seed 不预置

  process.exit(0);
}

seed().catch((err) => {
  logger.error(err, 'Seed 失败');
  process.exit(1);
});
