package model

import (
	"errors"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Disabled departments remain available for historical ownership. Only leaf
// departments can be deleted, with their previous state retained in the audit.
type Department struct {
	Id          int    `json:"id"`
	Code        string `json:"code" gorm:"size:32;not null;uniqueIndex"`
	Name        string `json:"name" gorm:"size:64;not null"`
	ParentId    int    `json:"parent_id" gorm:"not null;index"`
	Owner       string `json:"owner" gorm:"size:64;not null"`
	Description string `json:"description" gorm:"size:255;not null"`
	Enabled     bool   `json:"enabled" gorm:"not null"`
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null"`
	UpdatedTime int64  `json:"updated_time" gorm:"bigint;not null"`
}

var departmentCodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{0,31}$`)
var organizationMutationMu sync.Mutex

// MigrateDepartments removes retired department fields from existing tables.
// AutoMigrate alone does not remove columns, and the old NOT NULL columns would
// otherwise prevent new inserts. Department identities and indexes are retained.
func MigrateDepartments(db *gorm.DB) error {
	for _, column := range []string{"version", "cost_center"} {
		if db.Migrator().HasColumn(&Department{}, column) {
			if err := db.Migrator().DropColumn(&Department{}, column); err != nil {
				return err
			}
		}
	}
	return db.AutoMigrate(&Department{})
}

func GetDepartments() ([]Department, error) {
	departments := make([]Department, 0)
	err := DB.Order("code ASC").Find(&departments).Error
	return departments, err
}

// All hierarchy mutations share the same lock, so concurrent child creation,
// reparenting, disabling, deletion and project assignment cannot bypass validation.
// Retain the original anchor key for compatibility with existing installations.
func organizationTransaction(change func(*gorm.DB) error) error {
	organizationMutationMu.Lock()
	defer organizationMutationMu.Unlock()
	return DB.Transaction(func(tx *gorm.DB) error {
		anchor := Option{Key: "department_tree_lock", Value: ""}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&anchor).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where(&Option{Key: anchor.Key}).First(&anchor).Error; err != nil {
			return err
		}
		return change(tx)
	})
}

func DeleteDepartment(id int) (*Department, error) {
	if id < 1 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var department Department
	err := organizationTransaction(func(tx *gorm.DB) error {
		if err := tx.First(&department, id).Error; err != nil {
			return err
		}
		var children int64
		if err := tx.Model(&Department{}).Where("parent_id = ?", id).Count(&children).Error; err != nil {
			return err
		}
		if children > 0 {
			return common.NewMessage("Cannot delete a department with child departments")
		}
		var projects int64
		if err := tx.Model(&Project{}).Where("department_id = ?", id).Count(&projects).Error; err != nil {
			return err
		}
		if projects > 0 {
			return common.NewMessage("Cannot delete a department with projects")
		}
		var accounts int64
		if err := tx.Model(&UserOrganization{}).Where("department_id = ?", id).Count(&accounts).Error; err != nil {
			return err
		}
		if accounts > 0 {
			return common.NewMessage("Cannot delete a department with account assignments")
		}
		return tx.Delete(&department).Error
	})
	return &department, err
}

// SaveDepartment serializes hierarchy changes across instances using an option
// anchor, including the empty-tree case. The local mutex also serializes SQLite
// writers. Ordinary edits use the last successful save.
// The returned value is the previous snapshot for the management audit.
func SaveDepartment(department *Department) (*Department, error) {
	department.Code = strings.ToUpper(strings.TrimSpace(department.Code))
	department.Name = strings.TrimSpace(department.Name)
	department.Owner = strings.TrimSpace(department.Owner)
	department.Description = strings.TrimSpace(department.Description)
	if !departmentCodePattern.MatchString(department.Code) {
		return nil, common.NewMessage("Department code must contain 1–32 letters, digits, hyphens or underscores and start with a letter or digit.")
	}
	if department.Name == "" || utf8.RuneCountInString(department.Name) > 64 {
		return nil, common.NewMessage("Department name must contain 1–64 characters.")
	}
	if utf8.RuneCountInString(department.Owner) > 64 || utf8.RuneCountInString(department.Description) > 255 {
		return nil, common.NewMessage("Department owner must not exceed 64 characters; description must not exceed 255 characters.")
	}
	if department.Id < 0 || department.ParentId < 0 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var before *Department
	err := organizationTransaction(func(tx *gorm.DB) error {
		if department.Id > 0 {
			var stored Department
			if err := tx.First(&stored, department.Id).Error; err != nil {
				return err
			}
			before = &stored
			department.CreatedTime = stored.CreatedTime
		}
		var duplicates int64
		if err := tx.Model(&Department{}).Where("code = ? AND id <> ?", department.Code, department.Id).Count(&duplicates).Error; err != nil {
			return err
		}
		if duplicates > 0 {
			return common.NewMessage("Department code already exists")
		}
		visited := make(map[int]bool)
		for parentId := department.ParentId; parentId != 0; {
			if parentId == department.Id || visited[parentId] {
				return common.NewMessage("Department hierarchy cannot contain a cycle")
			}
			visited[parentId] = true
			var parent Department
			if err := tx.First(&parent, parentId).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return common.NewMessage("Parent department does not exist")
				}
				return err
			}
			if department.Enabled && !parent.Enabled {
				return common.NewMessage("Enable the parent departments first")
			}
			parentId = parent.ParentId
		}
		if department.Id > 0 && !department.Enabled {
			var children int64
			if err := tx.Model(&Department{}).Where("parent_id = ?", department.Id).Count(&children).Error; err != nil {
				return err
			}
			if children > 0 {
				return common.NewMessage("Cannot disable a department with child departments")
			}
			var projects int64
			if err := tx.Model(&Project{}).Where("department_id = ? AND enabled = ?", department.Id, true).Count(&projects).Error; err != nil {
				return err
			}
			if projects > 0 {
				return common.NewMessage("Cannot disable a department with enabled projects")
			}
		}
		department.UpdatedTime = common.GetTimestamp()
		if department.Id == 0 {
			department.CreatedTime = department.UpdatedTime
			return tx.Create(department).Error
		}
		return tx.Model(&Department{}).Where("id = ?", department.Id).
			Select("code", "name", "parent_id", "owner", "description", "enabled", "updated_time").Updates(department).Error
	})
	return before, err
}
