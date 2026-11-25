-- New API: batch 01 department management, MySQL 8.
-- Run against the PRIMARY database after backup; no log database DDL is needed.
-- Startup AutoMigrate also creates this table. This is an alternative manual
-- provisioning script, not a replacement for reviewing an existing schema.
-- No DROP/DELETE statements: disabled departments retain their identity.
-- MySQL 8 execution and migration stability still require real-database testing.

CREATE TABLE IF NOT EXISTS `departments` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '部门主键，停用后保留',
  `code` varchar(32) NOT NULL COMMENT '部门唯一编码，由接口统一转换为大写',
  `name` varchar(64) NOT NULL COMMENT '部门名称',
  `parent_id` bigint NOT NULL COMMENT '上级部门ID，0表示顶级部门',
  `owner` varchar(64) NOT NULL COMMENT '部门负责人联系信息，不关联用户账号或权限角色',
  `description` varchar(255) NOT NULL COMMENT '部门说明',
  `enabled` boolean NOT NULL COMMENT '启停状态：1启用，0停用；停用不删除历史记录',
  `created_time` bigint NOT NULL COMMENT '创建时间，Unix时间戳，单位秒',
  `updated_time` bigint NOT NULL COMMENT '最后更新时间，Unix时间戳，单位秒',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_departments_code` (`code`),
  KEY `idx_departments_parent_id` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部门管理表，保存部门层级、负责人、说明和启停信息';

-- parent_id = 0 denotes a root department. Use the API to create/update rows so
-- hierarchy and audit rules run.
-- CREATE TABLE IF NOT EXISTS does not alter an existing table.
-- The existing options table supplies a department_tree_lock anchor, inserted
-- transactionally by the first department API write. It needs no manual seed.
