CREATE TABLE `admin_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text,
	`ip` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`code_verifier` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `providers` ADD `oauth_state` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `agent_model` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `max_tokens` integer;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `context_window_tokens` integer;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `temperature` integer;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `reasoning_effort` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `tool_confirm_mode` text;