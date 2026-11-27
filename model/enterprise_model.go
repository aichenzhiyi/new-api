package model

import (
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SupplierAccount is a procurement ledger, never a credential store or balance.
// Vendor is the existing brand catalog; an account can supply multiple channels.
type SupplierAccount struct {
	Id          int    `json:"id" gorm:"comment:采购账户主键"`
	Code        string `json:"code" gorm:"size:32;not null;uniqueIndex;comment:采购账户唯一编码，接口统一为大写"`
	Name        string `json:"name" gorm:"size:128;not null;comment:采购账户展示名称，可向关联项目展示"`
	VendorId    int    `json:"vendor_id" gorm:"not null;index;comment:已有供应商目录ID，表示采购供应商"`
	AccountRef  string `json:"account_ref" gorm:"size:128;not null;comment:采购账号标识或内部编号，仅超级管理员可见，禁止存储密码或API密钥"`
	Owner       string `json:"owner" gorm:"size:64;not null;comment:采购账户负责人联系信息"`
	Currency    string `json:"currency" gorm:"size:3;not null;comment:采购币种代码，例如CNY或USD，不自动折算汇率"`
	ContractRef string `json:"contract_ref" gorm:"size:128;not null;comment:可选合同编号，仅超级管理员可见"`
	Description string `json:"description" gorm:"size:255;not null;comment:采购账户备注，禁止存储凭证"`
	Enabled     bool   `json:"enabled" gorm:"not null;comment:台账启停状态，停用保留关联，不改变网关路由"`
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null;comment:创建时间，Unix秒时间戳"`
	UpdatedTime int64  `json:"updated_time" gorm:"bigint;not null;comment:更新时间，Unix秒时间戳"`
	ChannelIds  []int  `json:"channel_ids" gorm:"-"`
}

// Keep enterprise data separate so upstream catalog sync cannot overwrite it.
type EnterpriseModel struct {
	ModelId        int    `json:"model_id" gorm:"primaryKey;autoIncrement:false;comment:已有模型目录主键，每条模型元数据最多一份企业资料"`
	ModelVersion   string `json:"model_version" gorm:"size:128;not null;comment:企业登记的模型版本，不用于匹配或改写请求模型名"`
	Capabilities   string `json:"capabilities" gorm:"size:255;not null;comment:模型能力说明，例如文本、视觉、工具调用"`
	ContextLimit   int64  `json:"context_limit" gorm:"not null;comment:登记上下文上限，单位token，0表示未知，仅作资料展示"`
	Scenarios      string `json:"scenarios" gorm:"size:1024;not null;comment:适用业务场景说明"`
	Owner          string `json:"owner" gorm:"size:64;not null;comment:模型负责人联系信息"`
	DeploymentType string `json:"deployment_type" gorm:"size:16;not null;comment:模型部署类型：cloud云端，local本地，不采集硬件资源"`
	Shared         bool   `json:"shared" gorm:"not null;comment:是否在全部项目模型目录中可见，不授予API调用权限"`
	CreatedTime    int64  `json:"created_time" gorm:"bigint;not null;comment:创建时间，Unix秒时间戳"`
	UpdatedTime    int64  `json:"updated_time" gorm:"bigint;not null;comment:更新时间，Unix秒时间戳"`
	ProjectIds     []int  `json:"project_ids" gorm:"-"`
}

type EnterpriseModelProject struct {
	ModelId   int `json:"model_id" gorm:"primaryKey;autoIncrement:false;comment:企业模型资料关联的已有模型目录主键"`
	ProjectId int `json:"project_id" gorm:"primaryKey;autoIncrement:false;index;comment:允许查看该模型资料的项目ID，不表示请求实际归属"`
}

// Explicit safe projections: no Channel object, credentials, URLs or settings.
type EnterpriseChannel struct {
	Id                int    `json:"id"`
	Name              string `json:"name"`
	Status            int    `json:"status"`
	Models            string `json:"-"`
	SupplierAccountId int    `json:"supplier_account_id"`
	AccountName       string `json:"account_name"`
	Currency          string `json:"currency"`
	AccountEnabled    bool   `json:"account_enabled"`
}

type EnterpriseModelView struct {
	EnterpriseModel
	ModelName   string              `json:"model_name"`
	Description string              `json:"description"`
	Tags        string              `json:"tags"`
	VendorId    int                 `json:"vendor_id"`
	VendorName  string              `json:"vendor_name"`
	Status      int                 `json:"status"`
	NameRule    int                 `json:"name_rule"`
	Configured  bool                `json:"configured"`
	Channels    []EnterpriseChannel `json:"channels"`
}

var ErrEnterpriseAccessDenied = errors.New("Only global administrators can manage shared model configuration")

func RequireEnterpriseAdmin(tx *gorm.DB, userId int) error {
	_, root, err := ApplyProjectScope(tx, userId)
	if err != nil {
		return err
	}
	if !root {
		return ErrEnterpriseAccessDenied
	}
	return nil
}

func GetEnterpriseChannels() ([]EnterpriseChannel, error) {
	rows := make([]EnterpriseChannel, 0)
	err := DB.Table("channels").Select("channels.id, channels.name, channels.status, channels.models, channels.supplier_account_id, supplier_accounts.name AS account_name, supplier_accounts.currency, supplier_accounts.enabled AS account_enabled").
		Joins("LEFT JOIN supplier_accounts ON supplier_accounts.id = channels.supplier_account_id").Order("channels.id").Scan(&rows).Error
	return rows, err
}

func GetSupplierAccounts(userId int) ([]SupplierAccount, error) {
	if err := RequireEnterpriseAdmin(DB, userId); err != nil {
		return nil, err
	}
	rows := make([]SupplierAccount, 0)
	if err := DB.Order("code").Find(&rows).Error; err != nil {
		return nil, err
	}
	var channels []Channel
	if err := DB.Select("id", "supplier_account_id").Where("supplier_account_id > 0").Order("id").Find(&channels).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].ChannelIds = make([]int, 0)
		for _, channel := range channels {
			if channel.SupplierAccountId == rows[i].Id {
				rows[i].ChannelIds = append(rows[i].ChannelIds, channel.Id)
			}
		}
	}
	return rows, nil
}

