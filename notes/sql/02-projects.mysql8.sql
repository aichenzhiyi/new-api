-- New API: batch 02 project management, MySQL 8.
-- Run against the PRIMARY database after backup and after batch 01 departments.
-- Startup GORM AutoMigrate also creates this table; this is an alternative
-- manual provisioning script. Real MySQL 8 execution remains to be verified.

CREATE TABLE IF NOT EXISTS `projects` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '项目主键，停用后保留',
  `code` varchar(32) NOT NULL COMMENT '项目全局唯一编码，由接口统一转换为大写',
  `name` varchar(64) NOT NULL COMMENT '项目名称',
  `department_id` bigint NOT NULL COMMENT '费用承担部门ID，每个项目必须指定一个部门，跨部门项目同样适用',
  `owner` varchar(64) NOT NULL COMMENT '业务负责人联系信息，不关联管理账号或项目角色',
  `description` varchar(255) NOT NULL COMMENT '项目说明',
  `enabled` boolean NOT NULL COMMENT '启停状态：1启用，0停用；停用保留项目记录',
  `created_time` bigint NOT NULL COMMENT '创建时间，Unix时间戳，单位秒',
  `updated_time` bigint NOT NULL COMMENT '最后更新时间，Unix时间戳，单位秒',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_projects_code` (`code`),
  KEY `idx_projects_department_id` (`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目管理表，记录费用承担部门、业务负责人、说明和启停信息';

-- Use the management API to preserve validation and auditing. The project API
-- uses the same department_tree_lock options row as department writes.
-- Association checks are enforced in code; do not write business rows directly.
-- CREATE TABLE IF NOT EXISTS does not change an existing table.
