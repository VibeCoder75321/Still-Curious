import { integer, sqliteTable, text, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    activeUserId: text("active_user_id"),
    status: text("status").notNull(),
    jobJson: text("job_json").notNull(),
    lockToken: text("lock_token"),
    lockUntil: integer("lock_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("episodes_one_active_per_user").on(table.activeUserId)],
);

export const episodeAllowanceHolds = sqliteTable("episode_allowance_holds", {
  episodeId: text("episode_id").primaryKey(), userId: text("user_id").notNull(),
  amountMicrousd: integer("amount_microusd").notNull(),
}, table => [index("episode_allowance_user").on(table.userId), check("episode_allowance_nonnegative", sql`${table.amountMicrousd} >= 0`)]);

export const episodeSchedulerHealth = sqliteTable("episode_scheduler_health", {
  id: integer("id").primaryKey(), lastTick: integer("last_tick").notNull(), lastFinished: integer("last_finished"),
  leaseToken: text("lease_token"), leaseUntil: integer("lease_until"),
}, table => [check("episode_scheduler_singleton", sql`${table.id} = 1`)]);
