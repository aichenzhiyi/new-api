package controller

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectAdministration(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	require.NoError(t, model.MigrateDepartments(db))
	// Simulate upgrading the department-only schema, then repeat startup DDL.
	for range 2 {
		require.NoError(t, db.AutoMigrate(&model.Project{}))
	}
	operator := &model.User{Username: "project-root", Password: "unused", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "project-root"}
	require.NoError(t, db.Create(operator).Error)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	_, rootJWT := createAccessTokenTestSession(t, operator.Id, "project-root-session")
	admin := &model.User{Username: "project-admin", Password: "unused", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "project-admin"}
	require.NoError(t, db.Create(admin).Error)
	require.NoError(t, model.PublishUserAuthCache(admin.Id))
	_, adminJWT := createAccessTokenTestSession(t, admin.Id, "project-admin-session")
	engine := gin.New()
	engine.Use(middleware.RequestId(), middleware.AccessTokenAudit())
	routes := engine.Group("/api/projects", middleware.RootAuth())
	routes.GET("", GetProjects)
	routes.POST("", SaveProject)
	routes.PUT("/:id", SaveProject)
	routes.DELETE("/:id", DeleteProject)
	department := model.Department{Code: "COST", Name: "Cost department", Enabled: true}
	_, err := model.SaveDepartment(&department)
	require.NoError(t, err)
	otherDepartment := model.Department{Code: "OTHER", Name: "Other department", Enabled: true}
	_, err = model.SaveDepartment(&otherDepartment)
	require.NoError(t, err)

	t.Run("only root sessions can read or mutate projects", func(t *testing.T) {
		for _, request := range []struct{ method, path string }{{"GET", "/api/projects"}, {"POST", "/api/projects"}, {"PUT", "/api/projects/1"}, {"DELETE", "/api/projects/1"}} {
			assert.Equal(t, http.StatusUnauthorized, performDepartmentRequest(t, engine, request.method, request.path, "", nil).Code)
			assert.Equal(t, http.StatusForbidden, performDepartmentRequest(t, engine, request.method, request.path, adminJWT, nil).Code)
		}
	})
	var project model.Project
	t.Run("create normalizes fields and accepts only server owned identity and timestamps", func(t *testing.T) {
		response := performDepartmentRequest(t, engine, "POST", "/api/projects", rootJWT, map[string]any{
			"id": 9999, "code": " assistant ", "name": " 跨部门助手 ", "department_id": department.Id,
			"owner": " 联系人 ", "description": " 说明 ", "enabled": true, "created_time": 1, "updated_time": 1,
		})
		var result struct {
			Success bool
			Data    model.Project
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		project = result.Data
		assert.NotEqual(t, 9999, project.Id)
		assert.Equal(t, "ASSISTANT", project.Code)
		assert.Equal(t, "跨部门助手", project.Name)
		assert.Equal(t, "联系人", project.Owner)
		assert.Equal(t, "说明", project.Description)
		assert.Equal(t, department.Id, project.DepartmentId)
		assert.Greater(t, project.CreatedTime, int64(1))
	})
	t.Run("invalid input cannot change stored project", func(t *testing.T) {
		cases := []struct {
			name    string
			input   model.Project
			message string
		}{
			{"duplicate", model.Project{Code: "assistant", Name: "duplicate", DepartmentId: department.Id, Enabled: true}, "Project code already exists"},
			{"empty name", model.Project{Code: "NEW", Name: " ", DepartmentId: department.Id, Enabled: true}, "Project name must contain 1–64 characters."},
			{"long name", model.Project{Code: "NEW", Name: strings.Repeat("部", 65), DepartmentId: department.Id, Enabled: true}, "Project name must contain 1–64 characters."},
			{"invalid code", model.Project{Code: "BAD/CODE", Name: "New", DepartmentId: department.Id, Enabled: true}, "Project code must contain 1–32 letters, digits, hyphens or underscores and start with a letter or digit."},
			{"missing department", model.Project{Code: "NEW", Name: "New", DepartmentId: 9999, Enabled: true}, "Cost-bearing department does not exist"},
			{"no department", model.Project{Code: "NEW", Name: "New", Enabled: true}, "Select a cost-bearing department"},
			{"long owner", model.Project{Code: "NEW", Name: "New", DepartmentId: department.Id, Owner: strings.Repeat("人", 65), Enabled: true}, "Project owner must not exceed 64 characters; description must not exceed 255 characters."},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				response := performDepartmentRequest(t, engine, "POST", "/api/projects", rootJWT, tc.input)
				var result struct {
					Success bool
					Message string
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.False(t, result.Success)
				assert.Equal(t, tc.message, result.Message)
			})
		}
		response := performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/projects/%d", project.Id), rootJWT, map[string]any{"code": project.Code, "name": project.Name, "department_id": department.Id})
		assert.Contains(t, response.Body.String(), "Invalid parameters")
		var stored model.Project
		require.NoError(t, db.First(&stored, project.Id).Error)
		assert.Equal(t, project, stored)
		for _, id := range []string{"0", "-1", "invalid", "9999"} {
			response := performDepartmentRequest(t, engine, "PUT", "/api/projects/"+id, rootJWT, project)
			var result struct {
				Success bool
				Message string
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			if id == "9999" {
				assert.Equal(t, "Project does not exist", result.Message)
			} else {
				assert.Equal(t, "Invalid parameters", result.Message)
			}
		}
	})
	t.Run("department changes and disabling preserve identity and record before after audit", func(t *testing.T) {
		before := project
		project.DepartmentId = otherDepartment.Id
		project.Owner = ""
		project.Enabled = false
		response := performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/projects/%d", project.Id), rootJWT, project)
		var result struct {
			Success bool
			Data    model.Project
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		assert.Equal(t, before.Id, result.Data.Id)
		assert.Equal(t, before.CreatedTime, result.Data.CreatedTime)
		assert.Equal(t, otherDepartment.Id, result.Data.DepartmentId)
		assert.Empty(t, result.Data.Owner)
		assert.False(t, result.Data.Enabled)
		project = result.Data
		var event model.AuditLog
		require.NoError(t, model.LOG_DB.Where("request_id = ? AND action = ?", response.Header().Get(common.RequestIdKey), "project.update").First(&event).Error)
		assert.True(t, event.Success)
		assert.Equal(t, operator.Id, event.UserId)
		encoded, err := common.Marshal(event.Other)
		require.NoError(t, err)
		var audit struct {
			Op struct {
				Params struct {
					Before model.Project
					After  model.Project
				}
			}
		}
		require.NoError(t, common.Unmarshal(encoded, &audit))
		assert.Equal(t, before, audit.Op.Params.Before)
		assert.Equal(t, project, audit.Op.Params.After)
		response = performDepartmentRequest(t, engine, "GET", "/api/projects", rootJWT, nil)
		var listing struct {
			Success bool
			Data    []model.Project
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &listing))
		require.True(t, listing.Success)
		assert.Contains(t, listing.Data, project)
	})
	t.Run("associated projects protect departments and disabled departments block project enabling", func(t *testing.T) {
		_, err := model.DeleteDepartment(otherDepartment.Id)
		require.EqualError(t, err, "Cannot delete a department with projects")
		otherDepartment.Enabled = false
		_, err = model.SaveDepartment(&otherDepartment)
		require.NoError(t, err, "only disabled projects remain")
		project.Enabled = true
		_, err = model.SaveProject(&project)
		require.EqualError(t, err, "Enable the cost-bearing department and its ancestors first")
		otherDepartment.Enabled = true
		_, err = model.SaveDepartment(&otherDepartment)
		require.NoError(t, err)
		_, err = model.SaveProject(&project)
		require.NoError(t, err)
		otherDepartment.Enabled = false
		_, err = model.SaveDepartment(&otherDepartment)
		require.EqualError(t, err, "Cannot disable a department with enabled projects")
		_, err = model.DeleteDepartment(otherDepartment.Id)
		require.EqualError(t, err, "Cannot delete a department with projects")
	})
	t.Run("repeated schema migration preserves departments projects and unique codes", func(t *testing.T) {
		for range 2 {
			require.NoError(t, model.MigrateDepartments(db))
			require.NoError(t, db.AutoMigrate(&model.Project{}))
		}
		var stored model.Project
		require.NoError(t, db.First(&stored, project.Id).Error)
		assert.Equal(t, project, stored)
		assert.True(t, db.Migrator().HasIndex(&model.Project{}, "idx_projects_department_id"))
		require.Error(t, db.Create(&model.Project{Code: project.Code, Name: "Duplicate", DepartmentId: department.Id}).Error)
		var storedDepartment model.Department
		require.NoError(t, db.First(&storedDepartment, department.Id).Error)
		assert.Equal(t, department, storedDepartment)
	})
	t.Run("delete removes only the requested project and preserves the audit snapshot", func(t *testing.T) {
		for _, enabled := range []bool{true, false} {
			deleting := model.Project{Code: fmt.Sprintf("DELETE_%t", enabled), Name: "Delete project", DepartmentId: department.Id, Enabled: enabled}
			_, err := model.SaveProject(&deleting)
			require.NoError(t, err)
			response := performDepartmentRequest(t, engine, "DELETE", fmt.Sprintf("/api/projects/%d", deleting.Id), rootJWT, nil)
			var result struct {
				Success bool
				Message string
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			var remaining int64
			require.NoError(t, db.Model(&model.Project{}).Where("id = ?", deleting.Id).Count(&remaining).Error)
			assert.Zero(t, remaining)
			var stored model.Project
			require.NoError(t, db.First(&stored, project.Id).Error)
			assert.Equal(t, project, stored)
			var storedDepartment model.Department
			require.NoError(t, db.First(&storedDepartment, department.Id).Error)
			assert.Equal(t, department, storedDepartment)
			var event model.AuditLog
			require.NoError(t, model.LOG_DB.Where("request_id = ? AND action = ?", response.Header().Get(common.RequestIdKey), "project.delete").First(&event).Error)
			assert.True(t, event.Success)
			assert.Equal(t, operator.Id, event.UserId)
			encoded, err := common.Marshal(event.Other)
			require.NoError(t, err)
			var audit struct {
				Op struct {
					Params struct{ Before model.Project }
				}
			}
			require.NoError(t, common.Unmarshal(encoded, &audit))
			assert.Equal(t, deleting, audit.Op.Params.Before)
			response = performDepartmentRequest(t, engine, "DELETE", fmt.Sprintf("/api/projects/%d", deleting.Id), rootJWT, nil)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			assert.Equal(t, "Project does not exist", result.Message)
			response = performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/projects/%d", deleting.Id), rootJWT, deleting)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success, "an old editor cannot recreate a deleted project")
			assert.Equal(t, "Project does not exist", result.Message)
		}
		for _, id := range []string{"0", "-1", "invalid"} {
			response := performDepartmentRequest(t, engine, "DELETE", "/api/projects/"+id, rootJWT, nil)
			var result struct {
				Success bool
				Message string
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			assert.Equal(t, "Invalid parameters", result.Message)
		}
	})

	t.Run("concurrent project creation cannot race department deletion or disabling", func(t *testing.T) {
		for _, action := range []string{"delete", "disable"} {
			t.Run(action, func(t *testing.T) {
				root := model.Department{Code: "RACE_" + strings.ToUpper(action), Name: action, Enabled: true}
				_, err := model.SaveDepartment(&root)
				require.NoError(t, err)
				newProject := model.Project{Code: "RACE_" + strings.ToUpper(action), Name: action, DepartmentId: root.Id, Enabled: true}
				var projectErr, departmentErr error
				var workers sync.WaitGroup
				workers.Go(func() { _, projectErr = model.SaveProject(&newProject) })
				workers.Go(func() {
					if action == "delete" {
						_, departmentErr = model.DeleteDepartment(root.Id)
						return
					}
					root.Enabled = false
					_, departmentErr = model.SaveDepartment(&root)
				})
				workers.Wait()
				if projectErr == nil {
					require.Error(t, departmentErr)
					var stored model.Department
					require.NoError(t, db.First(&stored, root.Id).Error)
					assert.True(t, stored.Enabled)
				} else {
					require.NoError(t, departmentErr)
					if action == "delete" {
						assert.EqualError(t, projectErr, "Cost-bearing department does not exist")
					} else {
						assert.EqualError(t, projectErr, "Enable the cost-bearing department and its ancestors first")
					}
				}
			})
		}
	})
}
