-- New API: batch 03 account departments and project scope, MySQL 8.
-- Run on the PRIMARY database after batch 01 and 02, or let startup AutoMigrate
-- create these tables. No changes to users or the separate log DB are required.
-- No default project grants: existing accounts remain unassigned.

CREATE TABLE IF NOT EXISTS `user_organizations` (
  `user_id` bigint NOT NULL COMMENT '账号ID，与users.id对应；每个账号最多一条所属部门记录',
  `department_id` bigint NOT NULL COMMENT '账号所属部门ID，0表示未分配；所属部门不自动授予项目权限',
  PRIMARY KEY (`user_id`),
  KEY `idx_user_organizations_department_id` (`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账号所属部门，独立于费用承担部门和项目权限';

CREATE TABLE IF NOT EXISTS `user_projects` (
  `user_id` bigint NOT NULL COMMENT '管理账号ID，与users.id对应',
  `project_id` bigint NOT NULL COMMENT '可管理项目ID，与projects.id对应；同一项目关联账号权限相同',
  PRIMARY KEY (`user_id`, `project_id`),
  KEY `idx_user_projects_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理账号与项目多对多关联，不设置项目角色';

-- Use the root management API for grants and revocations. It validates targets,
-- serializes organization changes, records audits and invalidates old sessions.
-- Direct inserts bypass these controls. CREATE TABLE IF NOT EXISTS does not
-- change an existing table. No manual seed data is necessary.
