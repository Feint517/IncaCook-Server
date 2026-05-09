import { Prisma } from '@prisma/client';

/**
 * Models that opt into soft delete. Each must have a nullable `deletedAt`
 * column declared in schema.prisma.
 */
const SOFT_DELETE_MODELS = ['User', 'Listing'] as const;
type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

const isSoftDeleteModel = (model: string | undefined): model is SoftDeleteModel =>
  Boolean(model) && (SOFT_DELETE_MODELS as readonly string[]).includes(model as string);

/**
 * Adds `{ deletedAt: null }` to the where-clause of read queries against
 * soft-delete models. Re-routes `delete` / `deleteMany` to UPDATE statements
 * that set `deletedAt = now()`.
 *
 * Caveats:
 * - `findUnique` is intentionally NOT filtered. Adding `deletedAt: null` to a
 *   unique-only where breaks Prisma's unique-constraint dispatch. Treat
 *   `findUnique` as an admin/internal lookup that returns soft-deleted rows
 *   too. Use `findFirst` for user-facing queries that should hide them.
 * - To perform a real hard delete, call the underlying client directly
 *   (e.g. `prisma.$executeRaw`).
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      async findFirst({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          args.where = mergeDeletedAt(args.where);
        }
        return query(args);
      },
      async findFirstOrThrow({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          args.where = mergeDeletedAt(args.where);
        }
        return query(args);
      },
      async findMany({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          args.where = mergeDeletedAt(args.where);
        }
        return query(args);
      },
      async count({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          args.where = mergeDeletedAt(args.where);
        }
        return query(args);
      },
      async aggregate({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          args.where = mergeDeletedAt(args.where);
        }
        return query(args);
      },
      async groupBy({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          args.where = mergeDeletedAt(args.where);
        }
        return query(args);
      },
      async delete({ model, args, query, operation: _op }) {
        if (!isSoftDeleteModel(model)) {
          return query(args);
        }
        // Re-route: forward as an `update` setting deletedAt = now().
        const ctx = Prisma.getExtensionContext(this) as unknown as {
          [k: string]: { update: (a: unknown) => Promise<unknown> };
        };
        const modelKey = lowerFirst(model);
        return ctx[modelKey].update({
          where: args.where,
          data: { deletedAt: new Date() },
        }) as ReturnType<typeof query>;
      },
      async deleteMany({ model, args, query }) {
        if (!isSoftDeleteModel(model)) {
          return query(args);
        }
        const ctx = Prisma.getExtensionContext(this) as unknown as {
          [k: string]: {
            updateMany: (a: unknown) => Promise<unknown>;
          };
        };
        const modelKey = lowerFirst(model);
        return ctx[modelKey].updateMany({
          where: mergeDeletedAt(args.where),
          data: { deletedAt: new Date() },
        }) as ReturnType<typeof query>;
      },
    },
  },
});

const mergeDeletedAt = (where: unknown): Record<string, unknown> => {
  const base = (where ?? {}) as Record<string, unknown>;
  if ('deletedAt' in base) {
    // Caller supplied an explicit deletedAt filter (e.g. an admin listing
    // soft-deleted rows). Respect it.
    return base;
  }
  return { ...base, deletedAt: null };
};

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export type ExtendedPrismaClient = ReturnType<typeof applyExtensions>;
export const applyExtensions = <T extends { $extends: (e: typeof softDeleteExtension) => unknown }>(
  client: T,
) => client.$extends(softDeleteExtension);
