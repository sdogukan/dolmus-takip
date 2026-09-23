ALTER TABLE `platform_users` ADD `full_name` text;--> statement-breakpoint
ALTER TABLE `platform_users` ADD `version` integer DEFAULT 1 NOT NULL;