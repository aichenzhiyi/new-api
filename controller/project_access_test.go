package controller

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectAccountIsolation(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Department{}, &model.Project{}))
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		// Exercise the shipped manual provisioning path before startup AutoMigrate.
		script, err := os.ReadFile("../notes/sql/03-project-accounts.mysql8.sql")
		require.NoError(t, err)
		var sql strings.Builder
		for line := range strings.SplitSeq(string(script), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				sql.WriteString(line)
				sql.WriteByte('\n')
			}
		}
		for statement := range strings.SplitSeq(sql.String(), ";") {
			if strings.TrimSpace(statement) != "" {
				require.NoError(t, db.Exec(statement).Error)
			}
		}
	}
	// Upgrade the preceding department/project schema, then repeat startup DDL.
	for range 2 {
		require.NoError(t, db.AutoMigrate(&model.UserOrganization{}, &model.UserProject{}))
	}
	users := make([]model.User, 4)
	for i := range users {
		role := common.RoleCommonUser
		if i == 0 {
			role = common.RoleRootUser
		}
		users[i] = model.User{Username: fmt.Sprintf("project-scope-%d", i), Password: "unused", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: fmt.Sprintf("scope-%d", i)}
		require.NoError(t, db.Create(&users[i]).Error)
		require.NoError(t, model.PublishUserAuthCache(users[i].Id))
	}
	rootIdentity, rootJWT := createAccessTokenTestSession(t, users[0].Id, "scope-root")
	_, firstJWT := createAccessTokenTestSession(t, users[1].Id, "scope-first")
	_, secondJWT := createAccessTokenTestSession(t, users[2].Id, "scope-second")
	_, thirdJWT := createAccessTokenTestSession(t, users[3].Id, "scope-third")
	departments := []model.Department{{Code: "SCOPE_A", Name: "Department A", Owner: "Private contact A", Enabled: true}, {Code: "SCOPE_B", Name: "Department B", Enabled: true}}
	for i := range departments {
		_, err := model.SaveDepartment(&departments[i])
		require.NoError(t, err)
	}
	projects := []model.Project{{Code: "SCOPE_X", Name: "Project X", DepartmentId: departments[0].Id, Enabled: true}, {Code: "SCOPE_Y", Name: "Project Y", DepartmentId: departments[0].Id, Enabled: true}, {Code: "SCOPE_Z", Name: "Project Z", DepartmentId: departments[1].Id, Enabled: true}}
	for i := range projects {
		_, err := model.SaveProject(&projects[i])
		require.NoError(t, err)
	}
	engine := gin.New()
	engine.Use(middleware.RequestId(), middleware.AccessTokenAudit())
	routes := engine.Group("/api/projects", middleware.UserAuth())
	routes.GET("", GetProjects)
	routes.GET("/departments", GetProjectDepartments)
	routes.GET("/:id", GetProject)
	routes.POST("", middleware.RootAuth(), SaveProject)
	routes.PUT("/:id", SaveProject)
	routes.DELETE("/:id", DeleteProject)
	accounts := engine.Group("/api/user", middleware.RootAuth())
	accounts.GET("/:id/organization", GetUserOrganization)
	accounts.PUT("/:id/organization", UpdateUserOrganization)
	engine.PUT("/api/user/self", middleware.UserAuth(), UpdateSelf)
	assign := func(userId int, assignment model.UserOrganizationAssignment) string {
		t.Helper()
		context, err := common.Marshal(service.AdminUserContext{UserID: userId})
		require.NoError(t, err)
		binding, err := service.BindVerificationOperation(service.VerificationOperation{Scope: service.VerificationScopeAdminUserUpdate, Context: context})
		require.NoError(t, err)
		proof, _, err := service.IssueSecurityProof(rootIdentity, service.VerificationMethodPassword, binding)
		require.NoError(t, err)
		body, err := common.Marshal(assignment)
		require.NoError(t, err)
		response := accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/user/%d/organization", userId), rootJWT, proof, string(body))
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var result struct {
			Success bool
			Message string
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		return proof
	}
	signIn := func(userId int) string {
		t.Helper()
		bundle, err := service.CreateLoginSession(userId, "password", "127.0.0.1", "project-scope-test")
		require.NoError(t, err)
		return bundle.AccessToken
	}
	t.Run("assignment requires root and an operation bound single use proof", func(t *testing.T) {
		path := fmt.Sprintf("/api/user/%d/organization", users[1].Id)
		for _, token := range []string{firstJWT, secondJWT} {
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "GET", path, token, "", "").Code)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "PUT", path, token, "", `{"department_id":1,"project_ids":[1]}`).Code)
		}
		assert.Equal(t, http.StatusUnauthorized, accessTokenRequest(engine, "PUT", path, "", "", `{}`).Code)
		response := accessTokenRequest(engine, "PUT", path, rootJWT, "", `{"department_id":1,"project_ids":[1]}`)
		assert.NotEqual(t, http.StatusOK, response.Code, response.Body.String())
		context, err := common.Marshal(service.AdminUserContext{UserID: users[1].Id})
		require.NoError(t, err)
		binding, err := service.BindVerificationOperation(service.VerificationOperation{Scope: service.VerificationScopeAdminUserUpdate, Context: context})
		require.NoError(t, err)
		unspent, _, err := service.IssueSecurityProof(rootIdentity, service.VerificationMethodPassword, binding)
		require.NoError(t, err)
		wrong := accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/user/%d/organization", users[2].Id), rootJWT, unspent, `{"department_id":1,"project_ids":[]}`)
		assert.Equal(t, http.StatusForbidden, wrong.Code)
		require.NoError(t, db.Model(&model.AuthFlow{}).Where("purpose = ? AND consumed_at IS NULL", model.AuthFlowPurposeSecurityProof).Update("expires_at", time.Now().Add(-time.Minute)).Error)
		expired := accessTokenRequest(engine, "PUT", path, rootJWT, unspent, `{"department_id":1,"project_ids":[]}`)
		assert.Equal(t, http.StatusForbidden, expired.Code)
		assert.Contains(t, expired.Body.String(), "SECURITY_PROOF_EXPIRED")
		proof := assign(users[1].Id, model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{projects[0].Id, projects[2].Id, projects[0].Id}})
		response = accessTokenRequest(engine, "PUT", path, rootJWT, proof, `{"department_id":1,"project_ids":[]}`)
		assert.NotEqual(t, http.StatusOK, response.Code, "proof reuse must fail")
		response = accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/user/%d/organization", users[2].Id), rootJWT, proof, `{"department_id":1,"project_ids":[]}`)
		assert.NotEqual(t, http.StatusOK, response.Code, "proof for another user must fail")
		stored, err := model.GetUserOrganization(users[1].Id)
		require.NoError(t, err)
		assert.Equal(t, []int{projects[0].Id, projects[2].Id}, stored.ProjectIds)
		// Pre-change sessions are invalidated, including when access was added.
		assert.Equal(t, http.StatusUnauthorized, accessTokenRequest(engine, "GET", "/api/projects", firstJWT, "", "").Code)
		firstJWT = signIn(users[1].Id)
		assign(users[2].Id, model.UserOrganizationAssignment{DepartmentId: departments[1].Id, ProjectIds: []int{projects[0].Id}})
		secondJWT = signIn(users[2].Id)
		assign(users[3].Id, model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{}})
		thirdJWT = signIn(users[3].Id)
	})
	t.Run("personal access tokens cannot use browser project or assignment APIs", func(t *testing.T) {
		token, _ := createScopedAccessToken(t, users[0].Id, 0, "user:read", "user:write", "profile:read")
		for _, route := range []struct{ method, path, body string }{
			{"GET", "/api/projects", ""}, {"GET", "/api/projects/departments", ""},
			{"GET", fmt.Sprintf("/api/projects/%d", projects[0].Id), ""},
			{"GET", fmt.Sprintf("/api/user/%d/organization", users[1].Id), ""},
			{"PUT", fmt.Sprintf("/api/user/%d/organization", users[1].Id), `{"department_id":1,"project_ids":[]}`},
		} {
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, route.method, route.path, token, "", route.body).Code)
		}
	})
	t.Run("lists and details use explicit projects rather than department or supplied user IDs", func(t *testing.T) {
		response := accessTokenRequest(engine, "GET", "/api/projects?user_id="+fmt.Sprint(users[0].Id), firstJWT, "", "")
		var result struct {
			Success bool
			Data    []model.Project
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success)
		require.Len(t, result.Data, 2)
		assert.Equal(t, projects[0].Id, result.Data[0].Id)
		assert.Equal(t, projects[2].Id, result.Data[1].Id)
		for _, token := range []string{firstJWT, secondJWT, thirdJWT} {
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "GET", fmt.Sprintf("/api/projects/%d", projects[1].Id), token, "", "").Code)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "DELETE", fmt.Sprintf("/api/projects/%d", projects[1].Id), token, "", "").Code)
		}
		response = accessTokenRequest(engine, "GET", "/api/projects", thirdJWT, "", "")
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Empty(t, result.Data)
		response = accessTokenRequest(engine, "GET", "/api/projects/departments", secondJWT, "", "")
		assert.NotContains(t, response.Body.String(), "Private contact A")
		var departmentResult struct{ Data []model.Department }
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &departmentResult))
		require.Len(t, departmentResult.Data, 1)
		assert.Equal(t, departments[0].Id, departmentResult.Data[0].Id)
	})
	t.Run("all linked accounts may edit their projects but cannot change department or create projects", func(t *testing.T) {
		for i, token := range []string{firstJWT, secondJWT} {
			input := projects[0]
			input.Name = fmt.Sprintf("Shared edit %d", i)
			body, err := common.Marshal(input)
			require.NoError(t, err)
			response := accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/projects/%d", input.Id), token, "", string(body))
			var result struct{ Success bool }
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.True(t, result.Success, response.Body.String())
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "POST", "/api/projects", token, "", string(body)).Code)
			input.DepartmentId = departments[1].Id
			body, err = common.Marshal(input)
			require.NoError(t, err)
			response = accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/projects/%d", input.Id), token, "", string(body))
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.False(t, result.Success)
			input = projects[1]
			body, err = common.Marshal(input)
			require.NoError(t, err)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/projects/%d", input.Id), token, "", string(body)).Code)
		}
		_, err := model.DeleteProject(projects[0].Id)
		require.EqualError(t, err, "Remove project account assignments before deleting the project")
		_, err = model.DeleteDepartment(departments[0].Id)
		require.Error(t, err)
	})
	t.Run("invalid assignments roll back and revocation removes access immediately", func(t *testing.T) {
		before, err := model.GetUserOrganization(users[1].Id)
		require.NoError(t, err)
		selfBody, err := common.Marshal(map[string]any{"username": users[1].Username, "display_name": "Self edit", "department_id": departments[1].Id, "project_ids": []int{projects[1].Id}, "admin_permissions": map[string]any{"all": true}})
		require.NoError(t, err)
		selfResponse := accessTokenRequest(engine, "PUT", "/api/user/self", firstJWT, "", string(selfBody))
		assert.Equal(t, http.StatusOK, selfResponse.Code, selfResponse.Body.String())
		afterSelf, err := model.GetUserOrganization(users[1].Id)
		require.NoError(t, err)
		assert.Equal(t, before, afterSelf)
		for _, input := range []model.UserOrganizationAssignment{{DepartmentId: departments[0].Id, ProjectIds: []int{99999}}, {DepartmentId: 99999, ProjectIds: []int{projects[0].Id}}, {DepartmentId: 0, ProjectIds: []int{projects[0].Id}}} {
			_, err := model.SaveUserOrganization(users[0].Id, users[1].Id, &input)
			require.Error(t, err)
			stored, err := model.GetUserOrganization(users[1].Id)
			require.NoError(t, err)
			assert.Equal(t, before, stored)
		}
		input := model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{projects[1].Id}}
		_, err = model.SaveUserOrganization(users[1].Id, users[1].Id, &input)
		require.ErrorIs(t, err, model.ErrProjectAccessDenied)
		assign(users[1].Id, model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{}})
		assert.Equal(t, http.StatusUnauthorized, accessTokenRequest(engine, "GET", "/api/projects", firstJWT, "", "").Code)
		freshJWT := signIn(users[1].Id)
		assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "GET", fmt.Sprintf("/api/projects/%d", projects[0].Id), freshJWT, "", "").Code)
	})
	t.Run("audit excludes credentials and schema repeats preserve organization assignments", func(t *testing.T) {
		var denials []model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "project.access.denied").Find(&denials).Error)
		require.NotEmpty(t, denials)
		for _, denial := range denials {
			assert.False(t, denial.Success)
			assert.NotEmpty(t, denial.RequestId)
		}
		var events []model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.organization.update").Find(&events).Error)
		require.NotEmpty(t, events)
		for _, event := range events {
			assert.Equal(t, users[0].Id, event.UserId)
			assert.NotEmpty(t, event.RequestId)
			encoded, err := common.Marshal(event.Other)
			require.NoError(t, err)
			assert.Contains(t, string(encoded), `"before"`)
			assert.Contains(t, string(encoded), `"after"`)
			assert.NotContains(t, string(encoded), rootJWT)
			assert.NotContains(t, strings.ToLower(string(encoded)), "proof_token")
		}
		before, err := model.GetUserOrganization(users[2].Id)
		require.NoError(t, err)
		for range 2 {
			require.NoError(t, db.AutoMigrate(&model.UserOrganization{}, &model.UserProject{}))
		}
		after, err := model.GetUserOrganization(users[2].Id)
		require.NoError(t, err)
		assert.Equal(t, before, after)
		require.Error(t, db.Create(&model.UserProject{UserId: users[2].Id, ProjectId: projects[0].Id}).Error)
	})
	t.Run("deleting an account removes its organization references", func(t *testing.T) {
		assign(users[3].Id, model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{projects[2].Id}})
		_, err := model.DeleteUserById(users[3].Id)
		require.NoError(t, err)
		for _, relation := range []any{&model.UserOrganization{}, &model.UserProject{}} {
			var remaining int64
			require.NoError(t, db.Model(relation).Where("user_id = ?", users[3].Id).Count(&remaining).Error)
			assert.Zero(t, remaining)
		}
	})
	t.Run("concurrent revocation and editing cannot retain write access", func(t *testing.T) {
		assign(users[1].Id, model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{projects[0].Id}})
		input := projects[0]
		input.Name = "Concurrent project edit"
		removal := model.UserOrganizationAssignment{DepartmentId: departments[0].Id, ProjectIds: []int{}}
		var writeErr, revokeErr error
		var workers sync.WaitGroup
		workers.Go(func() { _, writeErr = model.SaveProjectForUser(users[1].Id, &input) })
		workers.Go(func() { _, revokeErr = model.SaveUserOrganization(users[0].Id, users[1].Id, &removal) })
		workers.Wait()
		require.NoError(t, revokeErr)
		if writeErr != nil {
			require.ErrorIs(t, writeErr, model.ErrProjectAccessDenied)
		}
		_, err := model.SaveProjectForUser(users[1].Id, &input)
		require.ErrorIs(t, err, model.ErrProjectAccessDenied)
	})
}
