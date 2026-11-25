package model

import (
	"errors"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrProjectAccessDenied = errors.New("No permission to access this project")

// Organization membership is separate from User to keep self-service account
// updates and login payloads from accepting or exposing authorization fields.
type UserOrganization struct {
	UserId       int `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	DepartmentId int `json:"department_id" gorm:"not null;index"`
}

type UserProject struct {
	UserId    int `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	ProjectId int `json:"project_id" gorm:"primaryKey;autoIncrement:false;index"`
}

type UserOrganizationAssignment struct {
	DepartmentId int   `json:"department_id"`
	ProjectIds   []int `json:"project_ids"`
}

func GetUserOrganization(userId int) (*UserOrganizationAssignment, error) {
	return userOrganizationWithTx(DB, userId)
}

// Older installations and authentication fixtures may not have organization
// tables yet. Where present, delete membership with the account transaction.
func removeUserOrganizationWithTx(tx *gorm.DB, userId int) error {
	for _, relation := range []any{&UserProject{}, &UserOrganization{}} {
		if !tx.Migrator().HasTable(relation) {
			continue
		}
		if err := tx.Where("user_id = ?", userId).Delete(relation).Error; err != nil {
			return err
		}
	}
	return nil
}

func userOrganizationWithTx(tx *gorm.DB, userId int) (*UserOrganizationAssignment, error) {
	var user User
	if err := tx.Select("id").First(&user, userId).Error; err != nil {
		return nil, err
	}
	result := &UserOrganizationAssignment{ProjectIds: make([]int, 0)}
	var organization UserOrganization
	if err := tx.Where("user_id = ?", userId).First(&organization).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	result.DepartmentId = organization.DepartmentId
	err := tx.Model(&UserProject{}).Where("user_id = ?", userId).Order("project_id ASC").Pluck("project_id", &result.ProjectIds).Error
	return result, err
}

// ApplyProjectScope is the shared boundary for queries on Project. It reads
// persisted authorization on every request; department membership never grants
// implicit project access. Callers must propagate errors (deny on failure).
func ApplyProjectScope(tx *gorm.DB, userId int) (*gorm.DB, bool, error) {
	var user User
	if userId < 1 {
		return nil, false, ErrProjectAccessDenied
	}
	if err := tx.Select("id", "role", "status").First(&user, userId).Error; err != nil {
		return nil, false, err
	}
	if user.Status != common.UserStatusEnabled {
		return nil, false, ErrProjectAccessDenied
	}
	query := tx.Model(&Project{})
	if user.Role == common.RoleRootUser {
		return query, true, nil
	}
	return query.Where("id IN (?)", tx.Model(&UserProject{}).Select("project_id").Where("user_id = ?", userId)), false, nil
}

func GetProjectsForUser(userId int) ([]Project, error) {
	query, _, err := ApplyProjectScope(DB, userId)
	if err != nil {
		return nil, err
	}
	projects := make([]Project, 0)
	err = query.Order("code ASC").Find(&projects).Error
	return projects, err
}

func GetProjectForUser(userId, projectId int) (*Project, error) {
	query, _, err := ApplyProjectScope(DB, userId)
	if err != nil {
		return nil, err
	}
	var project Project
	if err := query.Where("id = ?", projectId).First(&project).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProjectAccessDenied
		}
		return nil, err
	}
	return &project, nil
}

// Only expose department names needed to render authorized projects, rather
// than the global organization hierarchy, contacts or unrelated departments.
func GetProjectDepartmentsForUser(userId int) ([]Department, error) {
	query, root, err := ApplyProjectScope(DB, userId)
	if err != nil {
		return nil, err
	}
	departments := make([]Department, 0)
	departmentQuery := DB.Model(&Department{}).Select("id", "code", "name", "enabled")
	if !root {
		departmentQuery = departmentQuery.Where("id IN (?)", query.Select("department_id"))
	}
	err = departmentQuery.Order("code ASC").Find(&departments).Error
	return departments, err
}

// SaveUserOrganization replaces the whole assignment atomically. Authorization
// changes advance the target's authentication version so existing sessions and
// proofs cannot carry privileges across the change; the user must sign in again.
func SaveUserOrganization(actorId, userId int, assignment *UserOrganizationAssignment) (*UserOrganizationAssignment, error) {
	if userId < 1 || assignment.DepartmentId < 0 || assignment.ProjectIds == nil || len(assignment.ProjectIds) > 1000 {
		return nil, common.NewMessage("Invalid parameters")
	}
	assignment.ProjectIds = slices.Clone(assignment.ProjectIds)
	slices.Sort(assignment.ProjectIds)
	assignment.ProjectIds = slices.Compact(assignment.ProjectIds)
	if len(assignment.ProjectIds) > 0 && (assignment.ProjectIds[0] < 1 || assignment.DepartmentId == 0) {
		return nil, common.NewMessage("Select an account department before assigning projects")
	}
	var before *UserOrganizationAssignment
	var version int64
	err := organizationTransaction(func(tx *gorm.DB) error {
		_, root, err := ApplyProjectScope(tx, actorId)
		if err != nil {
			return err
		}
		if !root {
			return ErrProjectAccessDenied
		}
		var user User
		if err := lockForUpdate(tx).Select("id", "role", "status").First(&user, userId).Error; err != nil {
			return err
		}
		if user.Role == common.RoleRootUser {
			return common.NewMessage("Global administrators do not need project assignments")
		}
		before, err = userOrganizationWithTx(tx, userId)
		if err != nil {
			return err
		}
		if before.DepartmentId == assignment.DepartmentId && slices.Equal(before.ProjectIds, assignment.ProjectIds) {
			return nil
		}
		if assignment.DepartmentId > 0 && assignment.DepartmentId != before.DepartmentId {
			var department Department
			if err := tx.First(&department, assignment.DepartmentId).Error; err != nil {
				return common.NewMessage("Account department does not exist")
			}
			if !department.Enabled {
				return common.NewMessage("Enable the account department first")
			}
		}
		for _, projectId := range assignment.ProjectIds {
			var project Project
			if err := tx.First(&project, projectId).Error; err != nil {
				return common.NewMessage("Assigned project does not exist")
			}
			if !project.Enabled && !slices.Contains(before.ProjectIds, projectId) {
				return common.NewMessage("Enable the project before assigning it")
			}
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.AssignmentColumns([]string{"department_id"})}).Create(&UserOrganization{UserId: userId, DepartmentId: assignment.DepartmentId}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userId).Delete(&UserProject{}).Error; err != nil {
			return err
		}
		for _, projectId := range assignment.ProjectIds {
			if err := tx.Create(&UserProject{UserId: userId, ProjectId: projectId}).Error; err != nil {
				return err
			}
		}
		version, err = IncrementUserAuthVersionWithTx(tx, userId)
		return err
	})
	if err != nil {
		return nil, err
	}
	if version > 0 {
		if _, err := RevokeAllUserSessions(userId, "project_assignment_changed"); err != nil {
			return before, err
		}
		if err := publishCommittedUserAuthVersion(userId, version); err != nil {
			return before, err
		}
	}
	return before, nil
}