func SaveSupplierAccount(userId int, account *SupplierAccount) (*SupplierAccount, error) {
	account.Code = strings.ToUpper(strings.TrimSpace(account.Code))
	account.Name = strings.TrimSpace(account.Name)
	account.AccountRef = strings.TrimSpace(account.AccountRef)
	account.Owner = strings.TrimSpace(account.Owner)
	account.Currency = strings.ToUpper(strings.TrimSpace(account.Currency))
	account.ContractRef = strings.TrimSpace(account.ContractRef)
	account.Description = strings.TrimSpace(account.Description)
	if account.Id < 0 || !departmentCodePattern.MatchString(account.Code) || account.Name == "" || account.VendorId < 1 || account.ChannelIds == nil || len(account.ChannelIds) > 1000 {
		return nil, common.NewMessage("Invalid parameters")
	}
	if !slices.Contains([]string{"CNY", "USD", "EUR", "JPY", "GBP", "HKD", "SGD", "AUD", "CAD", "KRW", "TWD", "INR"}, account.Currency) {
		return nil, common.NewMessage("Select a supported procurement currency")
	}
	for _, field := range []struct {
		value   string
		maximum int
	}{{account.Name, 128}, {account.AccountRef, 128}, {account.Owner, 64}, {account.ContractRef, 128}, {account.Description, 255}} {
		if utf8.RuneCountInString(field.value) > field.maximum {
			return nil, common.NewMessage("Procurement account fields exceed their length limits")
		}
	}
	account.ChannelIds = slices.Clone(account.ChannelIds)
	slices.Sort(account.ChannelIds)
	account.ChannelIds = slices.Compact(account.ChannelIds)
	if len(account.ChannelIds) > 0 && account.ChannelIds[0] < 1 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var before *SupplierAccount
	err := metadataTransaction(func(tx *gorm.DB) error {
		if err := RequireEnterpriseAdmin(tx, userId); err != nil {
			return err
		}
		if err := validateModelVendor(tx, account.VendorId); err != nil {
			return common.NewMessage("Vendor does not exist")
		}
		if account.Id > 0 {
			var old SupplierAccount
			if err := tx.First(&old, account.Id).Error; err != nil {
				return err
			}
			old.ChannelIds = make([]int, 0)
			if err := tx.Model(&Channel{}).Where("supplier_account_id = ?", old.Id).Order("id").Pluck("id", &old.ChannelIds).Error; err != nil {
				return err
			}
			if len(old.ChannelIds) > 0 && (old.Currency != account.Currency || old.VendorId != account.VendorId) {
				return common.NewMessage("Unlink channels before changing the procurement vendor or currency")
			}
			before, account.CreatedTime = &old, old.CreatedTime
		}
		var duplicate int64
		if err := tx.Model(&SupplierAccount{}).Where("code = ? AND id <> ?", account.Code, account.Id).Count(&duplicate).Error; err != nil {
			return err
		}
		if duplicate > 0 {
			return common.NewMessage("Procurement account code already exists")
		}
		var channels []Channel
		if len(account.ChannelIds) > 0 {
			if err := lockForUpdate(tx).Select("id", "supplier_account_id").Where("id IN ?", account.ChannelIds).Order("id").Find(&channels).Error; err != nil {
				return err
			}
			if len(channels) != len(account.ChannelIds) {
				return common.NewMessage("Selected channel does not exist")
			}
			for _, channel := range channels {
				if channel.SupplierAccountId != 0 && channel.SupplierAccountId != account.Id {
					return common.NewMessage("Channel is already linked to another procurement account")
				}
			}
		}
		account.UpdatedTime = common.GetTimestamp()
		if account.Id == 0 {
			account.CreatedTime = account.UpdatedTime
			if err := tx.Create(account).Error; err != nil {
				return err
			}
		} else if err := tx.Model(&SupplierAccount{}).Where("id = ?", account.Id).Select("code", "name", "vendor_id", "account_ref", "owner", "currency", "contract_ref", "description", "enabled", "updated_time").Updates(account).Error; err != nil {
			return err
		}
		// The channel field is read-only to legacy channel CRUD. Only this
		// authorized transaction may write the procurement association.
		if err := tx.Table("channels").Where("supplier_account_id = ?", account.Id).Update("supplier_account_id", 0).Error; err != nil {
			return err
		}
		if len(account.ChannelIds) == 0 {
			return nil
		}
		return tx.Table("channels").Where("id IN ?", account.ChannelIds).Update("supplier_account_id", account.Id).Error
	})
	return before, err
}

