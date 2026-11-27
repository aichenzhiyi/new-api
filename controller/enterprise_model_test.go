package controller

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnterpriseModelManagement(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Department{}, &model.Project{}, &model.UserOrganization{}, &model.UserProject{}, &model.Model{}, &model.Vendor{}, &model.Channel{}, &model.Ability{}, &model.SystemTask{}))
	// Upgrade a representative pre-04 schema containing an existing channel.
	require.NoError(t, db.Migrator().DropColumn(&model.Channel{}, "supplier_account_id"))
	channel := model.Channel{Name: "Qwen route", Key: "upstream-secret", Models: "qwen-plus,qwen-max", Status: 1, HeaderOverride: new(`{"Authorization":"private-header"}`)}
	require.NoError(t, db.Create(&channel).Error)
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		script, err := os.ReadFile("../notes/sql/04-enterprise-models.mysql8.sql")
		require.NoError(t, err)
		var sql strings.Builder
		for line := range strings.SplitSeq(string(script), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				sql.WriteString(line)
				sql.WriteByte('\n')
			}
		}
		for range 2 {
			for statement := range strings.SplitSeq(sql.String(), ";") {
				if strings.TrimSpace(statement) != "" {
					require.NoError(t, db.Exec(statement).Error)
				}
			}
		}
	}
	for range 2 {
		require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.SupplierAccount{}, &model.EnterpriseModel{}, &model.EnterpriseModelProject{}))
	}
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		var missingComments int64
		require.NoError(t, db.Raw("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND (table_name IN ('supplier_accounts', 'enterprise_models', 'enterprise_model_projects') OR (table_name = 'channels' AND column_name = 'supplier_account_id')) AND column_comment = ''").Scan(&missingComments).Error)
		assert.Zero(t, missingComments, "startup migrations must preserve shipped SQL column comments")
	}
	var upgraded model.Channel
	require.NoError(t, db.First(&upgraded, channel.Id).Error)
	assert.Equal(t, "upstream-secret", upgraded.Key)
	assert.Zero(t, upgraded.SupplierAccountId)

	users := make([]model.User, 3)
	credentials := make([]string, 3)
	for i := range users {
		role := common.RoleCommonUser
		if i == 0 {
			role = common.RoleRootUser
		}
		if i == 2 {
			role = common.RoleAdminUser
		}
		users[i] = model.User{Username: fmt.Sprintf("enterprise-%d", i), Password: "unused", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: fmt.Sprintf("enterprise-%d", i)}
		require.NoError(t, db.Create(&users[i]).Error)
		require.NoError(t, model.PublishUserAuthCache(users[i].Id))
		_, credentials[i] = createAccessTokenTestSession(t, users[i].Id, fmt.Sprintf("enterprise-%d", i))
	}
	department := model.Department{Code: "ENT", Name: "Enterprise", Enabled: true}
	_, err := model.SaveDepartment(&department)
	require.NoError(t, err)
	projects := []model.Project{{Code: "ENT_A", Name: "Project A", DepartmentId: department.Id, Enabled: true}, {Code: "ENT_B", Name: "Project B", DepartmentId: department.Id, Enabled: true}}
	for i := range projects {
		_, err := model.SaveProject(&projects[i])
		require.NoError(t, err)
	}
	require.NoError(t, db.Create(&model.UserProject{UserId: users[1].Id, ProjectId: projects[0].Id}).Error)
	vendor := model.Vendor{Name: "Procurement vendor"}
	require.NoError(t, vendor.Insert())
	metadata := []model.Model{{ModelName: "qwen-", NameRule: model.NameRulePrefix, VendorID: vendor.Id, Status: 1}, {ModelName: "gpt-test", VendorID: vendor.Id, Status: 1}}
	for i := range metadata {
		require.NoError(t, metadata[i].Insert())
	}
	account := model.SupplierAccount{Code: "qwen_main", Name: "Qwen corporate", VendorId: vendor.Id, AccountRef: "private-purchase-ref", Owner: "Buyer", Currency: "cny", ContractRef: "private-contract", Enabled: true, ChannelIds: []int{channel.Id}}
	_, err = model.SaveSupplierAccount(users[0].Id, &account)
	require.NoError(t, err)
	assert.Equal(t, "QWEN_MAIN", account.Code)
	assert.Equal(t, "CNY", account.Currency)
	profile := model.EnterpriseModel{ModelId: metadata[0].Id, ModelVersion: "2026-11", Capabilities: "text,tools", ContextLimit: 131072, Scenarios: "Assistant", Owner: "Model owner", DeploymentType: "cloud", ProjectIds: []int{projects[0].Id}}
	_, err = model.SaveEnterpriseModel(users[0].Id, &profile)
	require.NoError(t, err)
	shared := model.EnterpriseModel{ModelId: metadata[1].Id, DeploymentType: "local", Shared: true, ProjectIds: []int{}}
	_, err = model.SaveEnterpriseModel(users[0].Id, &shared)
	require.NoError(t, err)

	engine := gin.New()
	engine.Use(middleware.RequestId(), middleware.AccessTokenAudit())
	routes := engine.Group("/api/enterprise", middleware.UserAuth())
	routes.GET("/accounts", GetSupplierAccounts)
	routes.GET("/options", GetProcurementOptions)
	routes.POST("/accounts", SaveSupplierAccount)
	routes.PUT("/accounts/:id", SaveSupplierAccount)
	routes.DELETE("/accounts/:id", DeleteSupplierAccount)
	routes.GET("/models", GetEnterpriseModels)
	routes.PUT("/models/:id", SaveEnterpriseModel)
	routes.DELETE("/models/:id", DeleteEnterpriseModel)
	engine.GET("/api/projects/:id/models", middleware.UserAuth(), GetProjectEnterpriseModels)

	t.Run("project views match model rules and exclude purchasing references and secrets", func(t *testing.T) {
		response := accessTokenRequest(engine, "GET", fmt.Sprintf("/api/projects/%d/models", projects[0].Id), credentials[1], "", "")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var result struct {
			Success bool
			Data    []model.EnterpriseModelView
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success)
		require.Len(t, result.Data, 2)
		var qwen *model.EnterpriseModelView
		for i := range result.Data {
			if result.Data[i].ModelId == metadata[0].Id {
				qwen = &result.Data[i]
			}
		}
		require.NotNil(t, qwen)
		require.Len(t, qwen.Channels, 1)
		assert.Equal(t, account.Id, qwen.Channels[0].SupplierAccountId)
		assert.Equal(t, account.Name, qwen.Channels[0].AccountName)
		assert.Empty(t, qwen.ProjectIds)
		for _, secret := range []string{"upstream-secret", "private-header", "private-contract", "private-purchase-ref", "header_override", "account_ref", "contract_ref"} {
			assert.NotContains(t, response.Body.String(), secret)
		}
		rootOptions := accessTokenRequest(engine, "GET", "/api/enterprise/options", credentials[0], "", "")
		assert.NotContains(t, rootOptions.Body.String(), "upstream-secret")
		assert.NotContains(t, rootOptions.Body.String(), "private-header")
	})
	t.Run("unrelated and revoked memberships cannot read the project", func(t *testing.T) {
		path := fmt.Sprintf("/api/projects/%d/models", projects[1].Id)
		assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "GET", path, credentials[1], "", "").Code)
		require.NoError(t, db.Where("user_id = ?", users[1].Id).Delete(&model.UserProject{}).Error)
		path = fmt.Sprintf("/api/projects/%d/models", projects[0].Id)
		assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "GET", path, credentials[1], "", "").Code)
	})
	t.Run("ordinary users and legacy admins cannot read or write global configuration", func(t *testing.T) {
		accountBody, err := common.Marshal(account)
		require.NoError(t, err)
		profileBody, err := common.Marshal(profile)
		require.NoError(t, err)
		for _, credential := range credentials[1:] {
			for _, path := range []string{"/api/enterprise/accounts", "/api/enterprise/options", "/api/enterprise/models"} {
				assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "GET", path, credential, "", "").Code)
			}
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "POST", "/api/enterprise/accounts", credential, "", string(accountBody)).Code)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/enterprise/accounts/%d", account.Id), credential, "", string(accountBody)).Code)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "DELETE", fmt.Sprintf("/api/enterprise/accounts/%d", account.Id), credential, "", "").Code)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/enterprise/models/%d", profile.ModelId), credential, "", string(profileBody)).Code)
			assert.Equal(t, http.StatusForbidden, accessTokenRequest(engine, "DELETE", fmt.Sprintf("/api/enterprise/models/%d", profile.ModelId), credential, "", "").Code)
		}
	})
	t.Run("references and invalid selections are rejected atomically", func(t *testing.T) {
		_, err := model.DeleteSupplierAccount(users[0].Id, account.Id)
		require.Error(t, err)
		require.Error(t, model.DeleteVendors([]int{vendor.Id}))
		_, err = model.DeleteProject(projects[0].Id)
		require.Error(t, err)
		_, err = model.DeleteModelMetadata([]int{metadata[0].Id}, false, false)
		require.Error(t, err)
		conflict := account
		conflict.Id = 0
		conflict.Code = "OTHER"
		_, err = model.SaveSupplierAccount(users[0].Id, &conflict)
		require.Error(t, err)
		invalid := account
		invalid.ChannelIds = []int{999999}
		invalid.Name = "Should roll back"
		_, err = model.SaveSupplierAccount(users[0].Id, &invalid)
		require.Error(t, err)
		invalidProfile := profile
		invalidProfile.ProjectIds = []int{999999}
		_, err = model.SaveEnterpriseModel(users[0].Id, &invalidProfile)
		require.Error(t, err)
		invalidProfile.ProjectIds = []int{projects[0].Id}
		invalidProfile.Shared = true
		_, err = model.SaveEnterpriseModel(users[0].Id, &invalidProfile)
		require.Error(t, err)
		var saved model.SupplierAccount
		require.NoError(t, db.First(&saved, account.Id).Error)
		assert.Equal(t, account.Name, saved.Name)
		// Normal channel updates cannot erase or reassign the ledger binding.
		require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", channel.Id).Updates(model.Channel{Name: "Edited route", SupplierAccountId: 999999}).Error)
		require.NoError(t, db.First(&upgraded, channel.Id).Error)
		assert.Equal(t, account.Id, upgraded.SupplierAccountId)
	})
	t.Run("root changes are audited and removing profiles preserves the catalog", func(t *testing.T) {
		profile.Shared = true
		profile.ProjectIds = []int{}
		body, err := common.Marshal(profile)
		require.NoError(t, err)
		response := accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/enterprise/models/%d", profile.ModelId), credentials[0], "", string(body))
		require.Contains(t, response.Body.String(), `"success":true`)
		rootView, err := model.GetEnterpriseModels(users[0].Id, projects[1].Id)
		require.NoError(t, err)
		assert.Len(t, rootView, 2)
		response = accessTokenRequest(engine, "DELETE", fmt.Sprintf("/api/enterprise/models/%d", profile.ModelId), credentials[0], "", "")
		require.Contains(t, response.Body.String(), `"success":true`)
		var saved model.Model
		require.NoError(t, db.First(&saved, metadata[0].Id).Error)
		account.ChannelIds = []int{}
		body, err = common.Marshal(account)
		require.NoError(t, err)
		response = accessTokenRequest(engine, "PUT", fmt.Sprintf("/api/enterprise/accounts/%d", account.Id), credentials[0], "", string(body))
		require.Contains(t, response.Body.String(), `"success":true`)
		response = accessTokenRequest(engine, "DELETE", fmt.Sprintf("/api/enterprise/accounts/%d", account.Id), credentials[0], "", "")
		require.Contains(t, response.Body.String(), `"success":true`)
		var audits []model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action IN ?", []string{"enterprise_model.update", "enterprise_model.delete", "supplier_account.update", "supplier_account.delete"}).Find(&audits).Error)
		assert.Len(t, audits, 4)
		encoded, err := common.Marshal(audits)
		require.NoError(t, err)
		assert.NotContains(t, string(encoded), "upstream-secret")
		assert.NotContains(t, string(encoded), "private-header")
	})
	t.Run("persisted root privilege is checked on every shared configuration request", func(t *testing.T) {
		require.NoError(t, db.Model(&model.User{}).Where("id = ?", users[0].Id).Update("role", common.RoleCommonUser).Error)
		response := accessTokenRequest(engine, "GET", "/api/enterprise/accounts", credentials[0], "", "")
		assert.Equal(t, http.StatusForbidden, response.Code)
		require.NoError(t, db.Model(&model.User{}).Where("id = ?", users[0].Id).Update("role", common.RoleRootUser).Error)
	})
}
