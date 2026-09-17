PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_audit` (
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
	CONSTRAINT "admin_audit_actor_kind_check" CHECK("__new_admin_audit"."actor_kind" IN ('vehicle_credential', 'platform_user')),
	CONSTRAINT "admin_audit_actor_role_check" CHECK("__new_admin_audit"."actor_role" IN ('owner', 'driver', 'admin', 'support')),
	CONSTRAINT "admin_audit_on_behalf_of_kind_check" CHECK("__new_admin_audit"."on_behalf_of_kind" IS NULL OR "__new_admin_audit"."on_behalf_of_kind" IN ('owner', 'driver')),
	CONSTRAINT "admin_audit_actor_kind_exclusivity_check" CHECK((
      ("__new_admin_audit"."actor_kind" = 'vehicle_credential' AND "__new_admin_audit"."actor_credential_id" IS NOT NULL AND "__new_admin_audit"."actor_platform_user_id" IS NULL)
      OR
      ("__new_admin_audit"."actor_kind" = 'platform_user' AND "__new_admin_audit"."actor_platform_user_id" IS NOT NULL AND "__new_admin_audit"."actor_credential_id" IS NULL)
    )),
	CONSTRAINT "admin_audit_on_behalf_of_consistency_check" CHECK((
      ("__new_admin_audit"."on_behalf_of_kind" IS NULL AND "__new_admin_audit"."on_behalf_of_person_id" IS NULL)
      OR
      ("__new_admin_audit"."on_behalf_of_kind" IS NOT NULL AND "__new_admin_audit"."on_behalf_of_person_id" IS NOT NULL)
    )),
	CONSTRAINT "admin_audit_business_id_required_for_scoped_refs_check" CHECK(("__new_admin_audit"."vehicle_id" IS NULL OR "__new_admin_audit"."business_id" IS NOT NULL)
        AND ("__new_admin_audit"."on_behalf_of_person_id" IS NULL OR "__new_admin_audit"."business_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_admin_audit`("id", "business_id", "vehicle_id", "entity_type", "entity_id", "action", "before_json", "after_json", "actor_kind", "actor_session_id", "actor_role", "actor_credential_id", "actor_platform_user_id", "on_behalf_of_kind", "on_behalf_of_person_id", "occurred_at") SELECT "id", "business_id", "vehicle_id", "entity_type", "entity_id", "action", "before_json", "after_json", "actor_kind", "actor_session_id", "actor_role", "actor_credential_id", "actor_platform_user_id", "on_behalf_of_kind", "on_behalf_of_person_id", "occurred_at" FROM `admin_audit`;--> statement-breakpoint
DROP TABLE `admin_audit`;--> statement-breakpoint
ALTER TABLE `__new_admin_audit` RENAME TO `admin_audit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_admin_audit_business_period` ON `admin_audit` (`business_id`,`occurred_at`,`id`);