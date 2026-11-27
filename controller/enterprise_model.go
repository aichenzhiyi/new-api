package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func enterpriseError(c *gin.Context, err error) {
	if errors.Is(err, model.ErrEnterpriseAccessDenied) || errors.Is(err, model.ErrProjectAccessDenied) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": err.Error()})
		recordUserSecurityAudit(c, c.GetInt("id"), "enterprise.access.denied", map[string]any{"id": c.Param("id"), "success": false})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "Record does not exist")
		return
	}
	common.ApiError(c, err)
}

func GetSupplierAccounts(c *gin.Context) {
	rows, err := model.GetSupplierAccounts(c.GetInt("id"))
	if err != nil {
		enterpriseError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

func GetProcurementOptions(c *gin.Context) {
	if err := model.RequireEnterpriseAdmin(model.DB, c.GetInt("id")); err != nil {
		enterpriseError(c, err)
		return
	}
	channels, err := model.GetEnterpriseChannels()
	if err != nil {
		enterpriseError(c, err)
		return
	}
	var vendors []model.Vendor
	if err := model.DB.Select("id", "name").Order("name").Find(&vendors).Error; err != nil {
		enterpriseError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"channels": channels, "vendors": vendors})
}

func SaveSupplierAccount(c *gin.Context) {
	var input struct {
		model.SupplierAccount
		Enabled *bool `json:"enabled"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.Enabled == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	account := input.SupplierAccount
	account.Id, account.CreatedTime, account.UpdatedTime, account.Enabled = 0, 0, 0, *input.Enabled
	action := "supplier_account.create"
	if c.Request.Method == http.MethodPut {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil || id < 1 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		account.Id, action = id, "supplier_account.update"
	}
	before, err := model.SaveSupplierAccount(c.GetInt("id"), &account)
	if err != nil {
		enterpriseError(c, err)
		return
	}
	recordManageAudit(c, action, map[string]any{"id": account.Id, "before": before, "after": account})
	common.ApiSuccess(c, account)
}

func DeleteSupplierAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	before, err := model.DeleteSupplierAccount(c.GetInt("id"), id)
	if err != nil {
		enterpriseError(c, err)
		return
	}
	recordManageAudit(c, "supplier_account.delete", map[string]any{"id": id, "before": before})
	common.ApiSuccess(c, nil)
}

func GetEnterpriseModels(c *gin.Context) {
	rows, err := model.GetEnterpriseModels(c.GetInt("id"), 0)
	if err != nil {
		enterpriseError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

func GetProjectEnterpriseModels(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	rows, err := model.GetEnterpriseModels(c.GetInt("id"), id)
	if err != nil {
		enterpriseError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

func SaveEnterpriseModel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var input struct {
		model.EnterpriseModel
		Shared *bool `json:"shared"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.Shared == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	profile := input.EnterpriseModel
	profile.ModelId, profile.Shared, profile.CreatedTime, profile.UpdatedTime = id, *input.Shared, 0, 0
	before, err := model.SaveEnterpriseModel(c.GetInt("id"), &profile)
	if err != nil {
		enterpriseError(c, err)
		return
	}
	recordManageAudit(c, "enterprise_model.update", map[string]any{"id": id, "before": before, "after": profile})
	common.ApiSuccess(c, profile)
}

func DeleteEnterpriseModel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	before, err := model.DeleteEnterpriseModel(c.GetInt("id"), id)
	if err != nil {
		enterpriseError(c, err)
		return
	}
	recordManageAudit(c, "enterprise_model.delete", map[string]any{"id": id, "before": before})
	common.ApiSuccess(c, nil)
}
