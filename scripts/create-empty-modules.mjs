// Helper script to scaffold empty NestJS module files for the foundation
// task. Not run during normal builds.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src/modules');

const modules = [
  'users',
  'sellers',
  'drivers',
  'listings',
  'orders',
  'deliveries',
  'payments',
  'wallets',
  'subscriptions',
  'reviews',
  'messaging',
  'notifications',
  'moderation',
  'catalog',
  'search',
  'geo',
  'files',
  'compliance',
  'boosts',
];

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, body);
}

for (const name of modules) {
  const dir = path.join(root, name);
  const Pascal = pascal(name);
  const ClassName = `${Pascal}Module`;
  write(
    path.join(dir, `${name}.module.ts`),
    `import { Module } from '@nestjs/common';\n\n@Module({})\nexport class ${ClassName} {}\n`,
  );
}

write(
  path.join(root, 'admin/admin.module.ts'),
  `import { Module } from '@nestjs/common';\n\n@Module({})\nexport class AdminModule {}\n`,
);

console.log('Empty module files generated.');
