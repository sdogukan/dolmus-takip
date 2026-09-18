CREATE TABLE `business_owners` (
	`business_id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`,`person_id`) REFERENCES `people`(`business_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `businesses` ADD `version` integer DEFAULT 1 NOT NULL;