package model

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// DepartmentId identifies the single department responsible for the project's
// costs, including projects whose participants span multiple departments.
// Owner is contact information; account membership belongs to a later batch.
type Project struct {
	Id           int    `json:"id"`
	Code         string `json:"code" gorm:"size:32;not null;uniqueIndex"`
	Name         string `json:"name" gorm:"size:64;not null"`
	DepartmentId int    `json:"department_id" gorm:"not null;index"`
	Owner        string `json:"owner" gorm:"size:64;not null"`
	Description  string `json:"description" gorm:"size:255;not null"`
	Enabled      bool   `json:"enabled" gorm:"not null"`
	CreatedTime  int64  `json:"created_time" gorm:"bigint;not null"`
	UpdatedTime  int64  `json:"updated_time" gorm:"bigint;not null"`
}

func GetProjects() ([]Project, error) {
	projects := make([]Project, 0)
	err := DB.Order("code ASC").Find(&projects).Error
	return projects, err
}

// DeleteProject returns the deleted snapshot for internal management callers.
// Existing account assignments block deletion; future API-key and usage bindings
// must extend these checks before allowing deletion of associated data.
func DeleteProject(id int) (*Project, error) {
	return deleteProjectForUser(0, id)
}

func DeleteProjectForUser(userId, id int) (*Project, error) {
	if userId < 1 {
		return nil, ErrProjectAccessDenied
	}
	return deleteProjectForUser(userId, id)
}

func deleteProjectForUser(userId, id int) (*Project, error) {
	if id < 1 {
		return nil, common.NewMessage("Invalid parameters")
	}
	var project Project
	err := organizationTransaction(func(tx *gorm.DB) error {
		if userId > 0 {
			query, root, err := ApplyProjectScope(tx, userId)
			if err != nil {
				return err
			}
			if !root {
				if err := query.Where("id = ?", id).First(&project).Error; err != nil {
					return ErrProjectAccessDenied
				}
			}
		}
		if err := lockForUpdate(tx).First(&project, id).Error; err != nil {
			return err
		}
		var members int64
		if err := tx.Model(&UserProject{}).Where("project_id = ?", id).Count(&members).Error; err != nil {
			return err
		}
		if members > 0 {
			return common.NewMessage("Remove project account assignments before deleting the project")
		}
		if tx.Migrator().HasTable(&EnterpriseModelProject{}) {
			// Use a current read after locking the project. MySQL repeatable-read
			// snapshots may predate a profile assignment that held this row lock.
			var assignments []EnterpriseModelProject
			if err := lockForUpdate(tx).Where("project_id = ?", id).Limit(1).Find(&assignments).Error; err != nil {
				return err
			}
			if len(assignments) > 0 {
				return common.NewMessage("Remove enterprise model assignments before deleting the project")
			}
		}
		return tx.Delete(&project).Error
	})
	return &project, err
}

// SaveProject uses the same organization lock as department mutations, so a
// department cannot be deleted or disabled concurrently with project changes.
// The previous snapshot is returned for the management audit.
func SaveProject(project *Project) (*Project, error) {
	return saveProjectForUser(0, project)
}

func SaveProjectForUser(userId int, project *Project) (*Project, error) {
	if userId < 1 {
		return nil, ErrProjectAccessDenied
	}
	return saveProjectForUser(userId, project)
}

func saveProjectForUser(userId int, project *Project) (*Project, error) {
	project.Code = strings.ToUpper(strings.TrimSpace(project.Code))
	project.Name = strings.TrimSpace(project.Name)
	project.Owner = strings.TrimSpace(project.Owner)
	project.Description = strings.TrimSpace(project.Description)
	if !departmentCodePattern.MatchString(project.Code) {
		return nil, common.NewMessage("Project code must contain 1–32 letters, digits, hyphens or underscores and start with a letter or digit.")
	}
	if project.Name == "" || utf8.RuneCountInString(project.Name) > 64 {
		return nil, common.NewMessage("Project name must contain 1–64 characters.")
	}
	if utf8.RuneCountInString(project.Owner) > 64 || utf8.RuneCountInString(project.Description) > 255 {
		return nil, common.NewMessage("Project owner must not exceed 64 characters; description must not exceed 255 characters.")
	}
	if project.Id < 0 || project.DepartmentId < 1 {
		return nil, common.NewMessage("Select a cost-bearing department")
	}
	var before *Project
	err := organizationTransaction(func(tx *gorm.DB) error {
		if userId > 0 {
			query, root, err := ApplyProjectScope(tx, userId)
			if err != nil {
				return err
			}
			if !root {
				var current Project
				if project.Id < 1 {
					return ErrProjectAccessDenied
				}
				if err := query.Where("id = ?", project.Id).First(&current).Error; err != nil {
					return ErrProjectAccessDenied
				}
				if current.DepartmentId != project.DepartmentId {
					return common.NewMessage("Only global administrators can change the cost-bearing department")
				}
			}
		}
		if project.Id > 0 {
			var stored Project
			if err := tx.First(&stored, project.Id).Error; err != nil {
				return err
			}
			before = &stored
			project.CreatedTime = stored.CreatedTime
		}
		var duplicates int64
		if err := tx.Model(&Project{}).Where("code = ? AND id <> ?", project.Code, project.Id).Count(&duplicates).Error; err != nil {
			return err
		}
		if duplicates > 0 {
			return common.NewMessage("Project code already exists")
		}
		visited := make(map[int]bool)
		for departmentId := project.DepartmentId; departmentId != 0; {
			if visited[departmentId] {
				return common.NewMessage("Department hierarchy cannot contain a cycle")
			}
			visited[departmentId] = true
			var department Department
			if err := tx.First(&department, departmentId).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return common.NewMessage("Cost-bearing department does not exist")
				}
				return err
			}
			if project.Enabled && !department.Enabled {
				return common.NewMessage("Enable the cost-bearing department and its ancestors first")
			}
			departmentId = department.ParentId
		}
		project.UpdatedTime = common.GetTimestamp()
		if project.Id == 0 {
			project.CreatedTime = project.UpdatedTime
			return tx.Create(project).Error
		}
		return tx.Model(&Project{}).Where("id = ?", project.Id).
			Select("code", "name", "department_id", "owner", "description", "enabled", "updated_time").Updates(project).Error
	})
	return before, err
}
