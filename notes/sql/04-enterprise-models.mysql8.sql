-- New API: batch 04 procurement accounts and enterprise model information.
-- Alternative manual provisioning for the PRIMARY MySQL 8 database.
-- Run after batches 01–03 and an application backup. Startup AutoMigrate also
-- provisions these fields/tables. This script can be executed more than once.
-- No credentials, balances, recharge records or usage records are stored here.

CREATE TABLE IF NOT EXISTS `supplier_accounts` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '采购账户主键',
  `code` varchar(32) NOT NULL COMMENT '采购账户唯一编码，接口统一为大写',
  `name` varchar(128) NOT NULL COMMENT '采购账户展示名称，可向关联项目展示',
  `vendor_id` bigint NOT NULL COMMENT '已有供应商目录ID，表示采购供应商',
  `account_ref` varchar(128) NOT NULL COMMENT '采购账号标识或内部编号，仅超级管理员可见，禁止存储密码或API密钥',
  `owner` varchar(64) NOT NULL COMMENT '采购账户负责人联系信息',
  `currency` varchar(3) NOT NULL COMMENT '采购币种代码，例如CNY或USD，不自动折算汇率',
  `contract_ref` varchar(128) NOT NULL COMMENT '可选合同编号，仅超级管理员可见',
  `description` varchar(255) NOT NULL COMMENT '采购账户备注，禁止存储凭证',
  `enabled` boolean NOT NULL COMMENT '台账启停状态，停用保留关联，不改变网关路由',
  `created_time` bigint NOT NULL COMMENT '创建时间，Unix秒时间戳',
  `updated_time` bigint NOT NULL COMMENT '更新时间，Unix秒时间戳',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_supplier_accounts_code` (`code`),
  KEY `idx_supplier_accounts_vendor_id` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应商采购账户台账，与用户余额和在线充值分离';

CREATE TABLE IF NOT EXISTS `enterprise_models` (
  `model_id` bigint NOT NULL COMMENT '已有模型目录主键，每条模型元数据最多一份企业资料',
  `model_version` varchar(128) NOT NULL COMMENT '企业登记的模型版本，不用于匹配或改写请求模型名',
  `capabilities` varchar(255) NOT NULL COMMENT '模型能力说明，例如文本、视觉、工具调用',
  `context_limit` bigint NOT NULL COMMENT '登记上下文上限，单位token，0表示未知，仅作资料展示',
  `scenarios` varchar(1024) NOT NULL COMMENT '适用业务场景说明',
  `owner` varchar(64) NOT NULL COMMENT '模型负责人联系信息',
  `deployment_type` varchar(16) NOT NULL COMMENT '模型部署类型：cloud云端，local本地，不采集硬件资源',
  `shared` boolean NOT NULL COMMENT '是否在全部项目模型目录中可见，不授予API调用权限',
  `created_time` bigint NOT NULL COMMENT '创建时间，Unix秒时间戳',
  `updated_time` bigint NOT NULL COMMENT '更新时间，Unix秒时间戳',
  PRIMARY KEY (`model_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业模型资料扩展，与上游同步的模型目录分开保存';

CREATE TABLE IF NOT EXISTS `enterprise_model_projects` (
  `model_id` bigint NOT NULL COMMENT '企业模型资料关联的已有模型目录主键',
  `project_id` bigint NOT NULL COMMENT '允许查看该模型资料的项目ID，不表示请求实际归属',
  PRIMARY KEY (`model_id`, `project_id`),
  KEY `idx_enterprise_model_projects_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='非全局共享企业模型的项目可见范围';

-- Existing channels start unassigned (0). An account can serve many channels;
-- each channel has at most one procurement account. A multi-key channel must
-- contain credentials for the same procurement account, otherwise split it.
SET @enterprise_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'channels' AND column_name = 'supplier_account_id'),
  'SELECT 1',
  'ALTER TABLE `channels` ADD COLUMN `supplier_account_id` bigint NOT NULL DEFAULT 0 COMMENT ''采购账户ID，0未关联，仅采购台账接口可修改'''
);
PREPARE enterprise_stmt FROM @enterprise_ddl;
EXECUTE enterprise_stmt;
DEALLOCATE PREPARE enterprise_stmt;

SET @enterprise_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'channels' AND index_name = 'idx_channels_supplier_account_id'),
  'SELECT 1',
  'CREATE INDEX `idx_channels_supplier_account_id` ON `channels` (`supplier_account_id`)'
);
PREPARE enterprise_stmt FROM @enterprise_ddl;
EXECUTE enterprise_stmt;
DEALLOCATE PREPARE enterprise_stmt;

-- Application transactions validate references and record audit events. Use the
-- management APIs instead of direct writes; no business rows are seeded here.
