CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`vehicle_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_session_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`actor_credential_id` text,
	`actor_platform_user_id` text,
	`on_behalf_of_kind` text,
	`on_behalf_of_person_id` text,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_credential_id`) REFERENCES `vehicle_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_platform_user_id`) REFERENCES `platform_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`on_behalf_of_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`vehicle_id`) REFERENCES `vehicles`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`on_behalf_of_person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "admin_audit_actor_kind_check" CHECK("admin_audit"."actor_kind" IN ('vehicle_credential', 'platform_user')),
	CONSTRAINT "admin_audit_actor_role_check" CHECK("admin_audit"."actor_role" IN ('owner', 'driver', 'admin', 'support')),
	CONSTRAINT "admin_audit_on_behalf_of_kind_check" CHECK("admin_audit"."on_behalf_of_kind" IS NULL OR "admin_audit"."on_behalf_of_kind" IN ('owner', 'driver')),
	CONSTRAINT "admin_audit_actor_kind_exclusivity_check" CHECK((
      ("admin_audit"."actor_kind" = 'vehicle_credential' AND "admin_audit"."actor_credential_id" IS NOT NULL AND "admin_audit"."actor_platform_user_id" IS NULL)
      OR
      ("admin_audit"."actor_kind" = 'platform_user' AND "admin_audit"."actor_platform_user_id" IS NOT NULL AND "admin_audit"."actor_credential_id" IS NULL)
    )),
	CONSTRAINT "admin_audit_on_behalf_of_consistency_check" CHECK((
      ("admin_audit"."on_behalf_of_kind" IS NULL AND "admin_audit"."on_behalf_of_person_id" IS NULL)
      OR
      ("admin_audit"."on_behalf_of_kind" IS NOT NULL AND "admin_audit"."on_behalf_of_person_id" IS NOT NULL)
    ))
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_business_period` ON `admin_audit` (`business_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cash_confirmations` (
	`business_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`entry_version` integer NOT NULL,
	`received_cents` integer NOT NULL,
	`confirmed_at` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_session_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`actor_credential_id` text,
	`actor_platform_user_id` text,
	`on_behalf_of_kind` text,
	`on_behalf_of_person_id` text,
	FOREIGN KEY (`actor_credential_id`) REFERENCES `vehicle_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_platform_user_id`) REFERENCES `platform_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`on_behalf_of_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`entry_id`,`entry_version`) REFERENCES `work_entry_revisions`(`business_id`,`entry_id`,`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`on_behalf_of_person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_confirmations_received_cents_nonnegative_check" CHECK("cash_confirmations"."received_cents" >= 0),
	CONSTRAINT "cash_confirmations_actor_kind_check" CHECK("cash_confirmations"."actor_kind" IN ('vehicle_credential', 'platform_user')),
	CONSTRAINT "cash_confirmations_actor_role_check" CHECK("cash_confirmations"."actor_role" IN ('owner', 'driver', 'admin', 'support')),
	CONSTRAINT "cash_confirmations_on_behalf_of_kind_check" CHECK("cash_confirmations"."on_behalf_of_kind" IS NULL OR "cash_confirmations"."on_behalf_of_kind" IN ('owner', 'driver')),
	CONSTRAINT "cash_confirmations_actor_kind_exclusivity_check" CHECK((
      ("cash_confirmations"."actor_kind" = 'vehicle_credential' AND "cash_confirmations"."actor_credential_id" IS NOT NULL AND "cash_confirmations"."actor_platform_user_id" IS NULL)
      OR
      ("cash_confirmations"."actor_kind" = 'platform_user' AND "cash_confirmations"."actor_platform_user_id" IS NOT NULL AND "cash_confirmations"."actor_credential_id" IS NULL)
    )),
	CONSTRAINT "cash_confirmations_on_behalf_of_consistency_check" CHECK((
      ("cash_confirmations"."on_behalf_of_kind" IS NULL AND "cash_confirmations"."on_behalf_of_person_id" IS NULL)
      OR
      ("cash_confirmations"."on_behalf_of_kind" IS NOT NULL AND "cash_confirmations"."on_behalf_of_person_id" IS NOT NULL)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_confirmations_business_entry_version_uk` ON `cash_confirmations` (`business_id`,`entry_id`,`entry_version`);--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`scope_key` text NOT NULL,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`request_hash` text NOT NULL,
	`entity_id` text,
	`result_version` integer,
	`response_code` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`scope_key`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`business_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_version_positive_check" CHECK("people"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_business_id_id_uk` ON `people` (`business_id`,`id`);--> statement-breakpoint
CREATE TABLE `platform_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`platform_role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_users_platform_role_check" CHECK("platform_users"."platform_role" IN ('admin', 'support')),
	CONSTRAINT "platform_users_credential_version_positive_check" CHECK("platform_users"."credential_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_users_username_unique` ON `platform_users` (`username`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`credential_id` text,
	`platform_user_id` text,
	`issued_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`credential_id`) REFERENCES `vehicle_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform_user_id`) REFERENCES `platform_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sessions_exactly_one_actor_check" CHECK((
        ("sessions"."credential_id" IS NOT NULL AND "sessions"."platform_user_id" IS NULL)
        OR
        ("sessions"."credential_id" IS NULL AND "sessions"."platform_user_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `vehicle_credentials` (
	`business_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`business_id`,`vehicle_id`) REFERENCES `vehicles`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vehicle_credentials_role_check" CHECK("vehicle_credentials"."role" IN ('owner', 'driver')),
	CONSTRAINT "vehicle_credentials_credential_version_positive_check" CHECK("vehicle_credentials"."credential_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_credentials_vehicle_role_uk` ON `vehicle_credentials` (`vehicle_id`,`role`);--> statement-breakpoint
CREATE TABLE `vehicle_drivers` (
	`business_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`person_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`business_id`, `vehicle_id`, `person_id`),
	FOREIGN KEY (`business_id`,`vehicle_id`) REFERENCES `vehicles`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vehicle_drivers_version_positive_check" CHECK("vehicle_drivers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`business_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`plate_normalized` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`brand_model` text,
	`year` integer,
	`route_stop` text,
	`note` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`owner_person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vehicles_version_positive_check" CHECK("vehicles"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_plate_normalized_unique` ON `vehicles` (`plate_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_business_id_id_uk` ON `vehicles` (`business_id`,`id`);--> statement-breakpoint
CREATE TABLE `work_entries` (
	`business_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`person_id` text NOT NULL,
	`work_kind` text NOT NULL,
	`work_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`gross_cents` integer NOT NULL,
	`fuel_cents` integer NOT NULL,
	`other_expense_cents` integer NOT NULL,
	`other_expense_note` text,
	`share_bps` integer NOT NULL,
	`share_cents` integer NOT NULL,
	`remainder_cents` integer NOT NULL,
	`calculation_version` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`business_id`,`vehicle_id`) REFERENCES `vehicles`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_entries_work_kind_check" CHECK("work_entries"."work_kind" IN ('owner', 'driver')),
	CONSTRAINT "work_entries_status_check" CHECK("work_entries"."status" IN ('pending', 'confirmed', 'not_required')),
	CONSTRAINT "work_entries_duration_minutes_range_check" CHECK("work_entries"."duration_minutes" > 0 AND "work_entries"."duration_minutes" <= 1440),
	CONSTRAINT "work_entries_gross_cents_nonnegative_check" CHECK("work_entries"."gross_cents" >= 0),
	CONSTRAINT "work_entries_fuel_cents_nonnegative_check" CHECK("work_entries"."fuel_cents" >= 0),
	CONSTRAINT "work_entries_other_expense_cents_nonnegative_check" CHECK("work_entries"."other_expense_cents" >= 0),
	CONSTRAINT "work_entries_share_cents_nonnegative_check" CHECK("work_entries"."share_cents" >= 0),
	CONSTRAINT "work_entries_share_bps_check" CHECK("work_entries"."share_bps" = 0 OR "work_entries"."share_bps" = 2000),
	CONSTRAINT "work_entries_calculation_version_positive_check" CHECK("work_entries"."calculation_version" >= 1),
	CONSTRAINT "work_entries_version_positive_check" CHECK("work_entries"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_work_entries_vehicle_period` ON `work_entries` (`business_id`,`vehicle_id`,`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `idx_work_entries_person_period` ON `work_entries` (`business_id`,`person_id`,`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `idx_work_entries_vehicle_status_period` ON `work_entries` (`business_id`,`vehicle_id`,`status`,`work_date`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `work_entries_business_id_id_uk` ON `work_entries` (`business_id`,`id`);--> statement-breakpoint
CREATE TABLE `work_entry_revisions` (
	`business_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_session_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`actor_credential_id` text,
	`actor_platform_user_id` text,
	`on_behalf_of_kind` text,
	`on_behalf_of_person_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`business_id`, `entry_id`, `version`),
	FOREIGN KEY (`actor_credential_id`) REFERENCES `vehicle_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_platform_user_id`) REFERENCES `platform_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`on_behalf_of_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`entry_id`) REFERENCES `work_entries`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`on_behalf_of_person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_entry_revisions_version_positive_check" CHECK("work_entry_revisions"."version" >= 1),
	CONSTRAINT "work_entry_revisions_actor_kind_check" CHECK("work_entry_revisions"."actor_kind" IN ('vehicle_credential', 'platform_user')),
	CONSTRAINT "work_entry_revisions_actor_role_check" CHECK("work_entry_revisions"."actor_role" IN ('owner', 'driver', 'admin', 'support')),
	CONSTRAINT "work_entry_revisions_on_behalf_of_kind_check" CHECK("work_entry_revisions"."on_behalf_of_kind" IS NULL OR "work_entry_revisions"."on_behalf_of_kind" IN ('owner', 'driver')),
	CONSTRAINT "work_entry_revisions_actor_kind_exclusivity_check" CHECK((
      ("work_entry_revisions"."actor_kind" = 'vehicle_credential' AND "work_entry_revisions"."actor_credential_id" IS NOT NULL AND "work_entry_revisions"."actor_platform_user_id" IS NULL)
      OR
      ("work_entry_revisions"."actor_kind" = 'platform_user' AND "work_entry_revisions"."actor_platform_user_id" IS NOT NULL AND "work_entry_revisions"."actor_credential_id" IS NULL)
    )),
	CONSTRAINT "work_entry_revisions_on_behalf_of_consistency_check" CHECK((
      ("work_entry_revisions"."on_behalf_of_kind" IS NULL AND "work_entry_revisions"."on_behalf_of_person_id" IS NULL)
      OR
      ("work_entry_revisions"."on_behalf_of_kind" IS NOT NULL AND "work_entry_revisions"."on_behalf_of_person_id" IS NOT NULL)
    ))
);