func DeleteSupplierAccount(userId, id int) (*SupplierAccount, error) {
	var before SupplierAccount
	err := metadataTransaction(func(tx *gorm.DB) error {
		if err := RequireEnterpriseAdmin(tx, userId); err != nil {
			return err
		}
		if id < 1 {
			return common.NewMessage("Invalid parameters")
		}
		if err := tx.First(&before, id).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&Channel{}).Where("supplier_account_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return common.NewMessage("Unlink channels before deleting the procurement account")
		}
		return tx.Delete(&before).Error
	})
	return &before, err
}

func SaveEnterpriseModel(userId int, profile *EnterpriseModel) (*EnterpriseModel, error) {
	profile.ModelVersion, profile.Capabilities = strings.TrimSpace(profile.ModelVersion), strings.TrimSpace(profile.Capabilities)
	profile.Scenarios, profile.Owner = strings.TrimSpace(profile.Scenarios), strings.TrimSpace(profile.Owner)
	if profile.ModelId < 1 || profile.ContextLimit < 0 || profile.ContextLimit > 1000000000 || profile.ProjectIds == nil || len(profile.ProjectIds) > 1000 || (profile.DeploymentType != "cloud" && profile.DeploymentType != "local") || (profile.Shared && len(profile.ProjectIds) > 0) {
		return nil, common.NewMessage("Invalid parameters")
	}
	for _, field := range []struct {
		value   string
		maximum int
	}{{profile.ModelVersion, 128}, {profile.Capabilities, 255}, {profile.Scenarios, 1024}, {profile.Owner, 64}} {
		if utf8.RuneCountInString(field.value) > field.maximum {
			return nil, common.NewMessage("Enterprise model fields exceed their length limits")
		}
	}
	profile.ProjectIds = slices.Clone(profile.ProjectIds)
	slices.Sort(profile.ProjectIds)
	profile.ProjectIds = slices.Compact(profile.ProjectIds)
	if len(profile.ProjectIds) > 0 && profile.ProjectIds[0] < 1 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var before *EnterpriseModel
	err := metadataTransaction(func(tx *gorm.DB) error {
		if err := RequireEnterpriseAdmin(tx, userId); err != nil {
			return err
		}
		var metadata Model
		if err := tx.Select("id").First(&metadata, profile.ModelId).Error; err != nil {
			return err
		}
		if len(profile.ProjectIds) > 0 {
			var projects []Project
			if err := lockForUpdate(tx).Select("id").Where("id IN ?", profile.ProjectIds).Order("id").Find(&projects).Error; err != nil {
				return err
			}
			if len(projects) != len(profile.ProjectIds) {
				return common.NewMessage("Selected project does not exist")
			}
		}
		var old EnterpriseModel
		err := tx.First(&old, "model_id = ?", profile.ModelId).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil {
			old.ProjectIds = make([]int, 0)
			if err := tx.Model(&EnterpriseModelProject{}).Where("model_id = ?", profile.ModelId).Order("project_id").Pluck("project_id", &old.ProjectIds).Error; err != nil {
				return err
			}
			before, profile.CreatedTime = &old, old.CreatedTime
		}
		profile.UpdatedTime = common.GetTimestamp()
		if before == nil {
			profile.CreatedTime = profile.UpdatedTime
		}
		if err := tx.Save(profile).Error; err != nil {
			return err
		}
		if err := tx.Where("model_id = ?", profile.ModelId).Delete(&EnterpriseModelProject{}).Error; err != nil {
			return err
		}
		for _, projectId := range profile.ProjectIds {
			if err := tx.Create(&EnterpriseModelProject{ModelId: profile.ModelId, ProjectId: projectId}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return before, err
}

// projectId == 0 is the global administrator editor. Other reads revalidate
// membership and return no other project's assignments or purchasing references.
func GetEnterpriseModels(userId, projectId int) ([]EnterpriseModelView, error) {
	if projectId == 0 {
		if err := RequireEnterpriseAdmin(DB, userId); err != nil {
			return nil, err
		}
	} else if _, err := GetProjectForUser(userId, projectId); err != nil {
		return nil, err
	}
	var metadata []Model
	query := DB.Model(&Model{})
	if projectId > 0 {
		query = query.Where("id IN (?)", DB.Model(&EnterpriseModel{}).Select("model_id").Where("shared = ? OR model_id IN (?)", true, DB.Model(&EnterpriseModelProject{}).Select("model_id").Where("project_id = ?", projectId)))
	}
	if err := query.Order("model_name").Find(&metadata).Error; err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(metadata))
	for _, item := range metadata {
		ids = append(ids, item.Id)
	}
	profiles := make([]EnterpriseModel, 0)
	links := make([]EnterpriseModelProject, 0)
	if len(ids) > 0 {
		if err := DB.Where("model_id IN ?", ids).Find(&profiles).Error; err != nil {
			return nil, err
		}
		if projectId == 0 {
			if err := DB.Where("model_id IN ?", ids).Order("project_id").Find(&links).Error; err != nil {
				return nil, err
			}
		}
	}
	var vendors []Vendor
	if err := DB.Select("id", "name").Find(&vendors).Error; err != nil {
		return nil, err
	}
	channels, err := GetEnterpriseChannels()
	if err != nil {
		return nil, err
	}
	result := make([]EnterpriseModelView, 0, len(metadata))
	for _, item := range metadata {
		row := EnterpriseModelView{EnterpriseModel: EnterpriseModel{ModelId: item.Id, DeploymentType: "cloud", ProjectIds: make([]int, 0)}, ModelName: item.ModelName, Description: item.Description, Tags: item.Tags, VendorId: item.VendorID, Status: item.Status, NameRule: item.NameRule, Channels: make([]EnterpriseChannel, 0)}
		for _, profile := range profiles {
			if profile.ModelId == item.Id {
				row.EnterpriseModel, row.Configured = profile, true
				row.ProjectIds = make([]int, 0)
			}
		}
		for _, link := range links {
			if link.ModelId == item.Id {
				row.ProjectIds = append(row.ProjectIds, link.ProjectId)
			}
		}
		for _, vendor := range vendors {
			if vendor.Id == item.VendorID {
				row.VendorName = vendor.Name
			}
		}
		for _, channel := range channels {
			for name := range strings.SplitSeq(channel.Models, ",") {
				if item.MatchesName(strings.TrimSpace(name)) {
					row.Channels = append(row.Channels, channel)
					break
				}
			}
		}
		result = append(result, row)
	}
	return result, nil
}

func DeleteEnterpriseModel(userId, modelId int) (*EnterpriseModel, error) {
	var before EnterpriseModel
	err := metadataTransaction(func(tx *gorm.DB) error {
		if err := RequireEnterpriseAdmin(tx, userId); err != nil {
			return err
		}
		if err := tx.First(&before, "model_id = ?", modelId).Error; err != nil {
			return err
		}
		before.ProjectIds = make([]int, 0)
		if err := tx.Model(&EnterpriseModelProject{}).Where("model_id = ?", modelId).Order("project_id").Pluck("project_id", &before.ProjectIds).Error; err != nil {
			return err
		}
		if err := tx.Where("model_id = ?", modelId).Delete(&EnterpriseModelProject{}).Error; err != nil {
			return err
		}
		return tx.Delete(&before).Error
	})
	return &before, err
}
