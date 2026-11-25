package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
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

type departmentTestResponse struct {
	Success bool             `json:"success"`
	Message string           `json:"message"`
	Data    model.Department `json:"data"`
}

func performDepartmentRequest(t *testing.T, handler http.Handler, method, path, token string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	request := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

// TEST_MANAGE_USER_DIALECT and TEST_{MYSQL,POSTGRES}_DSN select the same
// isolated database fixture as the existing management API tests.
func TestDepartmentAdministration(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	require.NoError(t, model.MigrateDepartments(db))
	require.NoError(t, model.MigrateDepartments(db))
	require.NoError(t, db.AutoMigrate(&model.Project{}, &model.UserOrganization{}, &model.UserProject{}))
	operator := &model.User{Username: "department-root", Password: "unused", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "department-root"}
	require.NoError(t, db.Create(operator).Error)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	_, rootJWT := createAccessTokenTestSession(t, operator.Id, "department-root-session")
	admin := &model.User{Username: "department-admin", Password: "unused", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "department-admin"}
	require.NoError(t, db.Create(admin).Error)
	require.NoError(t, model.PublishUserAuthCache(admin.Id))
	_, adminJWT := createAccessTokenTestSession(t, admin.Id, "department-admin-session")
	engine := gin.New()
	engine.Use(middleware.RequestId(), middleware.AccessTokenAudit())
	routes := engine.Group("/api/departments", middleware.RootAuth())
	routes.GET("", GetDepartments)
	routes.POST("", SaveDepartment)
	routes.PUT("/:id", SaveDepartment)
	routes.DELETE("/:id", DeleteDepartment)

	t.Run("only root sessions can read or mutate departments", func(t *testing.T) {
		for _, request := range []struct{ method, path string }{{"GET", "/api/departments"}, {"POST", "/api/departments"}, {"PUT", "/api/departments/1"}, {"DELETE", "/api/departments/1"}} {
			assert.Equal(t, http.StatusUnauthorized, performDepartmentRequest(t, engine, request.method, request.path, "", nil).Code)
			assert.Equal(t, http.StatusForbidden, performDepartmentRequest(t, engine, request.method, request.path, adminJWT, nil).Code)
		}
	})
	var parent, child model.Department
	t.Run("create normalizes code and ignores server owned fields", func(t *testing.T) {
		response := performDepartmentRequest(t, engine, "POST", "/api/departments", rootJWT, map[string]any{
			"id": 9999, "code": " sales ", "name": " 销售部 ", "enabled": true,
			"owner": "负责人", "cost_center": "CC-SALES", "created_time": 1,
		})
		var result departmentTestResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		assert.NotContains(t, response.Body.String(), `"cost_center"`)
		parent = result.Data
		assert.NotEqual(t, 9999, parent.Id)
		assert.Equal(t, "SALES", parent.Code)
		assert.Equal(t, "销售部", parent.Name)
		assert.Greater(t, parent.CreatedTime, int64(1))
		response = performDepartmentRequest(t, engine, "POST", "/api/departments", rootJWT, model.Department{Code: "SUPPORT", Name: "客服组", ParentId: parent.Id, Enabled: true})
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		child = result.Data
	})
	t.Run("invalid edits leave the department unchanged", func(t *testing.T) {
		cases := []struct {
			name    string
			input   model.Department
			message string
		}{
			{"cycle", model.Department{Code: parent.Code, Name: parent.Name, ParentId: child.Id, Enabled: true}, "Department hierarchy cannot contain a cycle"},
			{"self parent", model.Department{Code: parent.Code, Name: parent.Name, ParentId: parent.Id, Enabled: true}, "Department hierarchy cannot contain a cycle"},
			{"missing parent", model.Department{Code: parent.Code, Name: parent.Name, ParentId: 9999, Enabled: true}, "Parent department does not exist"},
			{"active child", model.Department{Code: parent.Code, Name: parent.Name, Enabled: false}, "Cannot disable a department with child departments"},
			{"duplicate code", model.Department{Code: strings.ToLower(child.Code), Name: parent.Name, Enabled: true}, "Department code already exists"},
			{"blank name", model.Department{Code: parent.Code, Name: " ", Enabled: true}, "Department name must contain 1–64 characters."},
			{"long name", model.Department{Code: parent.Code, Name: strings.Repeat("部", 65), Enabled: true}, "Department name must contain 1–64 characters."},
			{"invalid code", model.Department{Code: "DEPT/SALES", Name: parent.Name, Enabled: true}, "Department code must contain 1–32 letters, digits, hyphens or underscores and start with a letter or digit."},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				response := performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", parent.Id), rootJWT, tc.input)
				var result departmentTestResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.False(t, result.Success)
				assert.Equal(t, tc.message, result.Message)
				var stored model.Department
				require.NoError(t, db.First(&stored, parent.Id).Error)
				assert.Equal(t, parent, stored)
			})
		}
		for _, payload := range []any{map[string]any{"code": "NEW", "name": "New"}, map[string]any{"code": "NEW", "name": "New", "enabled": true, "parent_id": -1}} {
			response := performDepartmentRequest(t, engine, "POST", "/api/departments", rootJWT, payload)
			var result departmentTestResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
		}
	})
	t.Run("updates need no version and the last successful save wins", func(t *testing.T) {
		payload := map[string]any{
			"code": parent.Code, "name": parent.Name, "parent_id": parent.ParentId,
			"owner": "First owner", "description": "", "enabled": true,
		}
		response := performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", parent.Id), rootJWT, payload)
		var result departmentTestResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		assert.Equal(t, "First owner", result.Data.Owner)
		payload["owner"] = "Second owner"
		response = performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", parent.Id), rootJWT, payload)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		assert.Equal(t, "Second owner", result.Data.Owner)
		assert.Equal(t, parent.Id, result.Data.Id)
		assert.Equal(t, parent.CreatedTime, result.Data.CreatedTime)
		parent = result.Data
	})
	t.Run("disable retains identity and ancestors must be enabled first", func(t *testing.T) {
		child.Enabled = false
		response := performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", child.Id), rootJWT, child)
		var result departmentTestResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		child = result.Data
		blockedParent := parent
		blockedParent.Enabled = false
		response = performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", parent.Id), rootJWT, blockedParent)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.False(t, result.Success, "disabled child departments must also block disabling the parent")
		assert.Equal(t, "Cannot disable a department with child departments", result.Message)
		var storedParent model.Department
		require.NoError(t, db.First(&storedParent, parent.Id).Error)
		assert.Equal(t, parent, storedParent)
		// Moving the disabled child out removes the dependency without deleting it.
		child.ParentId = 0
		response = performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", child.Id), rootJWT, child)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		child = result.Data
		parent.Enabled = false
		parent.Owner = ""
		response = performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", parent.Id), rootJWT, parent)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		parent = result.Data
		assert.Empty(t, parent.Owner)
		child.Enabled = true
		child.ParentId = parent.Id
		response = performDepartmentRequest(t, engine, "PUT", fmt.Sprintf("/api/departments/%d", child.Id), rootJWT, child)
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.False(t, result.Success)
		assert.Equal(t, "Enable the parent departments first", result.Message)
		response = performDepartmentRequest(t, engine, "GET", "/api/departments", rootJWT, nil)
		var listing struct {
			Success bool               `json:"success"`
			Data    []model.Department `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &listing))
		require.True(t, listing.Success)
		require.Len(t, listing.Data, 2)
		for _, row := range listing.Data {
			assert.False(t, row.Enabled)
		}
		var storedChild model.Department
		require.NoError(t, db.First(&storedChild, child.Id).Error)
		assert.Zero(t, storedChild.ParentId)
	})
	t.Run("repeated migration preserves data and unique codes", func(t *testing.T) {
		for range 2 {
			require.NoError(t, model.MigrateDepartments(db))
		}
		var stored model.Department
		require.NoError(t, db.First(&stored, parent.Id).Error)
		assert.Equal(t, parent, stored)
		require.Error(t, db.Create(&model.Department{Code: parent.Code, Name: "duplicate"}).Error)
	})
	t.Run("successful changes record actor and before after snapshots", func(t *testing.T) {
		var events []model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ? OR action = ?", "department.create", "department.update").Order("id ASC").Find(&events).Error)
		var successful []model.AuditLog
		for _, event := range events {
			if event.Success {
				successful = append(successful, event)
			}
		}
		require.Len(t, successful, 7)
		for _, event := range successful {
			assert.Equal(t, operator.Id, event.UserId)
			assert.Equal(t, common.RoleRootUser, event.ActorRole)
			assert.NotEmpty(t, event.RequestId)
			assert.NotEmpty(t, event.CreatedAt)
		}
		encoded, err := common.Marshal(successful[len(successful)-1].Other)
		require.NoError(t, err)
		assert.Contains(t, string(encoded), `"before"`)
		assert.Contains(t, string(encoded), `"after"`)
		assert.Contains(t, string(encoded), `"owner":"Second owner"`)
	})
	t.Run("concurrent moves cannot create a hierarchy cycle", func(t *testing.T) {
		first := model.Department{Code: "BRANCH_A", Name: "Branch A", Enabled: true}
		second := model.Department{Code: "BRANCH_B", Name: "Branch B", Enabled: true}
		_, err := model.SaveDepartment(&first)
		require.NoError(t, err)
		_, err = model.SaveDepartment(&second)
		require.NoError(t, err)
		first.ParentId, second.ParentId = second.Id, first.Id
		moves := []*model.Department{&first, &second}
		errors := make([]error, len(moves))
		var workers sync.WaitGroup
		for i := range moves {
			workers.Go(func() { _, errors[i] = model.SaveDepartment(moves[i]) })
		}
		workers.Wait()
		successes := 0
		for _, err := range errors {
			if err == nil {
				successes++
			} else {
				assert.EqualError(t, err, "Department hierarchy cannot contain a cycle")
			}
		}
		assert.Equal(t, 1, successes)
		var stored []model.Department
		require.NoError(t, db.Where("id IN ?", []int{first.Id, second.Id}).Find(&stored).Error)
		require.Len(t, stored, 2)
		assert.True(t, stored[0].ParentId == 0 || stored[1].ParentId == 0)
	})
	t.Run("delete rejects any children and removes only leaf departments", func(t *testing.T) {
		for _, childEnabled := range []bool{true, false} {
			root := model.Department{Code: fmt.Sprintf("DELETE_PARENT_%t", childEnabled), Name: "Delete parent", Enabled: true}
			_, err := model.SaveDepartment(&root)
			require.NoError(t, err)
			leaf := model.Department{Code: fmt.Sprintf("DELETE_CHILD_%t", childEnabled), Name: "Delete child", ParentId: root.Id, Enabled: childEnabled}
			_, err = model.SaveDepartment(&leaf)
			require.NoError(t, err)
			response := performDepartmentRequest(t, engine, "DELETE", fmt.Sprintf("/api/departments/%d", root.Id), rootJWT, nil)
			var result departmentTestResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			assert.Equal(t, "Cannot delete a department with child departments", result.Message)
			var stored model.Department
			require.NoError(t, db.First(&stored, root.Id).Error)
			assert.Equal(t, root, stored)
			response = performDepartmentRequest(t, engine, "DELETE", fmt.Sprintf("/api/departments/%d", leaf.Id), rootJWT, nil)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			var remaining int64
			require.NoError(t, db.Model(&model.Department{}).Where("id = ?", leaf.Id).Count(&remaining).Error)
			assert.Zero(t, remaining)
			var event model.AuditLog
			require.NoError(t, model.LOG_DB.Where("request_id = ? AND action = ?", response.Header().Get(common.RequestIdKey), "department.delete").First(&event).Error)
			assert.True(t, event.Success)
			assert.Equal(t, operator.Id, event.UserId)
			encoded, err := common.Marshal(event.Other)
			require.NoError(t, err)
			assert.Contains(t, string(encoded), `"before"`)
			assert.Contains(t, string(encoded), leaf.Code)
			response = performDepartmentRequest(t, engine, "DELETE", fmt.Sprintf("/api/departments/%d", root.Id), rootJWT, nil)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success, response.Body.String())
			response = performDepartmentRequest(t, engine, "DELETE", fmt.Sprintf("/api/departments/%d", root.Id), rootJWT, nil)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			assert.Equal(t, "Department does not exist", result.Message)
		}
		for _, id := range []string{"0", "-1", "invalid"} {
			response := performDepartmentRequest(t, engine, "DELETE", "/api/departments/"+id, rootJWT, nil)
			var result departmentTestResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			assert.Equal(t, "Invalid parameters", result.Message)
		}
	})
	t.Run("concurrent deletion and child creation cannot leave an orphan", func(t *testing.T) {
		root := model.Department{Code: "RACE_PARENT", Name: "Race parent", Enabled: true}
		_, err := model.SaveDepartment(&root)
		require.NoError(t, err)
		leaf := model.Department{Code: "RACE_CHILD", Name: "Race child", ParentId: root.Id, Enabled: true}
		var deleteErr, createErr error
		var workers sync.WaitGroup
		workers.Go(func() { _, deleteErr = model.DeleteDepartment(root.Id) })
		workers.Go(func() { _, createErr = model.SaveDepartment(&leaf) })
		workers.Wait()
		if deleteErr == nil {
			require.EqualError(t, createErr, "Parent department does not exist")
		} else {
			require.NoError(t, createErr)
			assert.EqualError(t, deleteErr, "Cannot delete a department with child departments")
			var stored model.Department
			require.NoError(t, db.First(&stored, leaf.ParentId).Error)
		}
	})
}

func TestDepartmentRetiredFieldsMigration(t *testing.T) {
	for _, versionPresent := range []bool{true, false} {
		t.Run(fmt.Sprintf("legacy_version_%t", versionPresent), func(t *testing.T) {
			db := setupManageUserTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.Option{}))
			legacy := struct {
				model.Department
				Version    int    `gorm:"not null"`
				CostCenter string `gorm:"size:64;not null"`
			}{Department: model.Department{
				Code: "LEGACY", Name: "Existing department", Owner: "Owner",
				Enabled: true, CreatedTime: 10, UpdatedTime: 20,
			}, Version: 7, CostCenter: "CC-LEGACY"}
			require.NoError(t, db.Table("departments").AutoMigrate(&legacy))
			require.NoError(t, db.Table("departments").Create(&legacy).Error)
			if !versionPresent {
				require.NoError(t, db.Table("departments").Migrator().DropColumn(&legacy, "version"))
			}
			for range 2 {
				require.NoError(t, model.MigrateDepartments(db))
			}
			assert.False(t, db.Migrator().HasColumn(&model.Department{}, "version"))
			assert.False(t, db.Migrator().HasColumn(&model.Department{}, "cost_center"))
			var stored model.Department
			require.NoError(t, db.First(&stored, legacy.Id).Error)
			assert.Equal(t, legacy.Department, stored)
			assert.True(t, db.Migrator().HasIndex(&model.Department{}, "idx_departments_parent_id"))
			require.Error(t, db.Create(&model.Department{Code: stored.Code, Name: "Duplicate"}).Error)
			created := model.Department{Code: "NEW", Name: "New department", ParentId: stored.Id, Enabled: true}
			_, err := model.SaveDepartment(&created)
			require.NoError(t, err, "retired NOT NULL columns must not block new departments")
			stored.Name = "Renamed department"
			_, err = model.SaveDepartment(&stored)
			require.NoError(t, err)
			assert.Equal(t, int64(10), stored.CreatedTime)
			var count int64
			require.NoError(t, db.Model(&model.Department{}).Count(&count).Error)
			assert.EqualValues(t, 2, count)
		})
	}
}
